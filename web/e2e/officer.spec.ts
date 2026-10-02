import { expect, test } from "@playwright/test";
import { OFFICER_STATE, rest, setWorkerOnline, trackErrors } from "./support";

test.use({ storageState: OFFICER_STATE });

test.afterEach(async () => {
  await setWorkerOnline(false);
  await rest("DELETE", "jobs?id=not.is.null");
});

test("officer can request a scan while the worker is online", async ({
  page,
  baseURL,
}) => {
  const errors = trackErrors(page, baseURL!);
  await setWorkerOnline(true);
  await page.goto("/dashboard/sites/deonar");
  const panel = page.locator("section", { has: page.locator("#jobs-title") });
  await expect(panel).toContainText("Worker online");

  await panel.getByRole("button", { name: "Request scan" }).click();
  // The new job shows in the panel and is queued in the jobs table for the worker.
  await expect(
    panel.getByText("queued", { exact: true }).first(),
  ).toBeVisible();
  const [job] = await rest<
    { id: string; kind: string; status: string; sites: { slug: string } }[]
  >(
    "GET",
    "jobs?select=id,kind,status,sites(slug)&order=created_at.desc&limit=1",
  );
  expect(job).toMatchObject({
    kind: "scan_site",
    status: "queued",
    sites: { slug: "deonar" },
  });

  // When the worker picks it up, the status changes on screen without a reload (Supabase Realtime,
  // with a 30 s re-read as backup). Right after Supabase starts, Realtime drops changes for a few
  // seconds while its replication starts, so the update is repeated until it shows.
  await expect(async () => {
    await rest("PATCH", `jobs?id=eq.${job.id}`, {
      status: "running",
      started_at: new Date().toISOString(),
      log: `e2e: scanning Deonar ${Date.now()}`,
    });
    await expect(
      panel.getByText("running", { exact: true }).first(),
    ).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 45_000 });
  expect(errors).toEqual([]);
});
