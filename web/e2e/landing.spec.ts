import { expect, test } from "@playwright/test";
import { trackErrors } from "./support";

// The twelve sections of the landing story, top to bottom (the film needs NEXT_PUBLIC_VIDEO_URL).
const SECTIONS = [
  "top",
  "problem",
  "signal",
  "how",
  "proof",
  "field",
  "gate",
  "action",
  "honest",
  "film",
  "initiative",
  "request",
];

test("landing renders all 12 sections without console errors", async ({
  page,
  baseURL,
}) => {
  const errors = trackErrors(page, baseURL!);
  await page.goto("/");
  for (const id of SECTIONS) {
    const section = page.locator(`#${id}`);
    await expect(section, `section #${id}`).toHaveCount(1);
    await section.scrollIntoViewIfNeeded();
    await expect(section).toBeVisible();
    // Every section is labelled by a heading with real text.
    const heading = await section.getAttribute("aria-labelledby");
    expect(heading, `#${id} has aria-labelledby`).toBeTruthy();
    await expect(page.locator(`[id="${heading}"]`)).toHaveText(/\S{3,}/);
  }
  await expect(page.getByTestId("last-updated")).toContainText("Last updated");
  expect(errors).toEqual([]);
});

test("Hindi landing renders", async ({ page }) => {
  await page.goto("/hi");
  await expect(page.locator("html")).toHaveAttribute("lang", "hi");
  await expect(page.locator("#top")).toBeVisible();
  await expect(page.getByTestId("last-updated")).toContainText("अंतिम अपडेट");
});
