# VayuNetra web

Next.js 15 (App Router) site and dashboard. English is served at `/`, Hindi at `/hi`
(next-intl; strings live in `messages/`).

```bash
pnpm install
cp .env.example .env.local   # fill in values
pnpm dev                     # http://localhost:3000
pnpm lint && pnpm typecheck && pnpm build
```

Deployed on Vercel with the project root set to `web/`. See the root README for the full system.

## Ground network (`/dashboard/ground`)

The ground-network section shows the full flow from a satellite flag to a confirmed fix, a live
simulation of a site's node network on a 3D map, the node hardware and fabrication files, the
wind forecast and the satellite re-run. Its data comes from the sibling projects (Vayu-node
firmware, Vayu-server Pi software), exported by `Vayu-server/tools/export_web.py`:

- `public/ground/` holds site plans, results JSON, the firmware simulator (`vn_sim.wasm`, the node
  firmware compiled to WebAssembly), the node and carrier models in `3d/` and fabrication files
  in `fab/`.
- `api/ground.py` is a Python Vercel Function running the Pi's own code (vendored in
  `api/_lib/vayu_server`; only `pydantic`, from `requirements.txt`). It replays the simulated
  gateway's lines through ingest, detection and SMS, and runs the circuit models.

Locally, run `python scripts/ground-api-dev.py` beside `pnpm dev`; development rewrites
`/api/ground` to it.
