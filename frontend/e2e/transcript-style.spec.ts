import { expect, test, type Locator, type Page } from "@playwright/test";
import type { DbMessage as Message } from "../src/lib/api/generated/index.js";

const SESSION_ID = "test-session-xlarge-5500";

function message(ordinal: number, content: string, extra: Partial<Message> = {}): Message {
  return {
    id: 990000 + ordinal,
    session_id: SESSION_ID,
    ordinal,
    role: "assistant",
    content,
    content_length: content.length,
    timestamp: "2026-01-01T00:00:00Z",
    has_thinking: false,
    thinking_text: "",
    has_tool_use: false,
    model: "",
    context_tokens: 0,
    has_context_tokens: false,
    output_tokens: 0,
    has_output_tokens: false,
    is_system: false,
    ...extra,
  };
}

const messages = [
  message(
    0,
    "Please review [this change](https://example.com/review).\n\n> Keep existing behavior.",
    {
      role: "user",
    },
  ),
  message(1, "[Thinking]\nI will review the interface.\n[/Thinking]\n\nI will inspect the code.", {
    has_thinking: true,
  }),
  message(2, "", {
    has_tool_use: true,
    tool_calls: [{ tool_name: "Bash", category: "Bash", result_content: "done" }],
  }),
  message(3, "", {
    has_tool_use: true,
    tool_calls: [
      { tool_name: "Read", category: "Read", result_content: "first file" },
      { tool_name: "Read", category: "Read", result_content: "second file" },
    ],
  }),
  message(4, "[Skill: interface-review]\nReview the interface.\n[/Skill]\n\nReview complete."),
  message(5, "Session resumed.", { is_system: true, source_subtype: "resume" }),
  message(6, "Earlier messages were summarized.", { is_system: true, is_compact_boundary: true }),
  message(7, "The change preserves existing behavior."),
];

async function installTranscript(page: Page) {
  await page.route(`**/api/v1/sessions/${SESSION_ID}`, async (route) => {
    const response = await route.fetch();
    const session = await response.json();
    await route.fulfill({ response, json: { ...session, message_count: messages.length } });
  });
  await page.route(`**/api/v1/sessions/${SESSION_ID}/messages*`, (route) =>
    route.fulfill({ json: { messages, count: messages.length } }),
  );
}

async function openTranscript(page: Page) {
  await page.goto(`/sessions/${SESSION_ID}`, { waitUntil: "domcontentloaded" });
  await expect(page.locator(".message-list-scroll")).toHaveAttribute("data-loaded", "true");
  await expect(page.locator(".message.is-user")).toHaveCount(1);
}

async function appearance(locator: Locator) {
  return locator.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      borders: [
        style.borderTopWidth,
        style.borderRightWidth,
        style.borderBottomWidth,
        style.borderLeftWidth,
      ],
      radius: style.borderTopLeftRadius,
      background: style.backgroundColor,
      padding: style.padding,
      color: style.borderTopColor,
    };
  });
}

async function expectCard(locator: Locator, token: string) {
  await expect(locator).toHaveCount(1);
  const card = await appearance(locator);
  expect(card.borders).toEqual(["1px", "1px", "1px", "1px"]);
  expect(parseFloat(card.radius)).toBeGreaterThan(0);
  expect(card.background).not.toBe("rgba(0, 0, 0, 0)");
  const accent = await locator.evaluate((element, name) => {
    const probe = document.createElement("span");
    probe.style.color = `var(${name})`;
    element.appendChild(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  }, token);
  expect(card.color).toBe(accent);
}

async function cardContrast(
  card: Locator,
  property: "color" | "borderTopColor",
  selector?: string,
) {
  return card.evaluate(
    (element, { property, selector }) => {
      // color-mix() can serialize as color(srgb ...). Canvas resolves both that
      // form and rgb() to the same channels without depending on serialization.
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1;
      const context = canvas.getContext("2d")!;
      function paint(color: string) {
        context.fillStyle = color;
        context.fillRect(0, 0, 1, 1);
      }
      function luminance() {
        const channels = context.getImageData(0, 0, 1, 1).data.slice(0, 3);
        const linear = Array.from(channels, (channel) => {
          const value = channel / 255;
          return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
        });
        return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!;
      }
      // Stream layouts and nested cards can have transparent backgrounds.
      // Composite ancestors rather than treating transparent RGB as opaque.
      const ancestors: Element[] = [];
      for (let node: Element | null = element; node; node = node.parentElement) {
        ancestors.unshift(node);
      }
      paint("white");
      for (const ancestor of ancestors) {
        paint(getComputedStyle(ancestor).backgroundColor);
      }
      const background = luminance();
      const foreground = selector ? element.querySelector(selector)! : element;
      paint(getComputedStyle(foreground)[property]);
      const ink = luminance();
      return (Math.max(ink, background) + 0.05) / (Math.min(ink, background) + 0.05);
    },
    { property, selector },
  );
}

for (const theme of ["dark", "light"]) {
  for (const contrast of [false, true]) {
    for (const layout of ["default", "compact", "stream", "skim"]) {
      test(`outlined cards: ${theme}, contrast=${contrast}, ${layout}`, async ({ page }) => {
        await page.addInitScript(
          ({ theme, contrast, layout }) => {
            localStorage.setItem("theme", theme);
            localStorage.setItem("theme-high-contrast", String(contrast));
            localStorage.setItem("agentsview-message-layout", layout);
            localStorage.setItem("agentsview-transcript-mode", "normal");
            localStorage.setItem("agentsview-transcript-style", "outlined");
            localStorage.setItem("agentsview-block-filters", JSON.stringify({ hidden: [] }));
          },
          { theme, contrast, layout },
        );
        await installTranscript(page);
        await openTranscript(page);
        const transcript = page.locator(".message-list-scroll");
        await expect(transcript).toHaveClass(new RegExp(`layout-${layout}`));
        expect(await page.locator("html").evaluate((el) => el.classList.contains("dark"))).toBe(
          theme === "dark",
        );
        expect(
          await page.locator("html").evaluate((el) => el.classList.contains("high-contrast")),
        ).toBe(contrast);

        await expectCard(transcript.locator(".message.is-user"), "--accent-blue");
        const user = transcript.locator(".message.is-user");
        if (layout === "default" || layout === "compact") {
          expect(await cardContrast(user, "color", ".role-label")).toBeGreaterThanOrEqual(4.5);
        }
        expect(await cardContrast(user, "color", ".markdown a")).toBeGreaterThanOrEqual(4.5);
        await expectCard(transcript.locator(".tool-group"), "--accent-amber");
        await expectCard(transcript.locator(".thinking-block"), "--accent-purple");
        await expectCard(transcript.locator(".skill-block"), "--accent-teal");
        await expectCard(transcript.locator(".system-boundary"), "--text-muted");
        await expectCard(transcript.locator(".boundary-preview"), "--accent-amber");
        expect(
          (await appearance(transcript.locator(".message:not(.is-user)").last())).background,
        ).toBe("rgba(0, 0, 0, 0)");
        for (const nested of await transcript
          .locator(".tool-group .tool-block, .tool-group .parallel-group")
          .all()) {
          expect((await appearance(nested)).background).toBe("rgba(0, 0, 0, 0)");
        }
        // Thin separators and blockquote rails are not card accents.
        expect((await appearance(transcript.locator("blockquote"))).borders[3]).toBe("3px");
        expect(
          (await appearance(transcript.locator(".pg-members .tool-block").last())).borders[0],
        ).toBe("1px");
        if (layout === "stream" || layout === "skim") {
          await expect(transcript.locator(".message-header").first()).toBeHidden();
        } else {
          await expect(transcript.locator(".message-header").first()).toBeVisible();
        }
      });
    }
  }
}

test("defaults to accented and changes style without changing layout or contrast", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem("theme", "dark");
    localStorage.setItem("theme-high-contrast", "true");
    localStorage.setItem("agentsview-message-layout", "stream");
    localStorage.setItem("agentsview-block-filters", JSON.stringify({ hidden: [] }));
  });
  await installTranscript(page);
  await openTranscript(page);
  const user = page.locator(".message.is-user");
  const original = await appearance(user);
  expect(original.borders).toEqual(["0px", "0px", "0px", "0px"]);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .getByRole("navigation", { name: "Settings", exact: true })
    .getByRole("button", { name: /^Appearance/ })
    .click();
  await expect(page.getByRole("radio", { name: "Accented", exact: true })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await page.getByRole("radio", { name: "Outlined cards", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("agentsview-transcript-style")))
    .toBe("outlined");
  await openTranscript(page);
  await expectCard(user, "--accent-blue");
  expect((await appearance(user)).padding).toBe(original.padding);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expectCard(user, "--accent-blue");
  await expect(page.locator(".message-list-scroll")).toHaveClass(/layout-stream/);
  await expect(page.locator("html")).toHaveClass(/dark.*high-contrast/);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .getByRole("navigation", { name: "Settings", exact: true })
    .getByRole("button", { name: /^Appearance/ })
    .click();
  await page.getByRole("radio", { name: "Accented", exact: true }).click();
  await openTranscript(page);
  expect(await appearance(user)).toEqual(original);
});

for (const theme of ["dark", "light"]) {
  test(`nested subagent content has only the outer tint in ${theme}`, async ({ page }) => {
    await page.addInitScript((theme) => {
      localStorage.setItem("theme", theme);
      localStorage.setItem("theme-high-contrast", "true");
      localStorage.setItem("agentsview-transcript-style", "outlined");
      localStorage.setItem("agentsview-session-vitals", "true");
      localStorage.setItem("agentsview-block-filters", JSON.stringify({ hidden: [] }));
    }, theme);
    await page.goto("/sessions/test-session-duration-showcase", { waitUntil: "domcontentloaded" });
    const calls = page.locator("aside.vitals");
    await expectCard(calls.locator(".cgroup"), "--border-default");
    expect(await cardContrast(calls.locator(".cgroup"), "borderTopColor")).toBeGreaterThanOrEqual(
      3,
    );
    const task = calls.locator(".call").filter({ has: page.locator(".cn", { hasText: "Task" }) });
    await task.locator("button.chev").click();
    await expectCard(calls.locator(".sa-expand"), "--cat-task");
    await expect(calls.locator(".sa-expand .call").first()).toBeVisible();
    await page.mouse.move(0, 0);
    for (const nested of await calls.locator(".sa-expand .call, .sa-expand .cgroup").all()) {
      expect((await appearance(nested)).background).toBe("rgba(0, 0, 0, 0)");
    }
    await expectCard(page.locator(".message-list-scroll .parallel-group"), "--cat-mixed");
    await expectCard(
      page.locator(".message-list-scroll .tool-block:not(.in-group)").first(),
      "--accent-amber",
    );
    await page.locator(".subagent-toggle").click();
    const inline = page.locator(".subagent-messages");
    // The inline transcript is nested inside the parent parallel group.
    await expect(inline.locator(".message").first()).toBeVisible();
    expect((await appearance(inline)).background).toBe("rgba(0, 0, 0, 0)");
    for (const nested of await inline.locator(".message, .tool-block, .thinking-block").all()) {
      expect((await appearance(nested)).background).toBe("rgba(0, 0, 0, 0)");
    }
  });
}
