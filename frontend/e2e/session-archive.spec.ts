import { expect, test, type Page } from "@playwright/test";
import {
  createMockSessions,
  handleSessionsRoute,
  sessionsRoutePattern,
} from "./helpers/mock-sessions";

async function setupArchiveSessions(page: Page) {
  const data = createMockSessions(2, "archive-test", () => "test-project");
  data[0]!.display_name = "Current session";
  data[1]!.display_name = "Archived session";
  data[1]!.archived_at = "2026-09-01T10:00:00Z";
  await page.route(sessionsRoutePattern, handleSessionsRoute([{ project: null, sessions: data }]));
  await page.route("**/api/v1/sessions/batch-archive", async (route) => {
    const { session_ids, archived } = route.request().postDataJSON();
    const changed = data.filter(
      (session) => session_ids.includes(session.id) && Boolean(session.archived_at) !== archived,
    );
    for (const session of changed) session.archived_at = archived ? "2026-09-02T10:00:00Z" : null;
    await route.fulfill({
      json: { sessions: changed.map(({ id, archived_at }) => ({ id, archived_at })) },
    });
  });
  return data;
}

async function openArchiveFilter(page: Page) {
  await page
    .locator(".session-list-header")
    .getByRole("button", { name: "Filters", exact: true })
    .click();
  return page.getByRole("checkbox", { name: "Show only archived", exact: true });
}

test("Hide/Dim is saved in Settings; archived-only is a separate temporary list filter", async ({
  page,
}) => {
  await setupArchiveSessions(page);
  await page.goto("/sessions");
  await expect(page.locator(".session-item")).toHaveCount(1);
  await expect(page.locator(".session-item")).toContainText("Current session");

  await page.goto("/settings");
  const preference = page.getByRole("radiogroup", {
    name: "Archived sessions in the session list",
  });
  await expect(preference.getByRole("radio", { name: "Hide", exact: true })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await expect(page.getByRole("checkbox", { name: "Show only archived" })).toHaveCount(0);
  await preference.getByRole("radio", { name: "Show dimmed" }).click();

  await page.goto("/sessions");
  await expect(page.locator(".session-item")).toHaveCount(2);
  await expect(page.locator('.session-item[data-session-id="archive-test-1"]')).toHaveClass(
    /archived-dimmed/,
  );
  await page.reload();
  await expect(page.locator(".session-item")).toHaveCount(2);

  const onlyArchived = await openArchiveFilter(page);
  await onlyArchived.check();
  await expect(page.locator(".session-item")).toHaveCount(1);
  await expect(page.locator(".session-item")).toContainText("Archived session");
  await expect(page.locator(".session-item")).not.toHaveClass(/archived-dimmed/);
  await onlyArchived.uncheck();
  await expect(page.locator(".session-item")).toHaveCount(2);
  await onlyArchived.check();
  await page.reload();
  await expect(page.locator(".session-item")).toHaveCount(2);
});

test("archived-only overrides Hide and clearing filters restores normal browsing", async ({
  page,
}) => {
  await setupArchiveSessions(page);
  await page.goto("/sessions");
  await expect(page.locator(".session-item")).toHaveCount(1);
  const onlyArchived = await openArchiveFilter(page);
  await onlyArchived.check();
  await expect(page.locator(".session-item")).toContainText("Archived session");
  await page.getByRole("button", { name: "Clear filters", exact: true }).click();
  await expect(page.locator(".session-item")).toHaveCount(1);
  await expect(page.locator(".session-item")).toContainText("Current session");
});

test("Archive and Undo retain the open session while changing only list visibility", async ({
  page,
}) => {
  await setupArchiveSessions(page);
  await page.goto("/sessions");
  const current = page.locator('.session-item[data-session-id="archive-test-0"]');
  await expect(current).toBeVisible();
  await current.click();
  const archive = page.getByRole("button", { name: "Archive", exact: true });
  await expect(archive).toBeVisible();
  await archive.click();
  await expect(current).toHaveCount(0);
  // The toolbar remains bound to the same open session, not a blank viewer.
  await expect(page.getByRole("button", { name: "Unarchive", exact: true })).toBeVisible();
  await page.locator(".undo-toasts").getByRole("button", { name: "Undo", exact: true }).click();
  await expect(current).toBeVisible();
  await expect(page.getByRole("button", { name: "Archive", exact: true })).toBeVisible();
});

test("dimmed archive rows remain keyboard-accessible at narrow widths", async ({ page }) => {
  await setupArchiveSessions(page);
  await page.setViewportSize({ width: 400, height: 800 });
  await page.addInitScript(() =>
    localStorage.setItem("agentsview-archived-session-visibility", "dim"),
  );
  await page.goto("/sessions");
  const drawer = page.locator("#session-sidebar");
  if (!(await drawer.evaluate((node) => node.classList.contains("open"))))
    await page.locator("button.hamburger").click();
  const archived = page.locator('.session-item[data-session-id="archive-test-1"]');
  await expect(archived).toBeVisible();
  await archived.focus();
  await archived.press("Enter");
  await expect(page.getByRole("button", { name: "Unarchive", exact: true })).toBeVisible();
});

for (const theme of ["light", "dark"] as const) {
  for (const highContrast of [false, true]) {
    test(`archive labels stay aligned and dim only when idle (${theme}, contrast=${highContrast})`, async ({
      page,
    }, testInfo) => {
      await setupArchiveSessions(page);
      await page.addInitScript(
        ({ theme, highContrast }) => {
          localStorage.setItem("theme", theme);
          localStorage.setItem("theme-high-contrast", String(highContrast));
          localStorage.setItem("agentsview-archived-session-visibility", "dim");
        },
        { theme, highContrast },
      );
      await page.goto("/sessions");
      const current = page.locator('.session-item[data-session-id="archive-test-0"]');
      const archived = page.locator('.session-item[data-session-id="archive-test-1"]');
      await expect(current).toBeVisible();
      await expect(archived).toBeVisible();
      await expect(page.locator("html")).toHaveClass(
        highContrast ? /\bhigh-contrast\b/ : /^(?!.*\bhigh-contrast\b).*$/,
      );
      const currentTitle = await current.locator(".session-name").boundingBox();
      const archivedTitle = await archived.locator(".session-name").boundingBox();
      expect(currentTitle).not.toBeNull();
      expect(archivedTitle).not.toBeNull();
      expect(archivedTitle!.x).toBeCloseTo(currentTitle!.x, 1);
      await expect(archived.locator(".session-meta .archived-badge")).toBeVisible();
      await expect(archived).toHaveCSS("opacity", "1");
      for (const selector of [
        ".session-name",
        ".session-project",
        ".session-time",
        ".session-count",
        ".archived-badge",
        ".side-meta",
      ]) {
        await expect(archived.locator(selector)).toHaveCSS("opacity", "0.45");
      }
      await page
        .locator("#session-sidebar")
        .screenshot({ path: testInfo.outputPath("archived-sidebar.png") });
      await archived.hover();
      await expect(archived.locator(".session-name")).toHaveCSS("opacity", "1");
      await expect(archived.locator(".session-time")).toHaveCSS("opacity", "1");
      await page.mouse.move(0, 0);
      await archived.focus();
      await expect(archived.locator(".session-name")).toHaveCSS("opacity", "1");
      await current.focus();
      const onlyArchived = await openArchiveFilter(page);
      await onlyArchived.check();
      await expect(archived.locator(".session-name")).toHaveCSS("opacity", "1");
    });
  }
}

test("archive indicators open the session and never replace the favorite action", async ({
  page,
}) => {
  await setupArchiveSessions(page);
  await page.addInitScript(() =>
    localStorage.setItem("agentsview-archived-session-visibility", "dim"),
  );
  await page.route("**/api/v1/starred", (route) =>
    route.fulfill({ json: { session_ids: ["archive-test-1"] } }),
  );
  await page.route("**/api/v1/sessions/*/star", (route) =>
    route.fulfill({ json: { starred: false } }),
  );
  let archiveCalls = 0;
  page.on("request", (request) => {
    if (request.url().endsWith("/sessions/batch-archive")) archiveCalls++;
  });
  await page.goto("/sessions");
  const archived = page.locator('.session-item[data-session-id="archive-test-1"]');
  const star = archived.getByRole("button", { name: "Unstar session", exact: true });
  await expect(star).toBeVisible();
  await star.click();
  await expect(archived.locator(".star-btn")).not.toHaveClass(/starred/);
  await expect(archived.locator(".archived-badge")).toBeVisible();
  await archived.locator(".archived-badge").click();
  await expect(page.getByRole("button", { name: "Unarchive", exact: true })).toBeVisible();
  await expect(archived.locator(".session-name")).toHaveCSS("opacity", "1");
  expect(archiveCalls).toBe(0);
});
