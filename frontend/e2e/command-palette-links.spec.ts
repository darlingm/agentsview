import { test, expect } from "@playwright/test";

test.describe("Command palette links", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".session-item").first()).toBeVisible();
    await page.keyboard.press("ControlOrMeta+k");
    await expect(page.locator(".palette-input")).toBeVisible();
  });

  test("opens a recent session in a new tab without leaving the palette", async ({
    page,
    context,
  }) => {
    const result = page.locator("a.palette-item").first();
    await expect(result).toBeVisible();
    const href = await result.getAttribute("href");
    expect(href).toBeTruthy();
    const originalUrl = page.url();
    const targetUrl = new URL(href!, originalUrl);
    expect(targetUrl.searchParams.has("msg")).toBe(false);

    const newTabOpened = context.waitForEvent("page");
    await result.click({ modifiers: ["ControlOrMeta"] });
    const newTab = await newTabOpened;
    try {
      await newTab.bringToFront();
      await expect(newTab).toHaveURL(targetUrl.href);
      await expect(newTab.locator(".virtual-row").first()).toBeVisible();
      await expect(page).toHaveURL(originalUrl);
      await expect(page.locator(".palette-input")).toBeVisible();
    } finally {
      await newTab.close();
    }
  });

  test("middle-click opens a search result at the matched message", async ({ page, context }) => {
    await page.locator(".palette-input").fill("synchronous DB read");
    const result = page.locator("a.palette-item", { hasText: "synchronous DB read" }).first();
    await expect(result).toBeVisible();
    const href = await result.getAttribute("href");
    expect(href).toBeTruthy();
    const originalUrl = page.url();
    const targetUrl = new URL(href!, originalUrl);
    expect(targetUrl.searchParams.get("msg")).toMatch(/^\d+$/);

    const newTabOpened = context.waitForEvent("page");
    await result.click({ button: "middle" });
    const newTab = await newTabOpened;
    try {
      await newTab.bringToFront();
      await expect(newTab).toHaveURL(targetUrl.href);
      const matchedRow = newTab.locator(".virtual-row.selected");
      await expect(matchedRow).toContainText("synchronous DB read");
      await expect(matchedRow).toBeInViewport();
      await expect(page).toHaveURL(originalUrl);
      await expect(page.locator(".palette-input")).toHaveValue("synchronous DB read");
    } finally {
      await newTab.close();
    }
  });

  test("keeps ordinary search-result clicks in the current app", async ({ page }) => {
    await page.locator(".palette-input").fill("synchronous DB read");
    const result = page.locator("a.palette-item", { hasText: "synchronous DB read" }).first();
    await expect(result).toBeVisible();
    const targetUrl = new URL((await result.getAttribute("href"))!, page.url());
    await page.evaluate(() => {
      document.documentElement.dataset.paletteNavigationMarker = "same-document";
    });

    await result.click();

    await expect(page.locator(".palette-input")).toHaveCount(0);
    await expect(page.locator(".virtual-row.selected")).toContainText("synchronous DB read");
    expect(new URL(page.url()).pathname).toBe(targetUrl.pathname);
    await expect(page.locator("html")).toHaveAttribute(
      "data-palette-navigation-marker",
      "same-document",
    );
  });

  for (const key of ["Enter", "Space"]) {
    test(`activates a focused recent-session link with ${key}`, async ({ page }) => {
      const result = page.locator("a.palette-item").nth(1);
      await expect(result).toBeVisible();
      const href = await result.getAttribute("href");
      expect(href).toBeTruthy();
      const targetUrl = new URL(href!, page.url());

      await result.focus();
      await result.press(key);

      await expect(page).toHaveURL(targetUrl.href);
      await expect(page.locator(".palette-input")).toHaveCount(0);
      await expect(page.locator(".virtual-row").first()).toBeVisible();
    });
  }
});
