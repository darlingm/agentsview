// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { mount, tick, unmount } from "svelte";
import type { DbMessage as Message } from "../../api/generated/index.js";
import { messages } from "../../stores/messages.svelte.js";
import { readProgress } from "../../stores/read-progress.svelte.js";
import { sessions } from "../../stores/sessions.svelte.js";
import { ui } from "../../stores/ui.svelte.js";
import { setLocale } from "../../i18n/index.js";

const virtualizerMock = vi.hoisted(() => ({
  options: { count: 0 },
  scrollOffset: 0,
  scrollRect: { height: 200 },
  getVirtualItems: vi.fn<
    () => Array<{
      index: number;
      key: string;
      start: number;
      end: number;
    }>
  >(() => []),
  getTotalSize: vi.fn(() => 120),
  measureElement: vi.fn(),
  scrollToIndex: vi.fn(),
  scrollToOffset: vi.fn(),
  getOffsetForIndex: vi.fn(),
}));

vi.mock("../../virtual/createVirtualizer.svelte.js", () => ({
  createVirtualizer: (optsFn: () => { count: number }) => ({
    get instance() {
      virtualizerMock.options.count = optsFn().count;
      return virtualizerMock;
    },
  }),
}));

// @ts-ignore
import MessageList from "./MessageList.svelte";

function makeMessage(ordinal: number): Message {
  return {
    id: ordinal + 1,
    session_id: "s1",
    ordinal,
    role: ordinal % 2 === 0 ? "user" : "assistant",
    content: `msg ${ordinal}`,
    timestamp: new Date(ordinal * 1000).toISOString(),
    has_thinking: false,
    thinking_text: "",
    has_tool_use: false,
    content_length: 6,
    model: "",
    token_usage: null,
    context_tokens: 0,
    output_tokens: 0,
    has_context_tokens: false,
    has_output_tokens: false,
    is_system: false,
  };
}

function makeToolMessage(ordinal: number): Message {
  return {
    ...makeMessage(ordinal),
    id: 700000 + ordinal,
    role: "assistant",
    content: "",
    content_length: 0,
    has_tool_use: true,
    tool_calls: [{ tool_name: "Bash", category: "Bash", input_json: '{"command":"pwd"}' }],
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function setVirtualRows(count: number) {
  virtualizerMock.getVirtualItems.mockReturnValue(
    Array.from({ length: count }, (_, index) => ({
      index,
      key: `row-${index}`,
      start: index * 100,
      end: index * 100 + 100,
    })),
  );
}

describe("MessageList follow cancellation", () => {
  let component: ReturnType<typeof mount> | undefined;
  let rafSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    virtualizerMock.scrollOffset = 0;
    virtualizerMock.scrollRect.height = 200;
    messages.clear();
    sessions.activeSessionId = "s1";
    messages.sessionId = "s1";
    messages.messages = [makeMessage(10)];
    messages.messageCount = 11;
    messages.activeSessionToken = "current";
    messages.hasOlder = true;
    ui.followLatest = true;
    ui.followLatestRequest = 1;
    ui.sortNewestFirst = false;
    ui.toolGroupsExpanded = true;
    ui.showAllBlocks();
    ui.setTranscriptMode("normal");
    ui.selectedOrdinal = null;
    ui.pendingScrollOrdinal = null;
    ui.pendingScrollSession = null;
    readProgress.reset();
    setVirtualRows(1);
    rafSpy = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((cb: FrameRequestCallback) => {
        window.setTimeout(() => cb(performance.now()), 0);
        return 1;
      });
  });

  afterEach(() => {
    setLocale("en");
    if (component) {
      unmount(component);
      component = undefined;
    }
    rafSpy.mockRestore();
    messages.clear();
    sessions.activeSessionId = null;
    ui.followLatest = false;
    ui.toolGroupsExpanded = true;
    readProgress.reset();
    document.body.innerHTML = "";
  });

  it("renders empty and loading states in Simplified Chinese", async () => {
    setLocale("zh-CN");
    sessions.activeSessionId = null;
    messages.clear();

    component = mount(MessageList, { target: document.body });
    await tick();

    expect(document.body.textContent).toContain("选择一个会话查看消息");

    unmount(component);
    component = undefined;
    document.body.innerHTML = "";

    sessions.activeSessionId = "s1";
    messages.sessionId = "s1";
    messages.messages = [];
    messages.loading = true;

    component = mount(MessageList, { target: document.body });
    await tick();

    expect(document.body.textContent).toContain("正在加载消息...");
  });

  it("keeps delayed ordinal navigation alive after follow latest is disabled", async () => {
    const loaded = deferred<void>();
    const ensureSpy = vi.spyOn(messages, "ensureOrdinalLoaded").mockImplementation(async () => {
      await loaded.promise;
      messages.messages = [makeMessage(0), makeMessage(10)];
    });

    component = mount(MessageList, { target: document.body });
    await tick();

    ui.setFollowLatest(false);
    (
      component as ReturnType<typeof mount> & {
        scrollToOrdinal: (ordinal: number) => void;
      }
    ).scrollToOrdinal(0);
    await tick();

    loaded.resolve();
    await tick();
    await vi.waitFor(() => {
      expect(virtualizerMock.scrollToIndex).toHaveBeenCalled();
    });

    expect(ensureSpy).toHaveBeenCalledWith(0);
    expect(virtualizerMock.scrollToIndex).toHaveBeenCalledWith(0, {
      align: "start",
    });
  });

  it("renders an unknown revision divider at the earliest message", async () => {
    messages.messages = [makeMessage(0), makeMessage(1), makeMessage(2), makeMessage(3)];
    messages.messageCount = 4;
    messages.activeSessionToken = "current";
    setVirtualRows(4);
    readProgress.baseline("s1", "previous", 1);

    component = mount(MessageList, { target: document.body });
    await tick();

    const divider = document.querySelector(".read-progress-divider");
    expect(divider?.textContent).toContain("New messages");
    expect(divider?.closest(".virtual-row")?.getAttribute("data-index")).toBe("0");
  });

  it("suppresses the newest-first divider when no read history exists", async () => {
    messages.messages = [makeMessage(0), makeMessage(1), makeMessage(2), makeMessage(3)];
    messages.messageCount = 4;
    messages.activeSessionToken = "current";
    ui.sortNewestFirst = true;
    setVirtualRows(4);
    readProgress.baseline("s1", "previous", 1);

    component = mount(MessageList, { target: document.body });
    await tick();

    const divider = document.querySelector(".read-progress-divider");
    expect(divider).toBeNull();
  });

  it.each([
    { newestFirst: false, endpoint: "boundary" },
    { newestFirst: true, endpoint: "boundary" },
    { newestFirst: false, endpoint: "latest" },
    { newestFirst: true, endpoint: "latest" },
  ])(
    "acknowledges a visible collapsed group containing the $endpoint, newestFirst=$newestFirst",
    async ({ newestFirst, endpoint }) => {
      messages.messages = [
        makeMessage(0),
        makeToolMessage(1),
        makeToolMessage(2),
        endpoint === "latest" ? makeToolMessage(3) : makeMessage(3),
      ];
      messages.messageCount = 4;
      messages.activeSessionUnreadOrdinal = endpoint === "boundary" ? 2 : 0;
      messages.hasOlder = false;
      ui.followLatest = false;
      ui.sortNewestFirst = newestFirst;
      ui.toolGroupsExpanded = false;
      virtualizerMock.scrollRect.height = 400;
      setVirtualRows(endpoint === "latest" ? 2 : 3);
      readProgress.baseline("s1", "previous", 0);
      component = mount(MessageList, { target: document.body });
      await tick();

      const scroller = document.querySelector<HTMLElement>(".message-list-scroll")!;
      const header = document.querySelector<HTMLElement>(".tool-group-header")!;
      vi.spyOn(scroller, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 100, 800, 400));
      vi.spyOn(header, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 200, 800, 24));
      expect(document.querySelector<HTMLElement>(".tool-group-body")!.hidden).toBe(true);
      scroller.dispatchEvent(new Event("scroll"));

      await vi.waitFor(() => {
        expect(readProgress.get("s1")).toMatchObject({ token: "current", ordinal: 3 });
      });
    },
  );

  it.each([false, true])(
    "does not count an offscreen collapsed header, newestFirst=%s",
    async (newestFirst) => {
      messages.messages = [1, 2].map(makeToolMessage);
      messages.messageCount = 3;
      messages.activeSessionUnreadOrdinal = 1;
      messages.hasOlder = false;
      ui.followLatest = false;
      ui.sortNewestFirst = newestFirst;
      ui.toolGroupsExpanded = false;
      setVirtualRows(1);
      readProgress.baseline("s1", "previous", 0);
      component = mount(MessageList, { target: document.body });
      await tick();

      const scroller = document.querySelector<HTMLElement>(".message-list-scroll")!;
      const header = document.querySelector<HTMLElement>(".tool-group-header")!;
      vi.spyOn(scroller, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 100, 800, 200));
      const headerRect = vi
        .spyOn(header, "getBoundingClientRect")
        .mockReturnValue(new DOMRect(0, 350, 800, 24));
      scroller.dispatchEvent(new Event("scroll"));
      await new Promise((resolve) => window.setTimeout(resolve, 20));
      expect(readProgress.get("s1")?.token).toBe("previous");

      headerRect.mockReturnValue(new DOMRect(0, 110, 800, 24));
      scroller.dispatchEvent(new Event("scroll"));
      await vi.waitFor(() => {
        expect(readProgress.get("s1")?.token).toBe("current");
      });
    },
  );

  it.each([false, true])(
    "counts expanded group messages individually until manually collapsed, newestFirst=%s",
    async (newestFirst) => {
      messages.messages = [1, 2].map(makeToolMessage);
      messages.messageCount = 3;
      messages.activeSessionUnreadOrdinal = 1;
      messages.hasOlder = false;
      ui.followLatest = false;
      ui.sortNewestFirst = newestFirst;
      setVirtualRows(1);
      readProgress.baseline("s1", "previous", 0);
      component = mount(MessageList, { target: document.body });
      await tick();

      const scroller = document.querySelector<HTMLElement>(".message-list-scroll")!;
      const header = document.querySelector<HTMLElement>(".tool-group-header")!;
      vi.spyOn(scroller, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 100, 800, 200));
      vi.spyOn(header, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 110, 800, 24));
      // The header is visible, but only one of the two message rows has been seen.
      vi.spyOn(
        document.querySelector<HTMLElement>('[data-message-ordinal="1"]')!,
        "getBoundingClientRect",
      ).mockReturnValue(new DOMRect(0, 140, 800, 80));
      vi.spyOn(
        document.querySelector<HTMLElement>('[data-message-ordinal="2"]')!,
        "getBoundingClientRect",
      ).mockReturnValue(new DOMRect(0, 400, 800, 80));
      scroller.dispatchEvent(new Event("scroll"));
      await new Promise((resolve) => window.setTimeout(resolve, 20));
      expect(readProgress.get("s1")?.token).toBe("previous");

      document.querySelector<HTMLButtonElement>(".tool-group-toggle")!.click();
      await tick();
      // Collapsing must recheck progress without requiring another scroll.
      await vi.waitFor(() => {
        expect(readProgress.get("s1")?.token).toBe("current");
      });
    },
  );

  it("does not mark newest-first updates read while only older rows are visible", async () => {
    messages.messages = [
      makeMessage(0),
      makeMessage(1),
      makeMessage(2),
      makeMessage(3),
      makeMessage(4),
    ];
    messages.messageCount = 5;
    messages.activeSessionToken = "current";
    ui.sortNewestFirst = true;
    setVirtualRows(5);
    virtualizerMock.scrollOffset = 300;
    readProgress.baseline("s1", "previous", 1);

    component = mount(MessageList, { target: document.body });
    await tick();
    document.querySelector<HTMLElement>(".message-list-scroll")?.dispatchEvent(new Event("scroll"));

    await new Promise((resolve) => window.setTimeout(resolve, 20));
    expect(readProgress.get("s1")?.token).toBe("previous");
  });

  it("requires conservative unread endpoints after a direct boundary jump", async () => {
    messages.messages = [
      makeMessage(0),
      makeMessage(1),
      makeMessage(2),
      makeMessage(3),
      makeMessage(4),
    ];
    messages.messageCount = 5;
    messages.activeSessionToken = "current";
    ui.sortNewestFirst = true;
    virtualizerMock.getVirtualItems.mockReturnValue([
      { index: 2, key: "row-2", start: 0, end: 100 },
    ]);
    readProgress.baseline("s1", "previous", 1);

    component = mount(MessageList, { target: document.body });
    await tick();
    await new Promise((resolve) => window.setTimeout(resolve, 20));

    expect(readProgress.get("s1")?.token).toBe("previous");

    virtualizerMock.getVirtualItems.mockReturnValue([
      { index: 0, key: "row-0", start: 0, end: 100 },
      { index: 4, key: "row-4", start: 100, end: 200 },
    ]);
    document.querySelector<HTMLElement>(".message-list-scroll")?.dispatchEvent(new Event("scroll"));
    await new Promise((resolve) => window.setTimeout(resolve, 20));

    expect(readProgress.get("s1")?.token).toBe("current");
  });

  it("acknowledges focused-mode traversal when the raw boundary is hidden", async () => {
    messages.messages = [
      { ...makeMessage(0), role: "user" },
      { ...makeMessage(1), role: "assistant" },
      { ...makeMessage(2), role: "assistant" },
      { ...makeMessage(3), role: "user" },
      { ...makeMessage(4), role: "assistant" },
    ];
    messages.messageCount = 5;
    messages.activeSessionToken = "current";
    ui.sortNewestFirst = true;
    ui.setTranscriptMode("focused");
    setVirtualRows(4);
    readProgress.baseline("s1", "previous", 0);

    component = mount(MessageList, { target: document.body });
    await tick();
    await new Promise((resolve) => window.setTimeout(resolve, 20));

    expect(readProgress.get("s1")?.token).toBe("previous");

    virtualizerMock.scrollOffset = 200;
    document.querySelector<HTMLElement>(".message-list-scroll")?.dispatchEvent(new Event("scroll"));
    await new Promise((resolve) => window.setTimeout(resolve, 20));

    expect(readProgress.get("s1")?.token).toBe("current");
  });

  it("hides system boundary cards when the system block is filtered out", async () => {
    messages.messages = [
      {
        ...makeMessage(0),
        role: "user",
        content: "<task-notification>\n<status>completed</status>\n</task-notification>",
        is_system: true,
        source_subtype: "task_notification",
      },
    ];
    messages.messageCount = 1;
    setVirtualRows(1);

    component = mount(MessageList, { target: document.body });
    await tick();
    expect(document.querySelector(".system-boundary")).not.toBeNull();

    ui.setBlockVisible("system", false);
    await tick();

    expect(document.querySelector(".system-boundary")).toBeNull();
  });

  it("keeps a code-only message visible as a collapsed placeholder when Code is filtered", async () => {
    const content = ["```latex", "\\subsection{Deployment Considerations}", "```"].join("\n");
    messages.messages = [
      {
        ...makeMessage(0),
        role: "assistant",
        content,
        content_length: content.length,
      },
    ];
    messages.messageCount = 1;
    ui.setBlockVisible("code", false);
    setVirtualRows(1);

    component = mount(MessageList, { target: document.body });
    await tick();

    const toggle = document.querySelector<HTMLButtonElement>(".code-fence-toggle");
    expect(toggle).not.toBeNull();
    expect(toggle?.textContent?.replace(/\s+/g, " ").trim()).toBe(
      "Code block collapsed · latex · Expand",
    );
    expect(document.querySelector(".code-content")).toBeNull();
  });

  it("acknowledges traversal when a block filter hides the raw boundary", async () => {
    messages.messages = [
      { ...makeMessage(0), role: "assistant" },
      { ...makeMessage(1), role: "user" },
      { ...makeMessage(2), role: "user" },
    ];
    messages.messageCount = 3;
    messages.activeSessionToken = "current";
    ui.setBlockVisible("assistant", false);
    setVirtualRows(2);
    readProgress.baseline("s1", "previous", 0);

    component = mount(MessageList, { target: document.body });
    await tick();
    await new Promise((resolve) => window.setTimeout(resolve, 20));

    expect(readProgress.get("s1")?.token).toBe("current");
  });

  it("rechecks visible progress when filters change after mounting", async () => {
    messages.messages = [
      { ...makeMessage(0), role: "user" },
      { ...makeMessage(1), role: "assistant" },
      { ...makeMessage(2), role: "user" },
    ];
    messages.messageCount = 3;
    messages.activeSessionToken = "current";
    ui.sortNewestFirst = true;
    setVirtualRows(2);
    readProgress.baseline("s1", "previous", 0);

    component = mount(MessageList, { target: document.body });
    await tick();
    await new Promise((resolve) => window.setTimeout(resolve, 20));
    expect(readProgress.get("s1")?.token).toBe("previous");

    ui.setBlockVisible("assistant", false);
    await tick();
    await new Promise((resolve) => window.setTimeout(resolve, 20));

    expect(readProgress.get("s1")?.token).toBe("current");
  });

  it("marks a short newest-first transcript read when its unread boundary is initially visible", async () => {
    messages.messages = [makeMessage(0), makeMessage(1)];
    messages.messageCount = 2;
    messages.activeSessionToken = "current";
    ui.sortNewestFirst = true;
    setVirtualRows(2);
    readProgress.baseline("s1", "previous", 0);

    component = mount(MessageList, { target: document.body });
    await tick();
    await new Promise((resolve) => window.setTimeout(resolve, 20));

    expect(readProgress.get("s1")?.token).toBe("current");
  });

  it("does not acknowledge an earlier edit from the unchanged newest row", async () => {
    messages.messages = [makeMessage(0), makeMessage(1), makeMessage(2)];
    messages.messageCount = 3;
    messages.activeSessionToken = "current";
    messages.activeSessionUnreadOrdinal = 0;
    ui.sortNewestFirst = true;
    setVirtualRows(1);
    readProgress.baseline("s1", "previous", 2);

    component = mount(MessageList, { target: document.body });
    await tick();
    await new Promise((resolve) => window.setTimeout(resolve, 20));

    expect(readProgress.get("s1")?.token).toBe("previous");

    virtualizerMock.getVirtualItems.mockReturnValue([
      { index: 2, key: "row-2", start: 0, end: 100 },
    ]);
    document.querySelector<HTMLElement>(".message-list-scroll")?.dispatchEvent(new Event("scroll"));
    await new Promise((resolve) => window.setTimeout(resolve, 20));

    expect(readProgress.get("s1")?.token).toBe("current");
  });

  it("conservatively traverses history when a reopened revision also appends", async () => {
    messages.messages = [makeMessage(0), makeMessage(1), makeMessage(2), makeMessage(3)];
    messages.messageCount = 4;
    messages.activeSessionToken = "current";
    messages.activeSessionUnreadOrdinal = null;
    ui.sortNewestFirst = true;
    virtualizerMock.getVirtualItems.mockReturnValue([
      { index: 0, key: "row-0", start: 0, end: 100 },
    ]);
    readProgress.baseline("s1", "previous", 2);

    component = mount(MessageList, { target: document.body });
    await tick();
    await new Promise((resolve) => window.setTimeout(resolve, 20));

    expect(readProgress.get("s1")?.token).toBe("previous");

    virtualizerMock.getVirtualItems.mockReturnValue([
      { index: 3, key: "row-3", start: 0, end: 100 },
    ]);
    document.querySelector<HTMLElement>(".message-list-scroll")?.dispatchEvent(new Event("scroll"));
    await new Promise((resolve) => window.setTimeout(resolve, 20));

    expect(readProgress.get("s1")?.token).toBe("current");
  });

  it("keeps an appended unread boundary immutable before traversal", async () => {
    messages.messages = [
      makeMessage(0),
      makeMessage(1),
      makeMessage(2),
      makeMessage(3),
      makeMessage(4),
    ];
    messages.messageCount = 5;
    messages.activeSessionToken = "current";
    messages.activeSessionUnreadOrdinal = null;
    virtualizerMock.getVirtualItems.mockReturnValue([
      { index: 4, key: "row-4", start: 0, end: 100 },
    ]);
    readProgress.baseline("s1", "previous", 1);

    component = mount(MessageList, { target: document.body });
    await tick();
    await new Promise((resolve) => window.setTimeout(resolve, 20));

    expect(readProgress.get("s1")).toMatchObject({
      token: "previous",
      ordinal: 1,
    });
  });

  it("does not acknowledge a boundary hidden by a visible ordinal gap", async () => {
    messages.messages = [makeMessage(0), makeMessage(1), makeMessage(2)];
    messages.messageCount = 3;
    messages.activeSessionToken = "current";
    messages.activeSessionUnreadOrdinal = 1;
    virtualizerMock.getVirtualItems.mockReturnValue([
      { index: 0, key: "row-0", start: 0, end: 100 },
      { index: 2, key: "row-2", start: 100, end: 200 },
    ]);
    readProgress.baseline("s1", "previous", 2);

    component = mount(MessageList, { target: document.body });
    await tick();
    await new Promise((resolve) => window.setTimeout(resolve, 20));

    expect(readProgress.get("s1")?.token).toBe("previous");
  });

  it("skips a hidden system ordinal when inferring an appended boundary", async () => {
    messages.messages = [makeMessage(0), { ...makeMessage(1), is_system: true }, makeMessage(2)];
    messages.messageCount = 3;
    messages.activeSessionToken = "current";
    messages.activeSessionUnreadOrdinal = null;
    setVirtualRows(2);
    readProgress.baseline("s1", "previous", 0);

    component = mount(MessageList, { target: document.body });
    await tick();
    await new Promise((resolve) => window.setTimeout(resolve, 20));

    expect(readProgress.get("s1")?.token).toBe("current");
  });

  it("acknowledges a revised transcript with only system messages", async () => {
    messages.messages = [{ ...makeMessage(0), is_system: true }];
    messages.messageCount = 1;
    messages.activeSessionToken = "current";
    setVirtualRows(0);
    readProgress.baseline("s1", "previous", 0);

    component = mount(MessageList, { target: document.body });
    await tick();
    await new Promise((resolve) => window.setTimeout(resolve, 20));

    expect(readProgress.get("s1")?.token).toBe("current");
  });
});
