"""Command-line entry point: ``vayu``.

vayu scan --site deonar              scan a landfill and its control point, upload to Supabase
vayu monitor                         scan new passes at every active site
vayu backfill --from 2024-01-01      scan everything from a date
vayu dossier --site deonar           rebuild a site dossier (HTML + PDF) in the dossiers bucket
vayu worker                          heartbeat, job queue and scheduled monitoring
"""

from __future__ import annotations

import argparse
import logging
from collections.abc import Sequence

from vayunetra import __version__


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="vayu",
        description="VayuNetra worker: Sentinel-2 methane screening for Indian landfills.",
    )
    parser.add_argument("--version", action="version", version=f"%(prog)s {__version__}")
    parser.add_argument("-v", "--verbose", action="store_true", help="debug logging")
    sub = parser.add_subparsers(dest="command", metavar="command")

    p = sub.add_parser("scan", help="scan one landfill and its control point")
    p.add_argument("--site", required=True, help="site slug, e.g. deonar")
    p.add_argument("--from", dest="date_from", default=None, help="start date (default 2024-01-01)")
    p.add_argument("--to", dest="date_to", default=None, help="end date (default 2025-12-31)")
    p.add_argument("--no-upload", action="store_true", help="print results, write nothing to Supabase")
    p.add_argument("--offline", action="store_true", help="use cached passes and chips only")

    sub.add_parser("monitor", help="scan passes newer than the last stored pass at every active site")

    p = sub.add_parser("backfill", help="scan every site from a date")
    p.add_argument("--from", dest="date_from", required=True, help="start date, e.g. 2024-01-01")
    p.add_argument("--to", dest="date_to", default=None, help="end date (default today)")

    p = sub.add_parser("dossier", help="rebuild a site dossier in the dossiers bucket")
    p.add_argument("--site", required=True)

    p = sub.add_parser("worker", help="run the worker loop (no inbound ports)")
    p.add_argument("--health-port", type=int, default=None, help="serve GET /health on 127.0.0.1:PORT")
    p.add_argument("--poll", type=int, default=30, help="seconds between job polls (default 30)")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if args.command is None:
        parser.print_help()
        return 0

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    # Heavy imports (torch, Earth Engine) only once a command actually runs.
    from vayunetra.config import Settings
    from vayunetra.sync import SupabaseError

    try:
        return _run(args, Settings.from_env())
    except (FileNotFoundError, SupabaseError, ValueError) as e:
        print(f"vayu {args.command}: error: {e}")
        return 1


def _run(args: argparse.Namespace, settings) -> int:
    from vayunetra import main as app
    from vayunetra.pipeline import END, START

    if args.command == "worker":
        app.run_worker(settings, health_port=args.health_port, poll_s=args.poll)
        return 0

    offline = getattr(args, "offline", False)
    upload = not getattr(args, "no_upload", False)
    rt = app.build_runtime(settings, offline=offline, need_supabase=upload)
    if args.command == "scan":
        results = app.scan(rt, args.site, args.date_from or START, args.date_to or END, upload=upload, echo=print)
        for r in results:
            row = r.row
            if row["detected"]:
                print(
                    f"  {row['site']} {row['date']} {row['tier']} score={row['scene_score']} "
                    f"q_kgph={row['q_kgph']} q_med={row.get('q_med')} (screening-grade)"
                )
    elif args.command == "monitor":
        app.monitor(rt, echo=print)
    elif args.command == "backfill":
        app.backfill(rt, args.date_from, args.date_to, echo=print)
    elif args.command == "dossier":
        app.rebuild_dossier(rt, args.site, echo=print)
    return 0
