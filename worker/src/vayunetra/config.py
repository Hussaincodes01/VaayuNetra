"""Worker settings from the environment (worker/.env; see worker/.env.example)."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

_SOURCE_DIR = Path(__file__).resolve().parents[2]
# Source checkout: worker/ (holds pyproject.toml). Installed package (Docker): the working directory.
WORKER_DIR = _SOURCE_DIR if (_SOURCE_DIR / "pyproject.toml").exists() else Path.cwd()
REPO_ROOT = WORKER_DIR.parent


def _load_dotenv() -> None:
    try:
        from dotenv import load_dotenv
    except ImportError:  # optional: plain environment variables work too
        return
    for candidate in (Path.cwd() / ".env", WORKER_DIR / ".env"):
        if candidate.exists():
            load_dotenv(candidate, override=False)


def _resolve(path: str | None) -> Path | None:
    """Relative paths in .env are relative to the worker directory, like the .env file itself."""
    if not path:
        return None
    p = Path(path).expanduser()
    return p if p.is_absolute() else (WORKER_DIR / p).resolve()


@dataclass(frozen=True)
class Settings:
    ee_project: str | None
    ee_service_account: str | None
    ee_key_file: Path | None
    supabase_url: str | None
    supabase_service_role_key: str | None
    model_zip: Path | None
    device: str
    monitor_cron: str
    worker_id: str
    sentry_dsn: str | None
    cache_dir: Path

    @classmethod
    def from_env(cls) -> Settings:
        _load_dotenv()
        env = os.environ.get
        return cls(
            ee_project=env("EE_PROJECT") or None,
            ee_service_account=env("EE_SERVICE_ACCOUNT") or None,
            ee_key_file=_resolve(env("EE_KEY_FILE")),
            supabase_url=(env("SUPABASE_URL") or "").rstrip("/") or None,
            supabase_service_role_key=env("SUPABASE_SERVICE_ROLE_KEY") or None,
            model_zip=_resolve(env("VAYU_MODEL_ZIP")),
            device=env("VAYU_DEVICE", "auto") or "auto",
            monitor_cron=env("VAYU_MONITOR_CRON", "0 3 * * *") or "0 3 * * *",
            worker_id=env("WORKER_ID", "vayunetra-worker") or "vayunetra-worker",
            sentry_dsn=env("SENTRY_DSN") or None,
            cache_dir=_resolve(env("VAYU_CACHE_DIR")) or (WORKER_DIR / "cache"),
        )
