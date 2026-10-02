# VayuNetra worker

Python 3.11 package `vayunetra` with the `vayu` command. It is a port of
`notebooks/vayunetra_ops.ipynb` with the same functions, constants and thresholds. It runs on the
team's own GPU/CPU machine, pulls Sentinel-2 passes and ERA5-Land wind through Earth Engine, runs the
model and physics gate, and writes scans, evidence images and plume polygons to Supabase with the
service-role key. That key never leaves this machine. The worker makes outbound connections only.

| Module            | Notebook cells | What it does                                                                                      |
| ----------------- | -------------- | ------------------------------------------------------------------------------------------------- |
| `model.py`        | 3, 4           | Find and unzip the model zip, verify SHA256, build the smp U-Net, `predict()` with 4-flip TTA       |
| `physics.py`      | 4, 6, 9, 11    | LUT, MBMP retrieval, model input, IME rate, physics gate, tiers, Monte Carlo `quantify()`           |
| `earth_engine.py` | 5              | Service-account auth, pass lists, 2 km chips (disk cache), `usable()`, ERA5-Land wind, retries      |
| `pipeline.py`     | 6, 7, 16       | `run_scene`, `scan_site(target_after=...)`, controls, threshold from Supabase settings              |
| `outputs.py`      | 12, 13         | Evidence PNGs, plume GeoJSON (WGS84), chip corner coordinates, action plan, dossier HTML → PDF      |
| `sync.py`         |                | Idempotent upserts to `scans` / `evidence`, uploads to the `evidence` and `dossiers` buckets        |
| `main.py`, `cli.py` | 16           | `vayu scan`, `monitor`, `backfill`, `dossier`, `worker`                                             |

Every rate the worker produces is screening-grade. Confirm it with a hyperspectral satellite, an OGI
drone or a ground survey before enforcement or carbon crediting.

## Setup

```bash
cd worker
uv sync --extra ee --extra api --extra pdf     # base + Earth Engine + health endpoint + PDF dossiers
uv pip install torch --index-url https://download.pytorch.org/whl/cu126   # or .../whl/cpu
uv pip install "segmentation-models-pytorch>=0.3.3"
uv run playwright install chromium             # only for PDF dossiers
cp .env.example .env
```

Then:

1. Put the Earth Engine service-account key at `worker/secrets/ee-key.json` (gitignored). The account
   needs Earth Engine access on the `EE_PROJECT` Google Cloud project.
2. Put `vayunetra_best_model_20261001_1401.zip` in `models/` at the repo root. The worker looks at
   `VAYU_MODEL_ZIP` first, then `./models`, `worker/models` and `<repo>/models`.
3. Fill `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in `.env`, and seed the database once
   (`node supabase/seed.ts --remote` from the repo root) so the `sites` table exists.

Optional variables not in `.env.example`: `VAYU_CACHE_DIR` (default `worker/cache`) and
`VAYU_AMP=off` to run CUDA inference in full fp32.

## Commands

```bash
vayu scan --site deonar                  # Deonar and its control point, 2024-01-01 → 2025-12-31, uploads results
vayu scan --site deonar --no-upload      # print only; also fills the chip cache
vayu monitor                             # passes newer than the last stored pass, every active site
vayu backfill --from 2024-01-01          # every site from a date to today
vayu dossier --site deonar               # rebuild the site dossier in the dossiers bucket
vayu worker --health-port 8787           # long-running loop (below)
```

`vayu worker` sends a heartbeat to `worker_heartbeat` every 60 s, polls `jobs` every 30 s, and
queues a `monitor_all` job on `VAYU_MONITOR_CRON`, evaluated in IST (03:00 daily by default).
Each job moves `queued → running → done | failed` and its log is written to `jobs.log`.
`--health-port` serves `GET /health` on 127.0.0.1 only.

Re-running a scan is safe. Scans upsert on `(site_id, pass_date, model_version)`, evidence on
`scan_id`, and images go to fixed paths `evidence/<site>/<date>_<model_version>/` with overwrite.

## Tests

```bash
uv run ruff check . && uv run ruff format --check .
uv run pytest                     # physics on synthetic injected plumes + field-test tier replay
uv run pytest -m parity           # the 14 landfill flags, needs the model and a filled chip cache
```

The parity test re-runs the field test's 14 landfill flags from cached chips. It asserts that the
tier matches `data/seed/scan_all_passes.csv` and that `q_kgph` is within 2%. It uses the notebook's
own ERA5-Land wind values, so it makes no Earth Engine calls. It is skipped until the cache exists;
fill it once with Earth Engine credentials:

```bash
for s in ghazipur bhalswa okhla deonar pirana; do vayu scan --site $s --no-upload; done
```

## Running it permanently

### Docker (Linux, NVIDIA GPU or CPU)

```bash
cd worker
docker compose up -d worker                       # GPU: needs the NVIDIA Container Toolkit
docker compose --profile cpu up -d worker-cpu     # CPU only
docker compose logs -f worker
```

The chip cache lives in the `chip-cache` volume. `.env`, `secrets/` and `../models/` are mounted
read-only. Containers restart unless stopped.

### systemd (Linux, no Docker)

Install the worker under `/opt/vayunetra/worker` with a `.venv` (setup above), then:

```bash
sudo cp deploy/vayunetra-worker.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now vayunetra-worker
journalctl -u vayunetra-worker -f
```

### Windows Task Scheduler

1. Complete the setup above in `D:\VaayuNetra\worker` and check that
   `.venv\Scripts\vayu.exe scan --site deonar --no-upload` works from that folder.
2. Open PowerShell as the user who will run the worker and register the task:

   ```powershell
   $dir      = "D:\VaayuNetra\worker"
   $action   = New-ScheduledTaskAction -Execute "$dir\.venv\Scripts\vayu.exe" `
                 -Argument "worker --health-port 8787" -WorkingDirectory $dir
   $trigger  = New-ScheduledTaskTrigger -AtStartup
   $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero) `
                 -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1)
   $principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType S4U
   Register-ScheduledTask -TaskName "VayuNetra worker" -Action $action -Trigger $trigger `
     -Settings $settings -Principal $principal
   ```

   `S4U` runs the task whether or not the user is signed in, without storing a password.
   `ExecutionTimeLimit 0` removes the default 3-day stop, and the restart settings bring the worker
   back within a minute if it exits.
3. Start it now with `Start-ScheduledTask "VayuNetra worker"`, then check
   `Invoke-RestMethod http://127.0.0.1:8787/health` and the `worker_heartbeat` row in Supabase.
4. To stop it: `Stop-ScheduledTask "VayuNetra worker"`. To remove it:
   `Unregister-ScheduledTask "VayuNetra worker"`.

Keep the machine from sleeping (Settings → System → Power) or scheduled monitoring will wait until it
wakes.
