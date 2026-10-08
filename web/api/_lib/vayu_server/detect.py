"""Turn stored readings into events. Runs after every packet and once a minute.

Event kinds
  methane_rise   area   two or more nodes above rise_ppm within window_min, or one node above it
                        for sustain_readings readings in a row; checked against the wind and
                        located with the Gaussian plume
  fire_smoke     area   PM2.5 (and CO, where measured) far above the area's cleanest node
  lel            node   methane at 10% of the lower explosive limit: a safety alarm
  early_warning  node   the early-warning model expects a rise within its horizon
  node_offline   node   a node that has reported before has gone quiet
  low_battery    node   battery below battery_low_v (closes above battery_ok_v)
  bridge_offline area   the radio bridge stopped reporting (suppresses node_offline)

Wind check of a methane rise, relative to the area centre:
  consistent     some rising node is downwind and none is upwind
  inconsistent   rising nodes are upwind, or none is downwind: suspect a local source
  calm           wind below calm_ms, direction not tested (no source location either)
  no_wind        no recent anemometer reading
"""

from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass
from typing import Any

from . import db, ewmodel, geo, series
from .config import Config
from .plume import locate

AREA_KINDS = ("methane_rise", "fire_smoke", "bridge_offline")
NODE_KINDS = ("lel", "early_warning", "node_offline", "low_battery")


@dataclass
class Change:
    event_id: int
    kind: str
    action: str  # opened | updated | closed
    node_id: str | None = None


class Detector:
    def __init__(self, conn: sqlite3.Connection, cfg: Config,
                 model: ewmodel.Model | None = None) -> None:
        self.conn = conn
        self.cfg = cfg
        if model is None and cfg.model.early_warning_enabled:
            model = ewmodel.load_model(cfg.model.early_warning)
        self.model = model
        self.changes: list[Change] = []

    # --- event rows --------------------------------------------------------------------------

    def _open_event(self, kind: str, node_id: str | None = None) -> sqlite3.Row | None:
        return self.conn.execute(
            "SELECT * FROM events WHERE area_id = ? AND kind = ? AND IFNULL(node_id, '') = ?"
            " AND status = 'open'", (self.cfg.area.id, kind, node_id or "")).fetchone()

    def _open(self, kind: str, now: int, node_id: str | None = None, **fields: Any) -> int:
        fields.setdefault("detail", {})
        cols = ["area_id", "kind", "node_id", "opened_at", "updated_at", *fields]
        vals = [self.cfg.area.id, kind, node_id, now, now,
                *[_sql(v) for v in fields.values()]]
        cur = self.conn.execute(
            f"INSERT INTO events ({', '.join(cols)}) VALUES ({', '.join('?' * len(cols))})", vals)
        self.changes.append(Change(cur.lastrowid, kind, "opened", node_id))
        return cur.lastrowid

    def _update(self, ev: sqlite3.Row, now: int, notify: bool, **fields: Any) -> None:
        if not fields:
            return
        sets = ", ".join(f"{k} = ?" for k in fields)
        extra = ", updated_at = ?, dirty = 1" if notify else ""
        args = [*[_sql(v) for v in fields.values()], *([now] if notify else []), ev["id"]]
        self.conn.execute(f"UPDATE events SET {sets}{extra} WHERE id = ?", args)
        if notify:
            self.changes.append(Change(ev["id"], ev["kind"], "updated", ev["node_id"]))

    def _close(self, ev: sqlite3.Row, now: int, **detail: Any) -> None:
        merged = {**json.loads(ev["detail"]), **detail}
        self.conn.execute(
            "UPDATE events SET status = 'closed', closed_at = ?, updated_at = ?, detail = ?,"
            " dirty = 1 WHERE id = ?", (now, now, json.dumps(merged), ev["id"]))
        self.changes.append(Change(ev["id"], ev["kind"], "closed", ev["node_id"]))

    # --- run ---------------------------------------------------------------------------------

    def run(self, now: int) -> list[Change]:
        self.changes = []
        area = self.conn.execute("SELECT * FROM areas WHERE id = ?", (self.cfg.area.id,)
                                 ).fetchone()
        if area is None:
            return []
        self.center = (area["center_lat"], area["center_lon"])
        self.ring = json.loads(area["outline"])["coordinates"][0]
        self.nodes = series.active_nodes(self.conn, self.cfg.area.id)
        with db.tx(self.conn):
            bridge_down = self._bridge(now)
            self._offline(now, suppressed=bridge_down)
            self._battery(now)
            self._lel(now)
            self._methane(now)
            self._fire(now)
            if self.model is not None:
                self._early_warning(now)
        return self.changes

    # --- health ------------------------------------------------------------------------------

    def _bridge(self, now: int) -> bool:
        seen = db.kv_get(self.conn, "bridge_seen")
        if seen is None:
            return False  # no bridge has ever reported: nothing to compare against
        down = (db.kv_get(self.conn, "bridge_state") == "offline"
                or now - int(seen) > self.cfg.detect.bridge_timeout_min * 60)
        ev = self._open_event("bridge_offline")
        if down and ev is None:
            self._open("bridge_offline", now, detail={"last_seen": int(seen)})
        elif not down and ev is not None:
            self._close(ev, now)
            db.kv_set(self.conn, "bridge_back_at", str(now))
        return down

    def _offline(self, now: int, suppressed: bool) -> None:
        back = int(db.kv_get(self.conn, "bridge_back_at", "0"))
        for n in self.nodes:
            if n["last_seen"] is None:
                continue  # planned but never heard from: not installed yet
            limit = max(self.cfg.detect.offline_min * 60, 3 * n["interval_s"])
            quiet = now - max(n["last_seen"], back) > limit
            ev = self._open_event("node_offline", n["id"])
            if quiet and ev is None and not suppressed:
                self._open("node_offline", now, n["id"], detail={"last_seen": n["last_seen"]})
            elif not quiet and ev is not None:
                self._close(ev, now)

    def _battery(self, now: int) -> None:
        d = self.cfg.detect
        for n in self.nodes:
            v = n["battery_v"]
            if v is None:
                continue
            ev = self._open_event("low_battery", n["id"])
            if v < d.battery_low_v and ev is None:
                self._open("low_battery", now, n["id"], peak=v)
            elif v > d.battery_ok_v and ev is not None:
                self._close(ev, now)

    def _lel(self, now: int) -> None:
        d = self.cfg.detect
        for n in self.nodes:
            r = series.latest(self.conn, n["id"], "ch4_ppm", now, d.window_min * 60)
            ev = self._open_event("lel", n["id"])
            if r and r[1] >= d.lel_ppm:
                if ev is None:
                    self._open("lel", now, n["id"], peak=r[1])
                elif r[1] > (ev["peak"] or 0):
                    self._update(ev, now, notify=True, peak=r[1])
            elif ev is not None and (r is None or r[1] < d.close_ratio * d.lel_ppm):
                self._close(ev, now)

    # --- methane -----------------------------------------------------------------------------

    def _excess_now(self, now: int) -> dict[str, float]:
        out = {}
        for n in self.nodes:
            if n["role"] == "background":
                continue
            r = series.latest(self.conn, n["id"], "ch4_excess_ppm", now,
                              self.cfg.detect.window_min * 60)
            if r is not None:
                out[n["id"]] = r[1]
        return out

    def _sustained(self, node_id: str, now: int) -> bool:
        d = self.cfg.detect
        rows = self.conn.execute(
            "SELECT at, value FROM observations WHERE node_id = ? AND variable = 'ch4_excess_ppm'"
            " AND at <= ? AND at > ? ORDER BY at DESC LIMIT ?",
            (node_id, now, now - 3 * 3600, d.sustain_readings)).fetchall()
        return (len(rows) == d.sustain_readings and rows[0]["at"] >= now - d.window_min * 60
                and all(r["value"] >= d.rise_ppm for r in rows))

    def _wind_check(self, rising: list[str], wind: tuple[float, float] | None) -> str:
        d = self.cfg.detect
        if wind is None:
            return "no_wind"
        if wind[0] < d.calm_ms:
            return "calm"
        downwind = (wind[1] + 180) % 360
        by_id = {n["id"]: n for n in self.nodes}
        diffs = [geo.angle_diff(geo.bearing_deg(*self.center, by_id[i]["lat"], by_id[i]["lon"]),
                                downwind) for i in rising]
        if any(x <= d.downwind_deg for x in diffs) and not any(x >= d.upwind_deg for x in diffs):
            return "consistent"
        return "inconsistent"

    def _methane(self, now: int) -> None:
        d = self.cfg.detect
        excess = self._excess_now(now)
        rising = sorted(i for i, v in excess.items() if v >= d.rise_ppm)
        triggered = len(rising) >= d.min_nodes or any(self._sustained(i, now) for i in rising)
        hit = any(v >= d.close_ratio * d.rise_ppm for v in excess.values())
        ev = self._open_event("methane_rise")
        if ev is None and not triggered:
            return
        if ev is not None and not hit:
            detail = json.loads(ev["detail"])
            if now - detail.get("last_hit", ev["opened_at"]) >= d.clear_min * 60:
                self._close(ev, now)
            return

        wind = series.area_wind(self.conn, self.cfg, now)
        by_id = {n["id"]: n for n in self.nodes}
        involved = sorted(set(rising) | set(json.loads(ev["nodes"]) if ev else []))
        check = self._wind_check(involved, wind)
        source = None
        if wind is not None and wind[0] >= d.calm_ms:
            source = locate([(by_id[i]["lat"], by_id[i]["lon"], v) for i, v in excess.items()],
                            self.ring, wind[0], wind[1],
                            geo.is_night(now, self.cfg.area.utc_offset_h),
                            step_m=d.grid_step_m, source_radius_m=d.source_radius_m)
        peak = max([excess[i] for i in rising] + [ev["peak"] if ev else 0.0])
        fields: dict[str, Any] = {
            "peak": peak, "nodes": involved, "wind_check": check,
            "wind_ms": wind[0] if wind else None, "wind_from_deg": wind[1] if wind else None,
            "source_lat": source.lat if source else None,
            "source_lon": source.lon if source else None,
            "source_radius_m": source.radius_m if source else None,
        }
        detail = {"last_hit": now, "excess": {i: round(v, 3) for i, v in excess.items()},
                  "fit": round(source.fit, 3) if source else None}
        if ev is None:
            self._open("methane_rise", now, detail=detail, **fields)
            self._credit_warnings(now)
            return
        old = json.loads(ev["detail"])
        notify = (peak > (ev["peak"] or 0) or involved != json.loads(ev["nodes"] or "[]")
                  or check != ev["wind_check"])
        if source is None and ev["source_lat"] is not None:  # keep the last good location
            for k in ("source_lat", "source_lon", "source_radius_m"):
                fields[k] = ev[k]
            detail["fit"] = old.get("fit")
        self._update(ev, now, notify=notify, detail={**old, **detail}, **fields)

    def _credit_warnings(self, now: int) -> None:
        for ev in self.conn.execute(
                "SELECT * FROM events WHERE area_id = ? AND kind = 'early_warning'"
                " AND status = 'open'", (self.cfg.area.id,)).fetchall():
            self._close(ev, now, outcome="rise", lead_min=round((now - ev["opened_at"]) / 60))

    # --- fire --------------------------------------------------------------------------------

    def _latest_by_node(self, variable: str, now: int) -> dict[str, float]:
        out = {}
        for n in self.nodes:
            r = series.latest(self.conn, n["id"], variable, now, self.cfg.detect.window_min * 60)
            if r is not None:
                out[n["id"]] = r[1]
        return out

    def _fire(self, now: int) -> None:
        d = self.cfg.detect
        pm = self._latest_by_node("pm25_ugm3", now)
        co = self._latest_by_node("co_ppm", now)
        burning: dict[str, float] = {}
        for node_id, value in pm.items():
            others = [v for k, v in pm.items() if k != node_id]
            if not others:
                continue
            pm_excess = value - min(others)
            co_others = [v for k, v in co.items() if k != node_id]
            if node_id in co and co_others:
                fire = pm_excess >= d.pm25_rise and co[node_id] - min(co_others) >= d.co_rise
            else:
                fire = pm_excess >= 2 * d.pm25_rise
            if fire:
                burning[node_id] = pm_excess
        ev = self._open_event("fire_smoke")
        if burning:
            detail = {"last_hit": now, "pm25_excess": {k: round(v, 1) for k, v in burning.items()}}
            peak = max(burning.values())
            if ev is None:
                self._open("fire_smoke", now, peak=peak, nodes=sorted(burning), detail=detail)
            else:
                involved = sorted(set(burning) | set(json.loads(ev["nodes"] or "[]")))
                notify = peak > (ev["peak"] or 0) or involved != json.loads(ev["nodes"] or "[]")
                self._update(ev, now, notify=notify, peak=max(peak, ev["peak"] or 0),
                             nodes=involved, detail={**json.loads(ev["detail"]), **detail})
        elif ev is not None:
            last = json.loads(ev["detail"]).get("last_hit", ev["opened_at"])
            if now - last >= d.clear_min * 60:
                self._close(ev, now)

    # --- early warning -----------------------------------------------------------------------

    def _early_warning(self, now: int) -> None:
        m = self.model
        assert m is not None
        for ev in self.conn.execute(
                "SELECT * FROM events WHERE area_id = ? AND kind = 'early_warning'"
                " AND status = 'open'", (self.cfg.area.id,)).fetchall():
            if now - ev["opened_at"] > m.horizon_h * 3600:
                self._close(ev, now, outcome="no_rise")
        if self._open_event("methane_rise") is not None:
            return  # already rising: a warning would add nothing
        for n in self.nodes:
            if n["role"] == "background" or self._open_event("early_warning", n["id"]):
                continue
            full = ewmodel.node_features(self.conn, self.cfg, n, self.center, now)
            if full is None:
                continue
            x = [full[ewmodel.FEATURE_NAMES.index(f)] for f in m.features]
            p = ewmodel.predict(m, x)
            if p >= m.threshold:
                self._open("early_warning", now, n["id"], peak=p, detail={
                    "p": round(p, 4), "model": m.version, "placeholder": m.placeholder,
                    "threshold": m.threshold, "horizon_h": m.horizon_h})


def _sql(v: Any) -> Any:
    return json.dumps(v) if isinstance(v, (dict, list)) else v
