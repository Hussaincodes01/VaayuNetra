"""Optional local health endpoint (FastAPI), bound to 127.0.0.1 only: GET /health."""

from __future__ import annotations

import threading
from collections.abc import Mapping
from typing import Any

from vayunetra import __version__


def create_app(state: Mapping[str, Any], worker_id: str):
    from fastapi import FastAPI

    app = FastAPI(title="VayuNetra worker", version=__version__, docs_url=None, redoc_url=None)

    @app.get("/health")
    def health() -> dict[str, Any]:
        return {"status": "ok", "worker_id": worker_id, "version": __version__, **dict(state)}

    return app


def serve_health(state: Mapping[str, Any], worker_id: str, port: int) -> threading.Thread:
    import uvicorn

    config = uvicorn.Config(create_app(state, worker_id), host="127.0.0.1", port=port, log_level="warning")
    server = uvicorn.Server(config)
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    return thread
