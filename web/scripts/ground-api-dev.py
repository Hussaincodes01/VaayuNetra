"""Serve api/ground.py on http://127.0.0.1:8787 for `pnpm dev` (next.config.ts rewrites /api/ground
to it in development; on Vercel the file runs as a Python function).

    python scripts/ground-api-dev.py
"""

import importlib.util
from http.server import ThreadingHTTPServer
from pathlib import Path

spec = importlib.util.spec_from_file_location("ground", Path(__file__).parents[1] / "api" / "ground.py")
ground = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ground)

if __name__ == "__main__":
    server = ThreadingHTTPServer(("127.0.0.1", 8787), ground.handler)
    print("api/ground.py on http://127.0.0.1:8787/api/ground")
    server.serve_forever()
