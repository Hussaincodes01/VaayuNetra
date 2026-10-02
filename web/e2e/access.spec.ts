import { expect, test } from "@playwright/test";

test.describe("signed-out visitors", () => {
  for (const path of [
    "/dashboard",
    "/dashboard/sites/deonar",
    "/dashboard/settings",
    "/hi/dashboard",
  ])
    test(`cannot reach ${path}`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveURL(/\/login\?next=/);
      await expect(page.locator("input[name=email]")).toBeVisible();
    });

  test("cannot call the signed-in APIs", async ({ request }) => {
    expect((await request.get("/api/export/scans?site=deonar")).status()).toBe(
      401,
    );
    expect(
      (
        await request.post("/api/explain", { data: { slug: "deonar" } })
      ).status(),
    ).toBe(401);
    // Cron routes need CRON_SECRET (503 when the server has none configured).
    expect([401, 503]).toContain(
      (await request.get("/api/cron/alerts")).status(),
    );
  });
});
