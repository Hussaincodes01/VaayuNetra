import { expect, test } from "@playwright/test";
import { OFFICER_STATE, setWorkerOnline } from "./support";

// Every page reads Supabase, not the worker: with no heartbeat at all, pages still render their data
// and say when it was last updated.
test.beforeAll(() => setWorkerOnline(false));

test.describe("public pages, worker offline", () => {
  for (const path of ["/", "/hi", "/map", "/map/deonar", "/hi/map/deonar"])
    test(path, async ({ page }) => {
      const res = await page.goto(path);
      expect(res?.status()).toBe(200);
      await expect(page.getByTestId("last-updated")).toHaveText(
        /^(Last updated|अंतिम अपडेट) \d/,
      );
    });
});

test.describe("dashboard, worker offline", () => {
  test.use({ storageState: OFFICER_STATE });

  test("overview and site page render; scans are paused", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByTestId("last-updated")).toHaveText(
      /^Last updated \d/,
    );
    await expect(page.locator("dl dd").first()).toHaveText(/\d/);

    await page.goto("/dashboard/sites/deonar");
    await expect(page.getByTestId("last-updated")).toHaveText(
      /^Last updated \d/,
    );
    await expect(page.locator("#pass-2025-01-06")).toBeVisible();
    const panel = page.locator("section", { has: page.locator("#jobs-title") });
    await expect(panel).toContainText("Worker offline");
    await expect(
      panel.getByRole("button", { name: "Request scan" }),
    ).toBeDisabled();
  });
});
