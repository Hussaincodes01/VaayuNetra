// Invite the first dashboard administrator. Sign-up is invite-only, so the first admin cannot sign up;
// later admins and officers are invited from Dashboard, Settings.
//
//   SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=... SITE_URL=https://vayunetra-india.vercel.app \
//     node scripts/create-admin.mjs you@example.org "Your Name"
//
// Sends the Supabase invite email (through the SMTP set in DEPLOY.md step 2) and makes the profile an
// admin. Safe to re-run: an existing user is promoted without a new invite.

const [email, fullName = null] = process.argv.slice(2);
const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const site = (process.env.SITE_URL || "").replace(/\/$/, "");
if (!email || !url || !key || !site) {
  console.error(
    'usage: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... SITE_URL=... node scripts/create-admin.mjs <email> ["Full Name"]',
  );
  process.exit(2);
}
const headers = {
  apikey: key,
  Authorization: `Bearer ${key}`,
  "Content-Type": "application/json",
};

const invite = await fetch(
  `${url}/auth/v1/invite?redirect_to=${encodeURIComponent(`${site}/login?invited=1`)}`,
  {
    method: "POST",
    headers,
    body: JSON.stringify({ email, data: { full_name: fullName } }),
  },
);
let id;
if (invite.ok) {
  id = (await invite.json()).id;
  console.log(`Invite sent to ${email}.`);
} else {
  const body = await invite.text();
  if (!/already|registered|exists/i.test(body))
    throw new Error(`invite failed: ${invite.status} ${body}`);
  const list = await (
    await fetch(`${url}/auth/v1/admin/users?per_page=1000`, { headers })
  ).json();
  id = list.users.find(
    (u) => u.email?.toLowerCase() === email.toLowerCase(),
  )?.id;
  if (!id) throw new Error(`${email} exists but could not be found`);
  console.log(`${email} already has an account; promoting it.`);
}

const res = await fetch(`${url}/rest/v1/profiles?user_id=eq.${id}`, {
  method: "PATCH",
  headers: { ...headers, Prefer: "return=representation" },
  body: JSON.stringify({
    role: "admin",
    ...(fullName ? { full_name: fullName } : {}),
  }),
});
const rows = await res.json();
if (!res.ok || !rows.length)
  throw new Error(`profile update failed: ${JSON.stringify(rows)}`);
console.log(
  `${email} is now an admin. Open the invite email, then sign in at ${site}/login.`,
);
