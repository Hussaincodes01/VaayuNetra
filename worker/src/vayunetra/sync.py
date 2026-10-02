"""Supabase sync over PostgREST and Storage with the service-role key.

Every write is idempotent: scans upsert on (site_id, pass_date, model_version), evidence on scan_id,
and images go to deterministic Storage paths with x-upsert, so re-running a scan overwrites in place.
"""

from __future__ import annotations

import datetime as dt
import json
import math
import time
from collections.abc import Mapping, Sequence
from typing import Any

import httpx

EVIDENCE_BUCKET = "evidence"
DOSSIER_BUCKET = "dossiers"

SCAN_COLUMNS = (
    "site_id", "pass_date", "overpass_utc", "satellite", "sza", "vza", "scene_score", "detected", "tier",
    "surface_kind", "q_kgph", "q_med", "q_lo", "q_hi", "u10", "wind_u", "wind_v", "d_b12", "d_b11",
    "d_visnir", "elong", "axis_vs_wind", "src_dist_m", "threshold_used", "model_version",
)  # fmt: skip


def _clean(v: Any) -> Any:
    """JSON-safe value: NaN/inf -> null, numpy scalars -> Python, dates -> ISO."""
    if v is None:
        return None
    if hasattr(v, "item") and not isinstance(v, (str, bytes)):
        v = v.item()
    if isinstance(v, float) and not math.isfinite(v):
        return None
    if isinstance(v, (dt.date, dt.datetime)):
        return v.isoformat()
    return v


def scan_record(row: Mapping[str, Any], site_id: str, threshold: float, model_version: str) -> dict[str, Any]:
    """Map a pipeline row (notebook column names) onto the scans table."""
    tier = row.get("tier", "-")
    rec = {
        "site_id": site_id,
        "pass_date": row["date"],
        "overpass_utc": dt.datetime.fromtimestamp(int(row["t_ms"]) / 1000, tz=dt.UTC),
        "satellite": row.get("sat"),
        "sza": row.get("sza"),
        "vza": row.get("vza"),
        "scene_score": row["scene_score"],
        "detected": bool(row["detected"]),
        "tier": "none" if tier in ("-", "", None) else tier,
        "surface_kind": row.get("surface_kind") or None,
        "q_kgph": row.get("q_kgph"),
        "q_med": row.get("q_med"),
        "q_lo": row.get("q_lo"),
        "q_hi": row.get("q_hi"),
        "u10": row.get("u10"),
        "wind_u": row.get("u"),
        "wind_v": row.get("v"),
        "d_b12": row.get("dB12"),
        "d_b11": row.get("dB11"),
        "d_visnir": row.get("dVisNIR"),
        "elong": row.get("elong"),
        "axis_vs_wind": row.get("axis_vs_wind"),
        "src_dist_m": row.get("src_dist_m"),
        "threshold_used": threshold,
        "model_version": model_version,
    }
    return {k: _clean(rec[k]) for k in SCAN_COLUMNS}


class SupabaseError(RuntimeError):
    pass


class Supabase:
    def __init__(self, url: str, service_role_key: str, timeout: float = 60.0) -> None:
        if not url or not service_role_key:
            raise SupabaseError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required")
        self.url = url.rstrip("/")
        self._http = httpx.Client(
            timeout=timeout,
            headers={"apikey": service_role_key, "Authorization": f"Bearer {service_role_key}"},
        )

    def close(self) -> None:
        self._http.close()

    # --- transport ---------------------------------------------------------------------------

    def _request(self, method: str, path: str, attempts: int = 4, **kw: Any) -> httpx.Response:
        for k in range(attempts):
            try:
                res = self._http.request(method, f"{self.url}{path}", **kw)
            except httpx.TransportError as e:
                if k == attempts - 1:
                    raise SupabaseError(f"{method} {path}: {e!r}") from e
            else:
                if res.status_code < 500 and res.status_code != 429:
                    if res.is_error:
                        raise SupabaseError(f"{method} {path}: {res.status_code} {res.text[:500]}")
                    return res
                if k == attempts - 1:
                    raise SupabaseError(f"{method} {path}: {res.status_code} {res.text[:500]}")
            time.sleep(2 * 2**k)
        raise AssertionError("unreachable")

    def _rest(self, method: str, table: str, params: Mapping[str, str] | None = None,
              body: Any = None, prefer: str | None = None) -> list[dict[str, Any]]:  # fmt: skip
        headers = {"Content-Type": "application/json"}
        if prefer:
            headers["Prefer"] = prefer
        res = self._request(method, f"/rest/v1/{table}", params=params,
                            content=None if body is None else json.dumps(body, default=_clean),
                            headers=headers)  # fmt: skip
        return res.json() if res.content else []

    # --- tables ------------------------------------------------------------------------------

    def select(self, table: str, **params: str) -> list[dict[str, Any]]:
        return self._rest("GET", table, params=params)

    def upsert(self, table: str, rows: Sequence[Mapping[str, Any]], on_conflict: str,
               ignore_duplicates: bool = False) -> list[dict[str, Any]]:  # fmt: skip
        out: list[dict[str, Any]] = []
        resolution = "ignore-duplicates" if ignore_duplicates else "merge-duplicates"
        for i in range(0, len(rows), 500):
            out += self._rest("POST", table, params={"on_conflict": on_conflict},
                              body=list(rows[i : i + 500]),
                              prefer=f"resolution={resolution},return=representation")  # fmt: skip
        return out

    def update(self, table: str, filters: Mapping[str, str], values: Mapping[str, Any]) -> list[dict[str, Any]]:
        return self._rest("PATCH", table, params=dict(filters), body=values, prefer="return=representation")

    def settings(self) -> dict[str, Any]:
        return {r["key"]: r["value"] for r in self.select("settings", select="key,value")}

    def sites(self, active_only: bool = True) -> list[dict[str, Any]]:
        params = {"select": "*", "order": "kind,slug"}
        if active_only:
            params["active"] = "eq.true"
        return self.select("site_locations", **params)

    def last_pass_date(self, site_id: str, model_version: str) -> dt.date | None:
        """Latest scanned pass date at a site for this model version."""
        rows = self.select("scans", select="pass_date", site_id=f"eq.{site_id}",
                           model_version=f"eq.{model_version}", order="pass_date.desc", limit="1")  # fmt: skip
        return dt.date.fromisoformat(rows[0]["pass_date"]) if rows else None

    def upsert_scans(self, records: Sequence[Mapping[str, Any]]) -> list[dict[str, Any]]:
        return self.upsert("scans", records, "site_id,pass_date,model_version")

    def upsert_evidence(self, record: Mapping[str, Any]) -> None:
        self.upsert("evidence", [record], "scan_id")

    # --- storage -----------------------------------------------------------------------------

    def upload(self, bucket: str, path: str, data: bytes, content_type: str) -> str:
        """Upload (overwriting) and return the public URL."""
        self._request("POST", f"/storage/v1/object/{bucket}/{path}", content=data,
                      headers={"Content-Type": content_type, "x-upsert": "true",
                               "Cache-Control": "max-age=3600"})  # fmt: skip
        return self.public_url(bucket, path)

    def public_url(self, bucket: str, path: str) -> str:
        return f"{self.url}/storage/v1/object/public/{bucket}/{path}"

    # --- worker bookkeeping ------------------------------------------------------------------

    def heartbeat(self, worker_id: str, version: str, device: str, queue_depth: int) -> None:
        self.upsert("worker_heartbeat", [{
            "worker_id": worker_id, "last_seen": dt.datetime.now(dt.UTC).isoformat(),
            "version": version, "device": device, "queue_depth": queue_depth,
        }], "worker_id")  # fmt: skip

    def queued_jobs(self) -> list[dict[str, Any]]:
        return self.select("jobs", select="*", status="eq.queued", order="created_at.asc")

    def enqueue_job(self, kind: str, site_id: str | None = None, params: Mapping[str, Any] | None = None) -> None:
        self._rest("POST", "jobs", body=[{"kind": kind, "site_id": site_id, "params": dict(params or {})}])

    def claim_job(self, job_id: str) -> dict[str, Any] | None:
        """queued -> running, only if still queued (another worker may have taken it)."""
        rows = self.update("jobs", {"id": f"eq.{job_id}", "status": "eq.queued"},
                           {"status": "running", "started_at": dt.datetime.now(dt.UTC).isoformat()})  # fmt: skip
        return rows[0] if rows else None

    def set_job_log(self, job_id: str, log_text: str) -> None:
        self.update("jobs", {"id": f"eq.{job_id}"}, {"log": log_text})

    def finish_job(self, job_id: str, status: str, log_text: str) -> None:
        self.update("jobs", {"id": f"eq.{job_id}"}, {
            "status": status, "log": log_text, "finished_at": dt.datetime.now(dt.UTC).isoformat(),
        })  # fmt: skip


def evidence_path(site_slug: str, pass_date: Any, model_version: str, name: str) -> str:
    return f"{site_slug}/{pass_date}_{model_version}/{name}"
