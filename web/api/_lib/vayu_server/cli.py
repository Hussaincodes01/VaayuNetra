"""`vayu`: set up the Pi and run its services.

    vayu init                          create the database and the session secret
    vayu import-survey survey.json     load the area from the cloud's setup survey
    vayu add-user NAME --role admin    dashboard user (password read from stdin)
    vayu add-recipient --name ... --phone +91... --role official --lang hi
    vayu assign-radio NODE RADIO_ID    tie an installed radio to a planned node
    vayu status                        one-screen health summary
    vayu core | web | bridge | sim     the services (systemd runs the first three)
"""

from __future__ import annotations

import argparse
import getpass
import json
import logging
import secrets
import sqlite3
import sys
import time
from pathlib import Path

from . import __version__, alerts, db, topics
from .config import Config, ConfigError, load_config, read_secret
from .sim import Scenario, node_reading
from .survey import SurveyError, import_survey
from .web import auth

log = logging.getLogger("vayu")


def _fail(message: str) -> int:
    print(f"vayu: {message}", file=sys.stderr)
    return 1


def _conn(cfg: Config) -> sqlite3.Connection:
    return db.connect(cfg.paths.db)


def cmd_init(cfg: Config, args: argparse.Namespace) -> int:
    _conn(cfg).close()
    secret = Path(cfg.paths.secret_file)
    if not secret.exists():
        secret.parent.mkdir(parents=True, exist_ok=True)
        secret.write_text(secrets.token_urlsafe(48) + "\n", encoding="utf-8")
        try:
            secret.chmod(0o600)
        except OSError:
            pass
    Path(cfg.paths.models_dir).mkdir(parents=True, exist_ok=True)
    print(f"database {cfg.paths.db} ready; next: vayu import-survey <file>")
    return 0


def cmd_import_survey(cfg: Config, args: argparse.Namespace) -> int:
    try:
        data = json.loads(Path(args.file).read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        return _fail(f"cannot read {args.file}: {e}")
    area_id = (data.get("area") or {}).get("id")
    if area_id != cfg.area.id:
        return _fail(f"survey is for area {area_id!r} but this Pi serves {cfg.area.id!r}"
                     " (area.id in the config)")
    try:
        s = import_survey(_conn(cfg), data, int(time.time()))
    except SurveyError as e:
        return _fail(str(e))
    print(f"area {s['area']}: {s['nodes_added']} nodes added, {s['nodes_updated']} updated,"
          f" {s['nodes_deactivated']} deactivated, {s['hotspots']} satellite hotspots")
    for w in s["warnings"]:
        print(f"warning: {w}")
    return 0


def cmd_add_user(cfg: Config, args: argparse.Namespace) -> int:
    if sys.stdin.isatty():
        password = getpass.getpass("password (10+ characters): ")
    else:
        password = sys.stdin.readline().rstrip("\n")
    try:
        auth.create_user(_conn(cfg), args.username, password, args.role, args.lang,
                         int(time.time()))
    except ValueError as e:
        return _fail(str(e))
    print(f"user {args.username} ({args.role}) created")
    return 0


def cmd_add_recipient(cfg: Config, args: argparse.Namespace) -> int:
    kinds = args.kinds.split(",") if args.kinds else None
    try:
        alerts.add_recipient(_conn(cfg), args.name, args.phone, args.role, args.lang,
                             int(time.time()), kinds=kinds, agency=args.agency)
    except ValueError as e:
        return _fail(str(e))
    print(f"SMS recipient {args.name} added")
    return 0


def cmd_assign_radio(cfg: Config, args: argparse.Namespace) -> int:
    conn = _conn(cfg)
    with db.tx(conn):
        if conn.execute("SELECT 1 FROM nodes WHERE id = ? AND area_id = ?",
                        (args.node, cfg.area.id)).fetchone() is None:
            return _fail(f"no node {args.node} in area {cfg.area.id}")
        conn.execute("UPDATE nodes SET radio_id = NULL WHERE radio_id = ?", (args.radio_id,))
        conn.execute("UPDATE nodes SET radio_id = ? WHERE id = ?", (args.radio_id, args.node))
        conn.execute("DELETE FROM unknown_radios WHERE radio_id = ?", (args.radio_id,))
    print(f"radio {args.radio_id} -> node {args.node}")
    return 0


def cmd_status(cfg: Config, args: argparse.Namespace) -> int:
    conn = _conn(cfg)
    now = int(time.time())
    area = conn.execute("SELECT name FROM areas WHERE id = ?", (cfg.area.id,)).fetchone()

    def count(sql: str) -> int:
        return conn.execute(sql).fetchone()[0]

    last = conn.execute("SELECT MAX(last_seen) FROM nodes WHERE area_id = ?",
                        (cfg.area.id,)).fetchone()[0]
    active = count("SELECT COUNT(*) FROM nodes WHERE active = 1")
    heard = count("SELECT COUNT(*) FROM nodes WHERE active = 1 AND last_seen IS NOT NULL")
    open_events = count("SELECT COUNT(*) FROM events WHERE status = 'open'")
    queued = count("SELECT COUNT(*) FROM alerts WHERE status = 'queued'")
    failed = count("SELECT COUNT(*) FROM alerts WHERE status = 'failed'")
    synced = db.kv_get(conn, "sync_last_ok")
    print(f"area: {cfg.area.id} ({area['name'] if area else 'no survey imported'})")
    print(f"nodes: {active} active, {heard} heard from, last reading "
          + (f"{now - last} s ago" if last else "never"))
    print(f"bridge: {db.kv_get(conn, 'bridge_state') or 'not reported'}")
    print(f"open events: {open_events}")
    print(f"SMS: {queued} queued, {failed} failed")
    print("cloud sync: " + ("off" if not cfg.sync.url else
                            f"last ok {now - int(synced)} s ago" if synced else "never"))
    return 0


def cmd_core(cfg: Config, args: argparse.Namespace) -> int:  # pragma: no cover - service
    from .core import Core
    from .sms import make_sender

    Core(cfg, _conn(cfg), make_sender(cfg)).run_forever()
    return 0


def cmd_web(cfg: Config, args: argparse.Namespace) -> int:  # pragma: no cover - service
    import uvicorn

    from .web.app import create_app

    uvicorn.run(create_app(cfg), host=cfg.web.host, port=cfg.web.port, workers=1,
                proxy_headers=True, forwarded_allow_ips="127.0.0.1", log_level="info")
    return 0


def cmd_bridge(cfg: Config, args: argparse.Namespace) -> int:  # pragma: no cover - hardware
    if args.gateway == "vayu":
        from .bridge import run_gateway_bridge

        if not args.port:
            raise SystemExit("--port is required with --gateway vayu")
        run_gateway_bridge(cfg, args.port)
        return 0
    from .bridge import run_bridge

    run_bridge(cfg, args.port)
    return 0


def sim_messages(conn: sqlite3.Connection, cfg: Config, sc: Scenario,
                 t: int) -> list[tuple[str, str]]:
    """What the bridge would publish at time t for every active node with a radio."""
    out = []
    for n in conn.execute("SELECT * FROM nodes WHERE area_id = ? AND active = 1"
                          " AND radio_id IS NOT NULL ORDER BY id", (cfg.area.id,)):
        out.append((topics.raw(cfg.mqtt.topic_root, cfg.area.id, n["radio_id"]),
                    json.dumps({"readings": [node_reading(n, sc, t)]})))
    return out


def cmd_sim(cfg: Config, args: argparse.Namespace) -> int:  # pragma: no cover - service
    import paho.mqtt.client as mqtt

    conn = _conn(cfg)
    area = conn.execute("SELECT * FROM areas WHERE id = ?", (cfg.area.id,)).fetchone()
    if area is None:
        return _fail("import a survey first")
    spot = conn.execute("SELECT lat, lon FROM hotspots WHERE area_id = ? LIMIT 1",
                        (cfg.area.id,)).fetchone()
    survey = json.loads(area["survey"])
    wind_from = args.wind_from if args.wind_from is not None else (
        (survey.get("wind") or {}).get("prevailing_from_deg") or 270.0)
    start = int(time.time())
    sc = Scenario(source_lat=spot["lat"] if spot else area["center_lat"],
                  source_lon=spot["lon"] if spot else area["center_lon"],
                  source_kgph=args.kgph if args.scenario == "leak" else 0.0,
                  wind_ms=args.wind_ms, wind_from_deg=wind_from,
                  leak_from=start + args.leak_after,
                  fire_node=args.fire_node if args.scenario == "fire" else None,
                  fire_from=start + args.leak_after,
                  utc_offset_h=cfg.area.utc_offset_h)
    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=f"vayu-sim-{cfg.area.id}")
    if cfg.mqtt.username:
        client.username_pw_set(cfg.mqtt.username, read_secret(cfg.mqtt.password_file))
    client.connect(cfg.mqtt.host, cfg.mqtt.port)
    client.loop_start()
    print(f"simulating '{args.scenario}' every {args.every} s (event starts in"
          f" {args.leak_after} s); Ctrl+C to stop")
    status = topics.status(cfg.mqtt.topic_root, cfg.area.id)
    try:
        for i in range(args.count or 10**9):
            now = int(time.time())
            client.publish(status, json.dumps({"state": "online", "at": now}), qos=1,
                           retain=True)
            for topic, body in sim_messages(conn, cfg, sc, now):
                client.publish(topic, body, qos=1)
            print(f"step {i + 1}: published {now}")
            time.sleep(args.every)
    except KeyboardInterrupt:
        pass
    finally:
        client.loop_stop()
        client.disconnect()
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="vayu", description="VayuNetra ground-network server")
    p.add_argument("--config", help="config file (default $VAYU_CONFIG or /etc/vayu/vayu.toml)")
    p.add_argument("--version", action="version", version=f"vayu {__version__}")
    sub = p.add_subparsers(dest="command", required=True)
    sub.add_parser("init").set_defaults(fn=cmd_init)
    s = sub.add_parser("import-survey")
    s.add_argument("file")
    s.set_defaults(fn=cmd_import_survey)
    s = sub.add_parser("add-user")
    s.add_argument("username")
    s.add_argument("--role", choices=auth.ROLES, default="officer")
    s.add_argument("--lang", choices=("en", "hi"), default="en")
    s.set_defaults(fn=cmd_add_user)
    s = sub.add_parser("add-recipient")
    s.add_argument("--name", required=True)
    s.add_argument("--phone", required=True, help="international format, e.g. +919812345678")
    s.add_argument("--role", choices=("official", "admin"), default="official")
    s.add_argument("--lang", choices=("en", "hi"), default="en")
    s.add_argument("--agency", default="")
    s.add_argument("--kinds", help=f"comma-separated, from: {','.join(alerts.ALL_KINDS)}")
    s.set_defaults(fn=cmd_add_recipient)
    s = sub.add_parser("assign-radio")
    s.add_argument("node")
    s.add_argument("radio_id")
    s.set_defaults(fn=cmd_assign_radio)
    sub.add_parser("status").set_defaults(fn=cmd_status)
    sub.add_parser("core").set_defaults(fn=cmd_core)
    sub.add_parser("web").set_defaults(fn=cmd_web)
    s = sub.add_parser("bridge")
    s.add_argument("--port", help="radio serial port, e.g. /dev/ttyUSB0 (default: first found)")
    s.add_argument("--gateway", choices=("meshtastic", "vayu"), default="meshtastic",
                   help="radio firmware on the USB stick: Meshtastic, or the Vayu-node gateway")
    s.set_defaults(fn=cmd_bridge)
    s = sub.add_parser("sim", help="publish simulated node readings over MQTT")
    s.add_argument("--scenario", choices=("leak", "fire", "quiet"), default="leak")
    s.add_argument("--kgph", type=float, default=1500.0, help="simulated emission (kg/h)")
    s.add_argument("--wind-from", type=float, help="degrees; default: survey prevailing wind")
    s.add_argument("--wind-ms", type=float, default=3.0)
    s.add_argument("--fire-node", default="R2")
    s.add_argument("--leak-after", type=int, default=300, help="seconds before the event starts")
    s.add_argument("--every", type=int, default=60, help="seconds between readings")
    s.add_argument("--count", type=int, default=0, help="steps to run (0 = until stopped)")
    s.set_defaults(fn=cmd_sim)
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    logging.basicConfig(level=logging.INFO,
                        format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    try:
        cfg = load_config(args.config)
    except ConfigError as e:
        return _fail(str(e))
    return args.fn(cfg, args)


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
