"""MQTT topics, one per node and direction (AIMNET's per-device topic design).

    {root}/{area}/{radio_id}/raw       bridge -> core     node readings (JSON)
    {root}/{area}/{radio_id}/cmd       web -> bridge      settings for a node (JSON, retained)
    {root}/_bridge/{area}/status       bridge -> core     {"state": "online"|"offline"} (retained,
                                                          "offline" is the bridge's last will)
"""

from __future__ import annotations


def raw(root: str, area: str, radio_id: str) -> str:
    return f"{root}/{area}/{radio_id}/raw"


def cmd(root: str, area: str, radio_id: str) -> str:
    return f"{root}/{area}/{radio_id}/cmd"


def status(root: str, area: str) -> str:
    return f"{root}/_bridge/{area}/status"


def parse(topic: str, root: str) -> tuple[str, str, str] | None:
    """(area, radio_id, kind) for a node topic, else None."""
    parts = topic.split("/")
    if len(parts) != 4 or parts[0] != root or parts[1] == "_bridge":
        return None
    return parts[1], parts[2], parts[3]
