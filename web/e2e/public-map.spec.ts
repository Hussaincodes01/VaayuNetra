import { expect, test } from "@playwright/test";
import { trackErrors } from "./support";

test("public map loads and links to a read-only site page", async ({
  page,
  baseURL,
}) => {
  const errors = trackErrors(page, baseURL!);
  await page.goto("/map");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  // The five monitored landfills, each linking to its public page.
  for (const slug of ["ghazipur", "bhalswa", "okhla", "deonar", "pirana"])
    await expect(page.locator(`a[href$="/map/${slug}"]`).first()).toBeVisible();
  await expect(page.getByTestId("last-updated")).toContainText("Last updated");

  await page.locator('a[href$="/map/deonar"]').first().click();
  await expect(page).toHaveURL(/\/map\/deonar$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Deonar");
  await expect(page.locator("#pass-2025-01-06")).toBeVisible();
  // Read-only: no action workflow for anonymous visitors.
  await expect(page.locator("#actions")).toHaveCount(0);
  expect(errors).toEqual([]);
});
