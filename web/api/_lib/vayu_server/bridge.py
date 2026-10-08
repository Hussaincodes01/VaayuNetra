"""Radio bridge: LoRa radio on USB -> local MQTT. The only code that knows about the radio.

It starts as a Meshtastic adapter (a Heltec V3 or similar on USB). It accepts two kinds of packet:

  PRIVATE_APP     JSON from VayuNetra node firmware. Compact keys keep a reading in one LoRa packet:
                  {"r": [{"t": 1759900200, "rs": 0.8213, "T": 29.41, "h": 71.2, "p": 1007.92,
                          "pm": 85.1, "co": 0.42, "b": 3.96}]}
                  Full names ({"readings": [{"at": ..., "rs_ratio": ...}]}) are accepted too.
  TELEMETRY_APP   Meshtastic's standard environment, air-quality and device telemetry, so
                  off-the-shelf Meshtastic sensor boards work without custom firmware.

When the node redesign settles on a different radio stack, only this module changes.
"""

from __future__ import annotations

import json
import logging
import re
import time
from typing import Any

from . import topics
from .config import Config, read_secret

log = logging.getLogger(__name__)

SHORT = {"t": "at", "rs": "rs_ratio", "n": "ndir_ppm", "c": "ch4_ppm", "T": "temp_c",
         "h": "rh_pct", "p": "pressure_hpa", "pm": "pm25_ugm3", "co": "co_ppm", "ws": "wind_ms",
         "wd": "wind_from_deg", "b": "battery_v", "s": "solar_v"}
TELEMETRY = {
    "environmentMetrics": {"temperature": "temp_c", "relativeHumidity": "rh_pct",
                           "barometricPressure": "pressure_hpa", "windSpeed": "wind_ms",
                           "windDirection": "wind_from_deg"},
    "airQualityMetrics": {"pm25Environmental": "pm25_ugm3"},
    "deviceMetrics": {"voltage": "battery_v"},
}
HEARTBEAT_S = 60


class DecodeError(ValueError):
    pass


def decode_node_payload(raw: bytes) -> list[dict[str, Any]]:
    try:
        body = json.loads(raw)
    except (ValueError, UnicodeDecodeError) as e:
        raise DecodeError("payload is not JSON") from e
    if not isinstance(body, dict):
        raise DecodeError("payload is not a JSON object")
    readings = body.get("r", body.get("readings"))
    if not isinstance(readings, list) or not readings:
        raise DecodeError("payload has no readings")
    out = []
    for r in readings:
        if not isinstance(r, dict):
            raise DecodeError("reading is not an object")
        out.append({SHORT.get(k, k): v for k, v in r.items()})
    return out


def _telemetry(t: dict[str, Any]) -> dict[str, Any] | None:
    reading: dict[str, Any] = {}
    for group, names in TELEMETRY.items():
        for src, dst in names.items():
            value = (t.get(group) or {}).get(src)
            if value is not None:
                reading[dst] = value
    aq = t.get("airQualityMetrics") or {}
    if "pm25_ugm3" not in reading and aq.get("pm25Standard") is not None:
        reading["pm25_ugm3"] = aq["pm25Standard"]
    if not reading:
        return None
    return {"at": t["time"], **reading} if t.get("time") else reading


def packet_to_message(packet: dict[str, Any]) -> tuple[str, str] | None:
    """(radio_id, JSON body for the raw topic), or None for packets that carry no readings."""
    radio_id = packet.get("fromId")
    decoded = packet.get("decoded") or {}
    if not radio_id:
        return None
    port = decoded.get("portnum")
    if port == "PRIVATE_APP":
        try:
            readings = decode_node_payload(decoded.get("payload") or b"")
        except DecodeError as e:
            log.warning("bad packet from %s: %s", radio_id, e)
            return None
    elif port == "TELEMETRY_APP":
        reading = _telemetry(decoded.get("telemetry") or {})
        if reading is None:
            return None
        readings = [reading]
    else:
        return None
    radio: dict[str, Any] = {}
    if packet.get("rxRssi") is not None:
        radio["rssi"] = packet["rxRssi"]
    if packet.get("rxSnr") is not None:
        radio["snr"] = packet["rxSnr"]
    if packet.get("hopStart") is not None and packet.get("hopLimit") is not None:
        radio["hops"] = packet["hopStart"] - packet["hopLimit"]
    body: dict[str, Any] = {"readings": readings}
    if radio:
        body["radio"] = radio
    return radio_id, json.dumps(body)


RADIO_ID = re.compile(r"^![0-9a-f]{8}$")


def gateway_line_to_message(line: str) -> tuple[str, str, int | None] | None:
    """One line from the VayuNetra gateway firmware (Vayu-node, a Heltec on USB with gateway = 1)
    -> (radio_id, body for the raw topic, the gateway's receive time). Status lines and anything
    without readings give None.

        {"from":"!56020406","type":"data","id":7,"hops":1,"rssi":-97.5,"snr":6.5,"rx":1736143185,
         "payload":{"r":[{"t":1736143185,"rs":1.3067,...}],"e":0,"q":17}}
    """
    try:
        msg = json.loads(line)
    except ValueError:
        return None
    if not isinstance(msg, dict) or not isinstance(msg.get("payload"), dict):
        return None
    radio_id = msg.get("from")
    if not isinstance(radio_id, str) or not RADIO_ID.match(radio_id):
        return None
    payload = msg["payload"]
    try:
        readings = decode_node_payload(json.dumps(payload).encode())
    except DecodeError as e:
        log.warning("bad packet from %s: %s", radio_id, e)
        return None
    body: dict[str, Any] = {"readings": readings}
    radio = {k: msg[k] for k in ("rssi", "snr", "hops")
             if isinstance(msg.get(k), (int, float)) and not isinstance(msg.get(k), bool)}
    if radio:
        body["radio"] = radio
    body["node"] = {"event": payload.get("e"), "seq": payload.get("q"),
                    "packet": msg.get("type")}
    rx = msg.get("rx")
    return radio_id, json.dumps(body), rx if isinstance(rx, int) else None


def run_gateway_bridge(cfg: Config, port: str) -> None:  # pragma: no cover - needs the radio
    """Bridge for the VayuNetra gateway firmware on a serial port (115200 baud): JSON lines in,
    commands and the time out. Install the gateway extra (pyserial)."""
    import paho.mqtt.client as mqtt
    import serial

    root, area = cfg.mqtt.topic_root, cfg.area.id
    status_topic = topics.status(root, area)
    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=f"vayu-bridge-{area}")
    if cfg.mqtt.username:
        client.username_pw_set(cfg.mqtt.username, read_secret(cfg.mqtt.password_file))
    client.will_set(status_topic, json.dumps({"state": "offline"}), qos=1, retain=True)
    link = serial.Serial(port, 115200, timeout=1)

    def write(obj: dict[str, Any]) -> None:
        link.write((json.dumps(obj, separators=(",", ":")) + "\n").encode())

    def on_connect(c: Any, *_: Any) -> None:
        c.subscribe(f"{root}/{area}/+/cmd", qos=1)

    def on_command(c: Any, userdata: Any, msg: Any) -> None:
        parsed = topics.parse(msg.topic, root)
        if parsed is None or not msg.payload:
            return
        try:
            cmd = json.loads(msg.payload)
        except ValueError:
            return
        if isinstance(cmd, dict) and RADIO_ID.match(parsed[1]):
            write({"to": parsed[1], "cmd": cmd})

    client.on_connect = on_connect
    client.on_message = on_command
    client.connect_async(cfg.mqtt.host, cfg.mqtt.port)
    client.loop_start()
    log.info("gateway bridge running for area %s on %s", area, port)
    next_beat = 0.0
    try:
        while True:
            if time.time() >= next_beat:
                next_beat = time.time() + HEARTBEAT_S
                write({"time": int(time.time())})  # the gateway's clock, beaconed to the nodes
                client.publish(status_topic, json.dumps({"state": "online",
                                                         "at": int(time.time())}),
                               qos=1, retain=True)
            raw = link.readline()
            if not raw:
                continue
            msg = gateway_line_to_message(raw.decode("utf-8", "replace").strip())
            if msg is not None:
                client.publish(topics.raw(root, area, msg[0]), msg[1], qos=1)
    finally:
        client.publish(status_topic, json.dumps({"state": "offline"}), qos=1, retain=True)
        client.loop_stop()
        link.close()


def run_bridge(cfg: Config, port: str | None) -> None:  # pragma: no cover - needs the radio
    """Run until the radio disconnects; systemd restarts it."""
    import meshtastic.serial_interface
    import paho.mqtt.client as mqtt
    from pubsub import pub

    try:
        from meshtastic.protobuf import portnums_pb2
    except ImportError:
        from meshtastic import portnums_pb2

    root, area = cfg.mqtt.topic_root, cfg.area.id
    status_topic = topics.status(root, area)
    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=f"vayu-bridge-{area}")
    if cfg.mqtt.username:
        client.username_pw_set(cfg.mqtt.username, read_secret(cfg.mqtt.password_file))
    client.will_set(status_topic, json.dumps({"state": "offline"}), qos=1, retain=True)
    iface = meshtastic.serial_interface.SerialInterface(devPath=port)
    lost = False

    def on_connect(c: Any, *_: Any) -> None:
        c.subscribe(f"{root}/{area}/+/cmd", qos=1)
        c.publish(status_topic, json.dumps({"state": "online", "at": int(time.time())}),
                  qos=1, retain=True)

    def on_command(c: Any, userdata: Any, msg: Any) -> None:
        parsed = topics.parse(msg.topic, root)
        if parsed is None or not msg.payload:
            return
        _, radio_id, _ = parsed
        log.info("command to %s: %s", radio_id, msg.payload[:200])
        iface.sendData(msg.payload, destinationId=radio_id,
                       portNum=portnums_pb2.PortNum.PRIVATE_APP, wantAck=True)

    def on_receive(packet: dict[str, Any], interface: Any) -> None:
        msg = packet_to_message(packet)
        if msg is not None:
            client.publish(topics.raw(root, area, msg[0]), msg[1], qos=1)

    def on_lost(interface: Any) -> None:
        nonlocal lost
        lost = True

    client.on_connect = on_connect
    client.on_message = on_command
    pub.subscribe(on_receive, "meshtastic.receive")
    pub.subscribe(on_lost, "meshtastic.connection.lost")
    client.connect_async(cfg.mqtt.host, cfg.mqtt.port)
    client.loop_start()
    log.info("bridge running for area %s on %s", area, port or "the first radio found")
    try:
        next_beat = 0.0
        while not lost:
            if time.time() >= next_beat:
                next_beat = time.time() + HEARTBEAT_S
                client.publish(status_topic, json.dumps({"state": "online",
                                                         "at": int(time.time())}),
                               qos=1, retain=True)
            time.sleep(1)
    finally:
        client.publish(status_topic, json.dumps({"state": "offline"}), qos=1, retain=True)
        client.loop_stop()
        iface.close()
    raise SystemExit("radio connection lost")
