import { expect, test } from "@playwright/test";
import { SUPABASE_URL } from "./support";

test("security headers on every page", async ({ request }) => {
  for (const path of ["/", "/map", "/login"]) {
    const h = (await request.get(path)).headers();
    const csp = h["content-security-policy"] ?? "";
    expect(csp, path).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain(`connect-src 'self' ${new URL(SUPABASE_URL).origin}`);
    expect(csp).not.toMatch(
      /script-src[^;]*https?:\/\/(?!va\.vercel-scripts|vercel\.live)/,
    );
    expect(h["strict-transport-security"]).toContain("max-age=63072000");
    expect(h["x-frame-options"]).toBe("DENY");
    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(h["x-powered-by"]).toBeUndefined();
  }
});

test("access requests are rate-limited per visitor", async ({ page }) => {
  const stamp = Date.now();
  for (let i = 1; i <= 6; i++) {
    // A fresh load each time (a hash-only change would keep the "sent" state on screen).
    await page.goto(`/?attempt=${i}#request`);
    const form = page.locator("#request form");
    await form.locator("input[name=name]").fill("E2E Visitor");
    await form.locator("input[name=org]").fill("E2E Org");
    await form
      .locator("input[name=email]")
      .fill(`e2e-${stamp}-${i}@vayunetra.test`);
    await form.locator("button[type=submit]").click();
    if (i <= 5)
      await expect(page.locator("#request")).toContainText("Request received");
    else
      await expect(page.locator("#request")).toContainText("Too many requests");
  }
});
