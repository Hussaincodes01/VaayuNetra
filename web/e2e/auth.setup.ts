import { test as setup } from "@playwright/test";
import { ensureUser, OFFICER, OFFICER_STATE, rest, signIn } from "./support";

// Runs before the other tests: a clean slate for the rows the tests write, an invited officer, and
// that officer's signed-in browser state (reused by the dashboard tests).
setup("officer signs in with a magic link", async ({ page }) => {
  await rest("DELETE", "jobs?id=not.is.null");
  await rest("DELETE", "worker_heartbeat?worker_id=not.is.null");
  await rest("DELETE", "rate_limits?key=like.access_requests*");
  await rest("DELETE", "access_requests?email=like.e2e-*");
  await ensureUser(OFFICER);
  await signIn(page, OFFICER.email);
  await page.context().storageState({ path: OFFICER_STATE });
});
