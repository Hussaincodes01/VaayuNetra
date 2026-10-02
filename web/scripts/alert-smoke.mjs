// Staging check for the alert cron: insert a fake T1 scan, wait for the alert, report, clean up.
//
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/alert-smoke.mjs
//       waits up to 16 minutes for the scheduled cron (every 15 minutes)
//   ... CRON_SECRET=... node scripts/alert-smoke.mjs --trigger https://<staging-host>
//       calls /api/cron/alerts right away instead of waiting
//
// Options: --site <slug> (default deonar), --keep (leave the fake scan and its alert row in place).
// The email goes to the recipients configured for the site's state under Dashboard, Settings.

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const SITE = opt("--site", "deonar");
const TRIGGER = opt("--trigger", null);
const KEEP = args.includes("--keep");
const URL_ = process.env.SUPABASE_URL?.replace(/\/$/, "");
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !KEY) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(2);
}
if (TRIGGER && !process.env.CRON_SECRET) {
  console.error("--trigger needs CRON_SECRET.");
  process.exit(2);
}

const headers = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  "Content-Type": "application/json",
  Prefer: "return=representation",
};
async function rest(method, path, body) {
  const res = await fetch(`${URL_}/rest/v1/${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

const [site] = await rest(
  "GET",
  `sites?select=id,name,state&slug=eq.${SITE}&kind=eq.landfill`,
);
if (!site) throw new Error(`no landfill with slug ${SITE}`);
const settings = await rest(
  "GET",
  "settings?select=value&key=eq.alert_recipients",
);
const recipients = settings[0]?.value?.[site.state] ?? [];
console.log(
  `${site.name} (${site.state}): recipients ${JSON.stringify(recipients)}`,
);
if (!recipients.length) {
  console.error(
    `FAIL: no alert recipients for ${site.state}. Add them under Dashboard, Settings.`,
  );
  process.exit(1);
}

const today = new Date().toISOString().slice(0, 10);
const [scan] = await rest("POST", "scans", {
  site_id: site.id,
  pass_date: today,
  overpass_utc: new Date().toISOString(),
  scene_score: 0.9,
  detected: true,
  tier: "T1",
  threshold_used: 0.844,
  model_version: "smoke-test",
});
console.log(`Inserted fake T1 scan ${scan.id} for ${today}.`);

const started = Date.now();
let alert = null;
try {
  if (TRIGGER) {
    const res = await fetch(`${TRIGGER.replace(/\/$/, "")}/api/cron/alerts`, {
      headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
    });
    console.log(`cron: ${res.status} ${(await res.text()).slice(0, 400)}`);
  }
  while (Date.now() - started < 16 * 60_000) {
    const rows = await rest(
      "GET",
      `alerts?select=channel,status,recipients,attempts,error,sent_at&scan_id=eq.${scan.id}&channel=eq.email`,
    );
    if (rows[0] && rows[0].status !== "pending") {
      alert = rows[0];
      break;
    }
    await new Promise((r) => setTimeout(r, TRIGGER ? 2_000 : 30_000));
  }
} finally {
  if (!KEEP) await rest("DELETE", `scans?id=eq.${scan.id}`);
}

const minutes = ((Date.now() - started) / 60_000).toFixed(1);
if (!alert) {
  console.error(`FAIL: no email alert after ${minutes} min.`);
  process.exit(1);
}
console.log(
  `${alert.status === "sent" ? "PASS" : "FAIL"} after ${minutes} min: ${JSON.stringify(alert)}`,
);
process.exit(alert.status === "sent" ? 0 : 1);
