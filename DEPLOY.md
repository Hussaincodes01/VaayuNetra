# Deploying VayuNetra

This takes a fresh clone to a running system: the database on Supabase, the website and dashboard on
Vercel, email through Resend, and the inference worker on your own machine. Follow the steps in
order. Each step ends with a check.

Commands run from the repository root unless a step says `cd web` or `cd worker`.

## 0. Accounts and tools

| Service             | Needed for                                         | Plan                                                           |
| ------------------- | -------------------------------------------------- | -------------------------------------------------------------- |
| GitHub              | the repository; CI runs on every push              | free                                                           |
| Supabase            | database, sign-in, file storage                    | free tier works                                                |
| Vercel              | website, dashboard, cron jobs                      | Hobby works: 15-minute alerts run in GitHub Actions (step 4.5) |
| Resend              | magic-link sign-in emails, alerts, monthly reports | free tier works; needs a domain you control                    |
| Mapbox              | the 3D globe and site maps                         | free tier; public token                                        |
| Mapillary           | street-level photos on the landing page (optional) | free                                                           |
| Groq                | "Explain this site" AI briefings (optional)        | free tier works                                                |
| Twilio              | WhatsApp/SMS alerts (optional, off by default)     | pay as you go                                                  |
| Google Earth Engine | the worker's Sentinel-2 and ERA5-Land data         | service account on a Cloud project                             |

Tools on your computer: Git, Node 24 with Corepack (`corepack enable` gives you pnpm 10), the Supabase
CLI 2.119 or newer, and for the worker Python 3.11 with [uv](https://docs.astral.sh/uv/).

```bash
git clone https://github.com/Hussaincodes01/VaayuNetra.git
cd VaayuNetra
corepack enable
(cd web && pnpm install --frozen-lockfile)
```

Check: `node --version` prints v24, `supabase --version` prints 2.119 or newer.

## 1. Supabase: database, storage and seed data

1. In the [Supabase dashboard](https://supabase.com/dashboard), create a project. Region: Mumbai
   (`ap-south-1`). Save the database password.
2. Copy three values from **Project Settings → API Keys**, using the **Legacy API keys** tab:
   - Project URL: `https://<ref>.supabase.co`
   - `anon` key (public)
   - `service_role` key (secret: it bypasses every security rule; it goes only into Vercel's server
     variables and the worker's `.env`)
3. Apply the schema. It creates the tables, row-level security, storage buckets and Realtime settings:

   ```bash
   supabase login
   supabase link --project-ref <ref>
   supabase db push
   ```

4. Load the field-test data (10 sites, 674 scans, settings):

   ```bash
   SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=<service_role> node supabase/seed.ts --remote
   ```

Check: in the Supabase **Table Editor**, `sites` has 10 rows and `scans` has 674.

## 2. Email: sign-in links, invites and alerts

The dashboard is invite-only and signs people in with emailed magic links. Supabase's built-in
mailer only delivers to members of your Supabase organisation, a few emails an hour, so send through
SMTP. Two options:

**Gmail (free, no domain needed; this deployment uses it).** Gmail sends about 500 emails a day.

1. Turn on 2-Step Verification for the Google account: https://myaccount.google.com/signinoptions/twosv
2. Create an app password named `VayuNetra`: https://myaccount.google.com/apppasswords
3. In `web/.env.production`: `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=465`, `SMTP_USER` and
   `ALERT_FROM_EMAIL` = the Gmail address, `SMTP_PASS` = the 16-letter app password (no spaces).

**Resend (needs a domain you own).** Verify the domain under https://resend.com/domains, create a
sending-only key, set `RESEND_API_KEY` and `ALERT_FROM_EMAIL=alerts@<your-domain>`, and leave the
`SMTP_*` values empty. The app uses SMTP when it is set, Resend otherwise.

Then point Supabase's own emails (sign-in links, invites) at the same Gmail account, and set the
site URL, redirect URLs and invite-only sign-up. All of it is kept in
`deploy/supabase-production/supabase/config.toml`; the credentials come from the environment:

```bash
SMTP_USER=<gmail address> SMTP_PASS=<app password>   npx supabase config push --workdir deploy/supabase-production --project-ref <ref>
```

Edit the URLs in that file first if your address differs from `vayunetra-india.vercel.app`.

Check: **Authentication → Emails → SMTP Settings** in Supabase shows the Gmail sender, and
**Authentication → Sign In / Providers** shows sign-up turned off.

## 3. Other keys

- **Mapbox:** create a public token under Account → Tokens. Add URL restrictions for your domain(s):
  browser tokens are visible to anyone.
- **Mapillary** (optional): create an app at mapillary.com/dashboard/developers and copy the client
  token. Restrict it to your domain too.
- **Groq** (optional): create an API key at console.groq.com. Without it the dashboard says AI
  briefings are not configured, and everything else works.
- **Cron secret:** generate a random value:

  ```bash
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  ```

Fill a values file from the template. `.env*` files are gitignored; never commit this one:

```bash
cd web
cp .env.example .env.production
```

| Variable                             | Value                                                 | Required                            |
| ------------------------------------ | ----------------------------------------------------- | ----------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`           | Project URL from step 1                               | yes                                 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`      | `anon` key                                            | yes                                 |
| `SUPABASE_SERVICE_ROLE_KEY`          | `service_role` key                                    | yes                                 |
| `NEXT_PUBLIC_SITE_URL`               | `https://vayunetra-india.vercel.app` or your domain   | yes                                 |
| `RESEND_API_KEY`, `ALERT_FROM_EMAIL` | from step 2                                           | yes, for alerts and reports         |
| `CRON_SECRET`                        | the random value above                                | yes, for alerts and reports         |
| `NEXT_PUBLIC_MAPBOX_TOKEN`           | Mapbox public token                                   | yes, for the maps                   |
| `NEXT_PUBLIC_MAPILLARY_TOKEN`        | Mapillary client token                                | optional                            |
| `GROQ_API_KEY` (and `GROQ_MODEL`)    | Groq key; model defaults to `qwen/qwen3.8-27b`        | optional                            |
| `NEXT_PUBLIC_VIDEO_URL`              | the film: https://www.youtube.com/watch?v=NFfkrmYtKDA | optional; the film section needs it |
| `ALERT_LOOKBACK_DAYS`                | default 30                                            | optional                            |
| `ALERTS_TWILIO_ENABLED`, `TWILIO_*`  | `true` plus Twilio SID, token and sender              | optional                            |
| `ANTHROPIC_API_KEY`                  | not used by the current code                          | leave empty                         |

Check: every "yes" row has a value.

## 4. Vercel

### 4.1 Create the project

The plain `vayunetra.vercel.app` belongs to another Vercel team, so this project uses
`vayunetra-india.vercel.app` (Vercel also assigned `vayunetra-vert.vercel.app` and `vayunetra-jiyad2332.vercel.app`, which serve
the same site).

1. Push the repository to GitHub if it is not there yet.
2. In Vercel: **Add New → Project → Import** the `VaayuNetra` repository.
3. **Root Directory:** click **Edit** and choose `web`. The framework preset becomes Next.js; keep the
   default build settings. Node 24 comes from `web/package.json`.
4. Open **Environment Variables** and paste the whole content of `web/.env.production` into the Key
   field. Vercel splits it into one variable per line. Variables added on this screen apply to all
   environments; afterwards **Settings → Environment Variables** lists each one with Production and
   Preview.
5. Click **Deploy**.

To set or update the variables from a terminal instead, link the folder once and push them. The
script sets Production and Preview, and skips `NEXT_PUBLIC_SITE_URL` for Preview so each preview
uses its own URL:

```bash
npm i -g vercel@latest
cd web
vercel link                                # choose the vayunetra project
node scripts/vercel-env.mjs .env.production
```

After changing variables, redeploy: **Deployments → ⋯ → Redeploy**.

### 4.2 Preview URL

Remove Preview from `NEXT_PUBLIC_SITE_URL` under **Settings → Environment Variables**. If you used
the script, this is already done. Previews then use their own branch URL for sign-in links, which the
preview redirect URL in step 2 allows.

### 4.3 Analytics

Open the project's **Analytics** tab and click **Enable**. The site already includes the Vercel
Analytics component, which runs only on Vercel.

### 4.4 First administrator

```bash
cd web
SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=<service_role> \
  SITE_URL=https://vayunetra-india.vercel.app node scripts/create-admin.mjs you@example.org "Your Name"
```

Open the invite email and follow the link, then sign in at `/login`. Invite everyone else from
**Dashboard → Settings**, and set the alert recipients per state there.

### 4.5 Cron jobs and the 15-minute alert schedule

`web/vercel.json` declares two Vercel cron jobs, which turn on with the production deployment. They
fit the Hobby plan, which allows at most one run a day per job:

| Path                | Schedule (UTC)               | Job                                                                  |
| ------------------- | ---------------------------- | -------------------------------------------------------------------- |
| `/api/cron/alerts`  | `0 3 * * *` (daily backstop) | new T1/T2 events to state recipients; worker-offline email to admins |
| `/api/cron/monthly` | `30 2 1 * *`                 | monthly PDF report per state                                         |

The 15-minute alert schedule runs in GitHub Actions (`.github/workflows/alerts.yml`), free for a
public repository. It calls the same route with the same secret. Every email is claimed in the
database before it is sent, so the daily Vercel run and the 15-minute run never send twice. Turn it on:

1. Open https://github.com/Hussaincodes01/VaayuNetra/settings/secrets/actions/new and add a secret
   named `CRON_SECRET` with the same value as `CRON_SECRET` in `web/.env.production`.
2. Open https://github.com/Hussaincodes01/VaayuNetra/settings/variables/actions/new and add a
   variable named `VAYU_SITE_URL` with the production URL, `https://vayunetra-india.vercel.app`.
3. Open https://github.com/Hussaincodes01/VaayuNetra/actions/workflows/alerts.yml and click
   **Run workflow** once. The log shows `ok: true | events: 0 | worker alerts: 0`.

On the Pro plan you can instead set the alerts schedule in `web/vercel.json` to `*/15 * * * *` and
delete the workflow. GitHub pauses scheduled workflows in a public repository after 60 days without
commits; re-enable it on the workflow page if that happens.

Check: **Settings → Cron Jobs** in Vercel lists both jobs. Then call the alerts job by hand:

```bash
curl -H "Authorization: Bearer <CRON_SECRET>" https://vayunetra-india.vercel.app/api/cron/alerts
```

It answers `{"ok":true,...}`. Without the header it answers 401.

### 4.6 Custom domain (if you have one)

1. **Settings → Domains → Add** the domain and create the DNS records Vercel shows.
2. Set `NEXT_PUBLIC_SITE_URL` (Production) to `https://<domain>` and redeploy.
3. In Supabase **Authentication → URL Configuration**, set the Site URL to the domain and add
   `https://<domain>/**` to the Redirect URLs.
4. Add the domain to the Mapbox and Mapillary token URL restrictions.

## 5. Check the deployment

1. Open the site. The landing page tells the story top to bottom, and the footer shows
   "Last updated" with the seed date.
2. Open `/map` and a site page such as `/map/deonar`.
3. Check the security headers:

   ```bash
   curl -sI https://vayunetra-india.vercel.app/ | grep -iE "content-security-policy|strict-transport-security"
   ```

4. Sign in as the admin. The overview shows 5 sites and "Worker offline" until step 6 is done.
5. With a recipient set for Maharashtra, run the alert check. It inserts a fake T1 scan, triggers the
   cron, prints the result and deletes the scan:

   ```bash
   cd web
   SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=<service_role> CRON_SECRET=<secret> \
     node scripts/alert-smoke.mjs --trigger https://vayunetra-india.vercel.app
   ```

   It prints `PASS`, and the recipient gets one email.

## 6. The worker (your GPU or CPU machine)

The worker reads Sentinel-2 through Earth Engine, runs the model and writes scans to Supabase. It
makes outbound connections only. A 4 GB laptop GPU is enough (the model uses about 140 MB).

1. On that machine, clone the repository and follow **Setup** in [`worker/README.md`](worker/README.md):
   `uv sync`, PyTorch, then `uv pip install earthengine-api` and `cp .env.example .env`.
2. Fill `worker/.env`: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and `WORKER_ID` (a name for this
   machine).
3. Earth Engine sign-in, either:
   - your own Google account: leave `EE_SERVICE_ACCOUNT` and `EE_KEY_FILE` empty and sign in once
     with `gcloud auth application-default login` or `.venv\Scripts\earthengine authenticate`; or
   - a service account: put its JSON key at `worker/secrets/ee-key.json` and keep the `EE_*` values.
4. Copy the model file `vayunetra_best_model_20261001_1401.zip` into `models/` at the repository
   root (or set `VAYU_MODEL_ZIP`). The weights are not in git; they come from the training notebook.
5. Test without writing anything. The window must include history for the reference passes, so
   use a few months: `uv run vayu scan --site deonar --from 2024-09-01 --to 2025-01-31 --no-upload`
   reproduces the field test's Deonar T1 of 6 January 2025.
6. Run it permanently. On Windows, register the task once (no administrator rights needed; it starts
   when you sign in, restarts within a minute if it stops, and logs to `worker\logs\worker.log`):

   ```powershell
   $dir = "D:\VaayuNetra\worker"
   $action = New-ScheduledTaskAction -Execute "$dir\deploy\run-worker.cmd" -WorkingDirectory $dir
   $trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
   $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries `
     -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 `
     -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew
   $principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive
   Register-ScheduledTask -TaskName "VayuNetra worker" -Action $action -Trigger $trigger `
     -Settings $settings -Principal $principal
   Start-ScheduledTask "VayuNetra worker"
   ```

   On Linux use Docker or systemd, as in **Running it permanently** in `worker/README.md`. Keep the
   machine awake: the worker runs only while it is on.

Check: `curl http://127.0.0.1:8787/health` answers `{"status": "ok", ...}`, and within a minute the
dashboard's site page shows "Worker online" and **Request scan** is enabled.

## 7. Continuous integration

`.github/workflows/web.yml` and `worker.yml` run on every push and pull request. They need no secrets:
the end-to-end job starts its own local Supabase inside the runner. A green run means:

- web: lint, formatting, TypeScript, the `server-only` guard and the production build
- database: pgTAP tests for row-level security, workflow rules, alerts and rate limits
- Playwright: the 12 landing sections, the public map, officer sign-in and **Request scan**,
  signed-out access to `/dashboard` refused, pages rendering with the worker offline, security
  headers, and the access-request rate limit
- worker: ruff and pytest

Day-to-day operations (restarting the worker, rotating keys, backfills, adding a landfill) are in
[RUNBOOK.md](RUNBOOK.md).

```

```
