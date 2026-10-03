"""Job dispatch: the dashboard's "Request scan" must only add new passes, never rescan history."""

from types import SimpleNamespace

import pytest

from vayunetra import main as app


class FakeSupabase:
    def __init__(self) -> None:
        self.finished: list[tuple[str, str]] = []

    def finish_job(self, job_id: str, status: str, log: str) -> None:
        self.finished.append((job_id, status))


@pytest.fixture
def calls(monkeypatch: pytest.MonkeyPatch) -> list[tuple]:
    seen: list[tuple] = []
    site = SimpleNamespace(id="site-1", slug="deonar")
    monkeypatch.setattr(app, "load_sites", lambda rt: [site])
    monkeypatch.setattr(app, "scan_new", lambda rt, slug, echo=None: seen.append(("new", slug)) or [])
    monkeypatch.setattr(app, "scan", lambda rt, slug, start, end, **kw: seen.append(("window", slug, start, end)) or [])
    return seen


def test_scan_site_without_dates_scans_only_new_passes(calls: list[tuple]) -> None:
    rt = SimpleNamespace(supabase=FakeSupabase())
    app.run_job(rt, {"id": "job-1", "kind": "scan_site", "site_id": "site-1", "params": {}})
    assert calls == [("new", "deonar")]
    assert rt.supabase.finished == [("job-1", "done")]


def test_scan_site_with_dates_rescans_that_window(calls: list[tuple]) -> None:
    rt = SimpleNamespace(supabase=FakeSupabase())
    job = {"id": "job-2", "kind": "scan_site", "site_id": "site-1",
           "params": {"start": "2024-01-01", "end": "2025-12-31"}}  # fmt: skip
    app.run_job(rt, job)
    assert calls == [("window", "deonar", "2024-01-01", "2025-12-31")]
    assert rt.supabase.finished == [("job-2", "done")]
