// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vite-plus/test";
import { sessionTiming } from "../../stores/sessionTiming.svelte.js";
import { ui } from "../../stores/ui.svelte.js";
import { SvelteMap } from "svelte/reactivity";
import type { ToolGroupDisclosure } from "./tool-group-disclosure.js";
import { mount, tick, unmount } from "svelte";
import type { DbMessage as Message } from "../../api/generated/index.js";
// @ts-ignore
import ToolCallGroup from "./ToolCallGroup.svelte";

function makeToolMessage(ordinal: number): Message {
  return {
    id: ordinal + 1,
    session_id: "s1",
    ordinal,
    role: "assistant",
    content: "",
    timestamp: new Date(ordinal * 1000).toISOString(),
    has_thinking: false,
    thinking_text: "",
    has_tool_use: true,
    content_length: 0,
    model: "",
    token_usage: null,
    context_tokens: 0,
    output_tokens: 0,
    has_context_tokens: false,
    has_output_tokens: false,
    tool_calls: [
      {
        category: "",
        tool_name: "bash",
      },
    ],
    is_system: false,
  };
}

afterEach(() => {
  sessionTiming.reset();
  ui.toolGroupsExpanded = true;
  document.body.innerHTML = "";
});

describe("ToolCallGroup", () => {
  it("starts expanded and preserves child disclosure state when toggled", async () => {
    const message = makeToolMessage(1);
    const component = mount(ToolCallGroup, {
      target: document.body,
      props: { messages: [message], timestamp: message.timestamp },
    });
    await tick();
    const header = document.querySelector<HTMLButtonElement>(".tool-group-toggle")!;
    const body = document.querySelector<HTMLElement>(".tool-group-body")!;
    const tool = document.querySelector<HTMLButtonElement>(".tool-header")!;
    expect(header.getAttribute("aria-expanded")).toBe("true");
    expect(header.getAttribute("aria-controls")).toBe(body.id);
    expect(body.hidden).toBe(false);
    tool.click();
    await tick();
    expect(tool.getAttribute("aria-expanded")).toBe("true");

    header.click();
    await tick();
    expect(header.getAttribute("aria-expanded")).toBe("false");
    expect(body.hidden).toBe(true);
    expect(header.textContent).toContain("1 tool call");
    expect(document.querySelector(".group-timestamp")).not.toBeNull();
    // The independent copy action must not be nested inside the toggle.
    expect(header.querySelector(".kit-copy-btn")).toBeNull();
    expect(document.querySelector(".tool-group-header .kit-copy-btn")).not.toBeNull();

    header.click();
    await tick();
    expect(body.hidden).toBe(false);
    expect(tool.getAttribute("aria-expanded")).toBe("true");
    await unmount(component);
  });

  it("starts collapsed when requested and keeps the read boundary visible", async () => {
    ui.toolGroupsExpanded = false;
    const message = makeToolMessage(1);
    const component = mount(ToolCallGroup, {
      target: document.body,
      props: {
        messages: [message],
        timestamp: message.timestamp,
        divider: { ordinal: 1, label: "New messages" },
      },
    });
    await tick();
    expect(document.querySelector<HTMLElement>(".tool-group-body")!.hidden).toBe(true);
    expect(document.querySelector(".tool-group > .read-progress-divider")?.textContent).toBe(
      "New messages",
    );
    document.querySelector<HTMLButtonElement>(".tool-group-toggle")!.click();
    await tick();
    expect(document.querySelector<HTMLElement>(".tool-group-body")!.hidden).toBe(false);
    expect(document.querySelector(".tool-group > .read-progress-divider")).toBeNull();
    await unmount(component);
  });

  it("retains a manual choice across virtual remounts, new calls, and sort order", async () => {
    const disclosures = new SvelteMap<string, ToolGroupDisclosure>();
    const first = makeToolMessage(1);
    const props = { messages: [first], timestamp: first.timestamp, disclosures };
    let component = mount(ToolCallGroup, { target: document.body, props });
    await tick();
    document.querySelector<HTMLButtonElement>(".tool-group-toggle")!.click();
    await tick();
    await unmount(component);

    component = mount(ToolCallGroup, {
      target: document.body,
      props: { ...props, messages: [first, makeToolMessage(2)], sortNewestFirst: true },
    });
    await tick();
    expect(document.querySelector<HTMLElement>(".tool-group-body")!.hidden).toBe(true);
    expect(document.querySelector(".group-label")?.textContent).toContain("2 tool calls");
    await unmount(component);

    const other = { ...first, session_id: "another-session" };
    component = mount(ToolCallGroup, {
      target: document.body,
      props: { ...props, messages: [other] },
    });
    await tick();
    expect(document.querySelector<HTMLElement>(".tool-group-body")!.hidden).toBe(false);
    await unmount(component);
  });

  it.each([true, false])(
    "preserves manual choices when older pages extend a group (default expanded=%s)",
    async (expanded) => {
      ui.toolGroupsExpanded = expanded;
      const disclosures = new SvelteMap<string, ToolGroupDisclosure>();
      let messages = [makeToolMessage(3), makeToolMessage(4)];
      const render = () =>
        mount(ToolCallGroup, {
          target: document.body,
          props: { messages, timestamp: messages[0]!.timestamp, disclosures },
        });
      let component = render();
      await tick();
      document.querySelector<HTMLButtonElement>(".tool-group-toggle")!.click();
      await tick();
      await unmount(component);

      messages = [makeToolMessage(2), ...messages];
      component = render();
      await tick();
      expect(document.querySelector<HTMLElement>(".tool-group-body")!.hidden).toBe(expanded);
      // A new choice must replace the inherited choice before another page arrives.
      document.querySelector<HTMLButtonElement>(".tool-group-toggle")!.click();
      await tick();
      await unmount(component);

      messages = [makeToolMessage(1), ...messages, makeToolMessage(5)];
      component = render();
      await tick();
      expect(document.querySelector<HTMLElement>(".tool-group-body")!.hidden).toBe(!expanded);
      await unmount(component);
    },
  );

  it("omits duration for legacy calls without stored timing", async () => {
    const message = makeToolMessage(1);
    message.tool_calls = [];
    message.content = "[Bash]\npwd";
    message.content_length = message.content.length;
    const component = mount(ToolCallGroup, {
      target: document.body,
      props: { messages: [message], timestamp: message.timestamp },
    });
    await tick();
    expect(document.querySelector(".tool-duration")).toBeNull();
    unmount(component);
  });

  it.each([
    { duration: 2000, running: false, label: "2.0s" },
    { duration: null, running: false, label: "unknown" },
    { duration: null, running: true, label: "running" },
    { duration: null, running: true, turnDurationMs: 5000, label: "unknown" },
  ])(
    "uses call evidence for $label, running=$running",
    async ({ duration, running, turnDurationMs, label }) => {
      const message = makeToolMessage(1);
      message.tool_calls = [
        {
          tool_use_id: "call-1",
          tool_name: "Bash",
          category: "Bash",
          input_json: '{"command":"pwd"}',
        },
      ];
      sessionTiming.timing = {
        session_id: "s1",
        total_duration_ms: 6000,
        tool_duration_ms: duration ?? 0,
        turn_count: 1,
        tool_call_count: 1,
        subagent_count: 0,
        slowest_call: null,
        by_category: [],
        activity: [],
        activity_totals: {
          tool_ms: duration ?? 0,
          unattributed_ms: 6000 - (duration ?? 0),
        },
        running,
        turns: [
          {
            message_id: 2,
            ordinal: 1,
            started_at: message.timestamp,
            duration_ms: turnDurationMs ?? (running ? null : 5000),
            primary_category: "Bash",
            calls: [
              {
                tool_use_id: "call-1",
                tool_name: "Bash",
                category: "Bash",
                duration_ms: duration,
                is_parallel: false,
                input_preview: "pwd",
              },
            ],
          },
        ],
      };
      const component = mount(ToolCallGroup, {
        target: document.body,
        props: { messages: [message], timestamp: message.timestamp },
      });
      await tick();

      const actual = document.querySelector(".tool-duration")?.textContent?.trim();
      if (label === "running") expect(actual).toMatch(/^running /);
      else if (label === "unknown") expect(actual).toBeUndefined();
      else expect(actual).toBe(label);
      expect(document.querySelector(".group-label")?.textContent).toContain("1 tool call");
      unmount(component);
    },
  );

  it("renders the read-progress divider inside grouped tool rows", async () => {
    const component = mount(ToolCallGroup, {
      target: document.body,
      props: {
        messages: [makeToolMessage(1), makeToolMessage(2)],
        timestamp: "2026-07-11T12:00:00Z",
        divider: {
          ordinal: 2,
          label: "New messages",
        },
      },
    });

    await tick();

    const divider = document.querySelector(".read-progress-divider");
    expect(divider?.textContent).toContain("New messages");
    expect(document.querySelector('[data-message-ordinal="2"]')).not.toBeNull();

    unmount(component);
  });
});
