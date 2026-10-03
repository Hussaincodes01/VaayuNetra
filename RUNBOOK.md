# VayuNetra runbook

Operations after deployment ([DEPLOY.md](DEPLOY.md)). SQL runs in the Supabase **SQL Editor** for the
production project. Worker commands run in `worker/` on the worker machine; in a Docker install,
prefix them with `docker compose exec worker`.

## Restart the worker

Signs that it stopped: the dashboard shows **Worker offline** and **Request scan** is disabled
(no heartbeat for 3 minutes), and admins get one "worker offline" email after 2 hours.

| Install | Restart                                                                         | Logs                                                |
| ------- | ------------------------------------------------------------------------------- | --------------------------------------------------- |
| Docker  | `docker compose restart worker` (CPU: `worker-cpu`)                             | `docker compose logs -f --tail 200 worker`          |
| systemd | `sudo systemctl restart vayunetra-worker`                                       | `journalctl -u vayunetra-worker -f`                 |
| Windows | `Stop-ScheduledTask "VayuNetra worker"; Start-ScheduledTask "VayuNetra worker"` | `Get-Content worker\logs\worker.log -Tail 50 -Wait` |

Then check, in this order:

1. `curl http://127.0.0.1:8787/health` on the machine answers `{"status": "ok", ...}`.
2. `select worker_id, last_seen from worker_heartbeat;` shows a time within the last minute.
3. The site page shows **Worker online**.

If it stops again within minutes, read the log for the cause:

- **Earth Engine authentication errors:** the service-account key was revoked or expired. Rotate it
  (below).
- **401 from Supabase:** the service-role key in `worker/.env` is outdated, for example after a key
  rotation.
- **The worker waits after the machine wakes:** the machine went to sleep. Turn sleep off in the
  power settings.

The website and dashboard do not depend on the worker: they read Supabase, keep working while it is
offline, and show "Last updated" with the time of the newest scan.

## Rotate keys

Rotate a key at once if it was ever pasted into a notebook output, a chat, an issue or a commit. Each
rotation follows the same order: create the new key, put it everywhere it is used, redeploy or
restart, check, then revoke the old one.

| Key                                | Where it is used                                                                     | Create the new one                                                                                                                             | After updating                                                                                      |
| ---------------------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Supabase `service_role` and `anon` | Vercel (`SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`), `worker/.env` | Supabase **Project Settings → JWT Keys**: generate a new JWT secret. Both legacy keys change together, and every signed-in user is signed out. | Run `node scripts/vercel-env.mjs .env.production` with the new values, redeploy, restart the worker |
| Resend API key                     | Vercel `RESEND_API_KEY`, Supabase SMTP password                                      | Resend **API Keys → Create**                                                                                                                   | Update both places, redeploy, then delete the old key in Resend                                     |
| `CRON_SECRET`                      | Vercel only                                                                          | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`                                                                     | Redeploy. Vercel Cron sends the new value by itself                                                 |
| Groq API key                       | Vercel `GROQ_API_KEY`                                                                | console.groq.com → API Keys                                                                                                                    | Redeploy, delete the old key                                                                        |
| Mapbox token                       | Vercel `NEXT_PUBLIC_MAPBOX_TOKEN`                                                    | Mapbox **Tokens → Create**, with URL restrictions                                                                                              | Redeploy (public values are built into the pages), delete the old token                             |
| Mapillary token                    | Vercel `NEXT_PUBLIC_MAPILLARY_TOKEN`                                                 | Mapillary developer dashboard                                                                                                                  | Redeploy                                                                                            |
| Twilio auth token                  | Vercel `TWILIO_AUTH_TOKEN`                                                           | Twilio console: create a secondary token, then promote it                                                                                      | Redeploy                                                                                            |
| Earth Engine service-account key   | `worker/secrets/ee-key.json`                                                         | Google Cloud **IAM → Service accounts → vayunetra-worker → Keys → Add key (JSON)**                                                             | Replace the file, restart the worker, delete the old key in Cloud                                   |
| Database password                  | `supabase link` / `db push` only                                                     | Supabase **Project Settings → Database → Reset password**                                                                                      | Nothing else uses it                                                                                |

Check after a rotation: the site loads, an admin can sign in, the cron call in DEPLOY.md step 4.5
returns `{"ok":true}`, and the worker shows online.

## Re-run a backfill

Scans upsert on site, pass date and model version, so re-running is safe. Existing rows are updated
and nothing is duplicated.

```bash
cd worker
uv run vayu backfill --from 2024-01-01 --to 2025-12-31     # every active site
uv run vayu scan --site deonar --from 2024-01-01             # one landfill and its control point
```

A backfill makes one Earth Engine request per pass, so long ranges take hours; split them by year if
needed. The service can keep running meanwhile. Afterwards:

1. Rebuild the dossiers: `uv run vayu dossier --site <slug>` for each site.
2. Check the counts: `select slug, passes, flags, t1, t2, t3 from site_stats;`
3. The dashboard shows the new rows at once; the landing page refreshes within 10 minutes.

Alerts go out only for passes from the last 30 days (`ALERT_LOOKBACK_DAYS`), so a backfill of past
years sends no email.

**New model weights.** Scans are stored per model version (the first 12 hex characters of the weights'
SHA256). Put the new zip in `models/`, point `VAYU_MODEL_ZIP` at it, restart the worker and backfill.
When the backfill is complete, switch the site statistics to the new version:

```sql
update public.settings set value = to_jsonb('<new model_version>'::text) where key = 'model_version';
```

## Add a new landfill

1. Insert the landfill and its control point. The control point sits 0.045° north of the landfill
   (about 5 km), as in the field test. Look at it on a map first: it must not fall on another dump,
   an industrial site or water.

   ```sql
   insert into public.sites (slug, name, city, state, kind, geom, elev_m) values
     ('<slug>', '<Name>', '<City>', '<State>', 'landfill',
      extensions.st_geogfromtext('SRID=4326;POINT(<lon> <lat>)'), <elevation_m>);

   insert into public.sites (slug, name, city, state, kind, geom, elev_m, control_of) values
     ('<slug>-control', '<Name> control', '<City>', '<State>', 'control',
      extensions.st_geogfromtext('SRID=4326;POINT(<lon> <lat + 0.045>)'), <elevation_m>,
      (select id from public.sites where slug = '<slug>'));
   ```

   `slug` is lowercase with hyphens. `state` must match the spelling used in the alert recipients.

2. Scan its history. After this the daily `monitor` run includes it automatically:

   ```bash
   uv run vayu scan --site <slug> --from 2024-01-01 --to <today>
   uv run vayu dossier --site <slug>
   ```

3. Hindi names: add the site under `Places.sites` in `web/messages/hi.json`, and the city or state
   under `Places.regions` if they are new. Push; Vercel redeploys.
4. Alerts: in **Dashboard → Settings**, add the state's recipients if it is a new state.
5. The detection card says "No persistent-emission bound has been computed for this site yet" until a
   `site_sensitivity` row exists for the site and the active model version. That comes from the ops
   notebook's sensitivity run (`data/seed/site_sensitivity.csv` holds the field-test values).

To stop monitoring a site without deleting its history: `update public.sites set active = false where slug = '<slug>';`

## Alerts and reports

- **No alert email:** check the job under Vercel **Logs** (filter `/api/cron/alerts`), then
  `select channel, status, attempts, error, recipients from alerts order by created_at desc limit 10;`.
  A failed send is retried by the next run, up to 3 attempts. Then check the Resend **Emails** log.
- **Send a monthly report again:** each state and month is sent once. Delete its row
  (`delete from reports where state = '<State>' and period = 'YYYY-MM';`), then call
  `/api/cron/monthly?period=YYYY-MM` with the cron secret.
- **Access-request form refuses a real visitor:** the limits are 5 per hour per visitor IP, 3 per
  email per 24 hours and 30 per hour overall. Clear the per-IP counters with
  `delete from rate_limits where key like 'access_requests:%';`.
