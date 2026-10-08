"""The core service: MQTT in, detection, SMS out, plus the once-a-minute housekeeping tick.

One thread owns the database writes: the MQTT client's network thread only queues messages, and
the main loop handles them in order. Alerts never depend on the dashboard process.
"""

from __future__ import annotations

import json
import logging
import queue
import signal
import sqlite3
import time
from typing import Any

from . import alerts, db, orders, sync, topics
from .config import Config, read_secret
from .detect import Detector
from .ewmodel import Model
from .ingest import ingest
from .sms import Sender

log = logging.getLogger(__name__)

TICK_S = 60
ORDERS_EVERY_S = 3600
RETENTION_EVERY_S = 86400


class Core:
    def __init__(self, cfg: Config, conn: sqlite3.Connection, sender: Sender,
                 model: Model | None = None) -> None:
        self.cfg = cfg
        self.conn = conn
        self.sender = sender
        self.detector = Detector(conn, cfg, model)
        self.last = {"orders": 0, "sync": 0, "retention": 0}

    def _detect(self, now: int) -> None:
        changes = self.detector.run(now)
        if alerts.queue_for(self.conn, self.cfg, changes, now):
            alerts.send_due(self.conn, self.cfg, self.sender, now)
        for c in changes:
            log.info("event %s %s %s%s", c.event_id, c.kind, c.action,
                     f" ({c.node_id})" if c.node_id else "")

    def on_message(self, topic: str, payload: bytes, now: int) -> None:
        root, area = self.cfg.mqtt.topic_root, self.cfg.area.id
        if topic == topics.status(root, area):
            try:
                state = json.loads(payload).get("state", "online")
            except (ValueError, AttributeError):
                log.warning("bad bridge status: %r", payload[:100])
                return
            db.kv_set(self.conn, "bridge_state", str(state))
            db.kv_set(self.conn, "bridge_seen", str(now))
            self._detect(now)
            return
        parsed = topics.parse(topic, root)
        if parsed is None or parsed[2] != "raw":
            return
        if parsed[0] != area:
            log.warning("ignoring data for area %s (this Pi serves %s)", parsed[0], area)
            return
        result = ingest(self.conn, self.cfg, parsed[1], payload, now)
        if result.error:
            log.warning(result.error)
        elif result.node_id is None:
            log.info("packet from unknown radio %s (assign it to a node to use it)", parsed[1])
        elif result.rejected:
            log.info("node %s: %s", result.node_id, result.rejected[:5])
        if result.accepted:
            self._detect(now)

    def tick(self, now: int) -> None:
        db.kv_set(self.conn, "core_seen", str(now))  # heartbeat for the System page
        self._detect(now)
        alerts.send_due(self.conn, self.cfg, self.sender, now)
        if now - self.last["orders"] >= ORDERS_EVERY_S:
            self.last["orders"] = now
            for oid, outcome in orders.check_orders(self.conn, self.cfg, now):
                if outcome != "waiting":
                    log.info("work order %s: %s", oid, outcome)
        if self.cfg.sync.url and now - self.last["sync"] >= self.cfg.sync.interval_s:
            self.last["sync"] = now
            r = sync.push(self.conn, self.cfg, now)
            if r.status == "ok":
                log.info("synced %s observations, %s events", r.observations, r.events)
        if now - self.last["retention"] >= RETENTION_EVERY_S:
            self.last["retention"] = now
            self._retention(now)

    def _retention(self, now: int) -> None:
        """Delete raw readings older than keep_days, but only those already in the cloud."""
        if not self.cfg.sync.url:
            return  # nothing has a second copy: keep everything
        sent = int(db.kv_get(self.conn, "sync_obs_id", "0"))
        cur = self.conn.execute("DELETE FROM observations WHERE at < ? AND id <= ?",
                                (now - self.cfg.retention.keep_days * 86400, sent))
        if cur.rowcount:
            log.info("retention: deleted %s old readings already in the cloud", cur.rowcount)

    def run_forever(self) -> None:  # pragma: no cover - exercised by the broker smoke test
        import paho.mqtt.client as mqtt

        root, area = self.cfg.mqtt.topic_root, self.cfg.area.id
        inbox: queue.Queue[tuple[str, bytes]] = queue.Queue(maxsize=10000)
        client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=f"vayu-core-{area}",
                             clean_session=False)  # broker keeps QoS 1 messages while we restart
        if self.cfg.mqtt.username:
            client.username_pw_set(self.cfg.mqtt.username,
                                   read_secret(self.cfg.mqtt.password_file))

        def on_connect(c: Any, userdata: Any, flags: Any, reason: Any, props: Any) -> None:
            log.info("MQTT connected (%s)", reason)
            c.subscribe([(f"{root}/{area}/+/raw", 1), (topics.status(root, area), 1)])

        def on_message(c: Any, userdata: Any, msg: Any) -> None:
            inbox.put((msg.topic, msg.payload))

        client.on_connect = on_connect
        client.on_message = on_message
        client.connect_async(self.cfg.mqtt.host, self.cfg.mqtt.port)
        client.loop_start()
        stop = False

        def on_term(*_: Any) -> None:
            nonlocal stop
            stop = True

        signal.signal(signal.SIGTERM, on_term)
        log.info("core running for area %s", area)
        next_tick = 0.0
        try:
            while not stop:
                try:
                    topic, payload = inbox.get(timeout=1)
                    self.on_message(topic, payload, int(time.time()))
                except queue.Empty:
                    pass
                except Exception:
                    log.exception("message handling failed")
                if time.time() >= next_tick:
                    next_tick = time.time() + TICK_S
                    try:
                        self.tick(int(time.time()))
                    except Exception:
                        log.exception("tick failed")
        finally:
            client.loop_stop()
            client.disconnect()
