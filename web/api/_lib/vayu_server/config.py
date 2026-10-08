"""Settings from one TOML file (default /etc/vayu/vayu.toml, or $VAYU_CONFIG).

Every value has a default, so a config file only lists what differs. A misspelt key or a wrong type
stops the service at start-up instead of being silently ignored.
"""

from __future__ import annotations

import dataclasses
import os
import tomllib
from dataclasses import dataclass, field
from pathlib import Path

DEFAULT_PATH = "/etc/vayu/vayu.toml"


class ConfigError(ValueError):
    pass


@dataclass
class AreaCfg:
    id: str = ""
    # Local time offset for "night" and for times in SMS (India: +5.5 h).
    utc_offset_h: float = 5.5
    tz_label: str = "IST"


@dataclass
class PathsCfg:
    db: str = "/var/lib/vayu/vayu.db"
    secret_file: str = "/var/lib/vayu/secret.key"
    outbox: str = "/var/lib/vayu/outbox.log"
    models_dir: str = "/var/lib/vayu/models"


@dataclass
class MqttCfg:
    host: str = "127.0.0.1"
    port: int = 1883
    username: str = ""
    password_file: str = ""
    topic_root: str = "vn"


@dataclass
class DetectCfg:
    # Methane: excess above baseline (ppm) that counts as a rise at one node. Tune it in the pilot
    # against false alarms per week; VayuNetra's simulated network used 25 ppm.
    rise_ppm: float = 10.0
    close_ratio: float = 0.8  # a rise ends below close_ratio x rise_ppm
    min_nodes: int = 2  # nodes that must agree within window_min ...
    sustain_readings: int = 3  # ... or consecutive readings above rise_ppm at one node
    window_min: int = 20
    clear_min: int = 30  # quiet time before an area event closes
    # Wind check
    calm_ms: float = 1.0
    downwind_deg: float = 60.0
    upwind_deg: float = 120.0
    wind_max_age_min: int = 15
    # Baseline when there is no background node: the node's own low percentile.
    baseline_hours: int = 24
    baseline_percentile: float = 10.0
    baseline_min_points: int = 12
    background_match_min: int = 15
    # Source location: virtual source radius used by the Gaussian plume (m).
    source_radius_m: float = 100.0
    grid_step_m: float = 25.0
    # Safety and health
    lel_ppm: float = 5000.0  # 10% of methane's lower explosive limit
    pm25_rise: float = 150.0  # ug/m3 above the area's cleanest node
    co_rise: float = 5.0  # ppm above the area's cleanest node
    offline_min: int = 60
    battery_low_v: float = 3.4
    battery_ok_v: float = 3.6
    bridge_timeout_min: int = 10
    disk_low_mb: int = 1024


@dataclass
class ModelCfg:
    # Early-warning model file (VayuNetra JSON MLP format). Empty = the bundled placeholder.
    early_warning: str = ""
    early_warning_enabled: bool = True
    # Site wind forecast (wind.py): "persistence", "amazon/chronos-2" (zero-shot), or
    # "vayunetra:<dir>" for VayuNetra's fine-tuned Chronos-2 (wind-model notebook output).
    wind: str = "amazon/chronos-2"
    wind_horizon_h: int = 12


@dataclass
class SmsCfg:
    backend: str = "log"  # "mmcli" on the Pi, "log" for development
    modem: str = "any"
    max_attempts: int = 3
    retry_base_s: int = 60


@dataclass
class SyncCfg:
    url: str = ""  # empty: sync off
    token_file: str = ""
    interval_s: int = 900
    batch: int = 2000
    timeout_s: int = 30


@dataclass
class OrdersCfg:
    before_days: int = 14
    after_days: int = 14
    required_drop: float = 0.5  # closing needs the downwind excess to fall by at least this share
    min_samples: int = 36  # comparable readings needed in each window


@dataclass
class RetentionCfg:
    keep_days: int = 400  # raw readings older than this are deleted once synced


@dataclass
class WebCfg:
    host: str = "127.0.0.1"
    port: int = 8080
    # Base map. With a Mapbox public token (pk.…) in mapbox_token_file the map offers Mapbox
    # outdoors and satellite layers; without one it uses the OpenStreetMap tiles below.
    mapbox_token_file: str = ""
    mapbox_styles: str = "mapbox/outdoors-v12,mapbox/satellite-streets-v12"
    tile_url: str = "https://tile.openstreetmap.org/{z}/{x}/{y}.png"
    tile_attribution: str = "&copy; OpenStreetMap contributors"
    https_only: bool = False


@dataclass
class Config:
    area: AreaCfg = field(default_factory=AreaCfg)
    paths: PathsCfg = field(default_factory=PathsCfg)
    mqtt: MqttCfg = field(default_factory=MqttCfg)
    detect: DetectCfg = field(default_factory=DetectCfg)
    model: ModelCfg = field(default_factory=ModelCfg)
    sms: SmsCfg = field(default_factory=SmsCfg)
    sync: SyncCfg = field(default_factory=SyncCfg)
    orders: OrdersCfg = field(default_factory=OrdersCfg)
    retention: RetentionCfg = field(default_factory=RetentionCfg)
    web: WebCfg = field(default_factory=WebCfg)

    @classmethod
    def for_area(cls, area_id: str) -> Config:
        cfg = cls()
        cfg.area.id = area_id
        return cfg


SMS_BACKENDS = ("log", "mmcli")


def _type_ok(default: object, value: object) -> bool:
    if isinstance(default, bool):
        return isinstance(value, bool)
    if isinstance(value, bool):  # bool is an int in Python; never accept it for a number
        return False
    if isinstance(default, float):
        return isinstance(value, (int, float))
    return isinstance(value, type(default))


def _fill(section_name: str, target: object, values: dict) -> None:
    known = {f.name for f in dataclasses.fields(target)}
    for key, value in values.items():
        if key not in known:
            raise ConfigError(f"unknown setting {section_name}.{key}")
        default = getattr(target, key)
        if not _type_ok(default, value):
            raise ConfigError(
                f"{section_name}.{key} must be {type(default).__name__}, got {value!r}"
            )
        setattr(target, key, float(value) if isinstance(default, float) else value)


def load_config(path: str | os.PathLike | None = None) -> Config:
    path = Path(path or os.environ.get("VAYU_CONFIG") or DEFAULT_PATH)
    try:
        data = tomllib.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as e:
        raise ConfigError(f"config file not found: {path}") from e
    except tomllib.TOMLDecodeError as e:
        raise ConfigError(f"{path}: {e}") from e
    cfg = Config()
    for section, values in data.items():
        if not hasattr(cfg, section) or not isinstance(values, dict):
            raise ConfigError(f"unknown section [{section}]")
        _fill(section, getattr(cfg, section), values)
    if not cfg.area.id:
        raise ConfigError("area.id is required (it must match the imported site survey)")
    if cfg.sms.backend not in SMS_BACKENDS:
        raise ConfigError(f"sms.backend must be one of {SMS_BACKENDS}")
    return cfg


def read_secret(path: str) -> str:
    """A secret kept in its own file (password, token); empty path means none."""
    return Path(path).read_text(encoding="utf-8").strip() if path else ""
