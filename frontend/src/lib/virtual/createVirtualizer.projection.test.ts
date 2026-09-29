// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { mount, tick, unmount } from "svelte";
import type { Virtualizer } from "@tanstack/virtual-core";
import VirtualizerTest from "./VirtualizerTest.svelte";
import VirtualizerProjectionTest from "./VirtualizerProjectionTest.svelte";

type Instance = Virtualizer<HTMLElement, HTMLElement>;
type Snapshot = { keys: Array<string | number | bigint>; starts: number[]; total: number };

let component: ReturnType<typeof mount> | undefined;

afterEach(async () => {
  if (component) await unmount(component);
  component = undefined;
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("virtualizer projection changes", () => {
  it("keeps measured DOM rows aligned when filtering and restoring the transcript", async () => {
    // jsdom has no layout. Supply row geometry while retaining real DOM actions
    // and TanStack's measurement cache rather than substituting estimated sizes.
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        return DOMRect.fromRect({ width: 800, height: Number(this.dataset.height ?? 1000) });
      },
    );
    const normal = [
      { key: "user", height: 100 },
      { key: "tools", height: 50 },
      { key: "answer", height: 500 },
    ];
    const controller = mount(VirtualizerProjectionTest, {
      target: document.body,
      props: {
        initialItems: normal,
      },
    });
    component = controller;

    async function expectRows(keys: string[], starts: number[], total: number) {
      // Assert after Svelte flushes, without allowing a later timer or scroll
      // to repair stale positions that could already have been painted.
      await tick();
      const rows = [...document.querySelectorAll<HTMLElement>("[data-row]")];
      expect(rows.map((row) => row.dataset.row)).toEqual(keys);
      expect(rows.map((row) => Number(row.dataset.start))).toEqual(starts);
      expect(Number(document.querySelector<HTMLElement>("[data-total]")!.dataset.total)).toBe(
        total,
      );
      for (let index = 1; index < rows.length; index++) {
        const previous = rows[index - 1]!;
        expect(Number(rows[index]!.dataset.start)).toBeGreaterThanOrEqual(
          Number(previous.dataset.start) + Number(previous.dataset.height),
        );
      }
    }

    await expectRows(["user", "tools", "answer"], [0, 100, 150], 650);
    for (let cycle = 0; cycle < 2; cycle++) {
      controller.setItems([normal[0]!, normal[2]!]);
      await expectRows(["user", "answer"], [0, 100], 600);
      controller.setItems(normal);
      await expectRows(["user", "tools", "answer"], [0, 100, 150], 650);
    }
  });

  it("updates visible rows at scroll zero when filtering and restoring keyed items", async () => {
    const scroller = document.createElement("div");
    document.body.append(scroller);
    const snapshots: Snapshot[] = [];
    const normal = [
      { key: "user", height: 100 },
      { key: "tools", height: 50 },
      { key: "answer", height: 500 },
    ];
    const focused = [normal[0]!, normal[2]!];
    const baseOptions = {
      measureCacheKey: "session",
      getScrollElement: () => scroller,
      observeElementRect: (
        _instance: Instance,
        callback: (rect: { width: number; height: number }) => void,
      ) => {
        callback({ width: 800, height: 1000 });
        return () => {};
      },
      observeElementOffset: (
        _instance: Instance,
        callback: (offset: number, scrolling: boolean) => void,
      ) => {
        callback(0, false);
        return () => {};
      },
      scrollToFn: vi.fn(),
      overscan: 0,
    };
    const options = (items: typeof normal) => ({
      ...baseOptions,
      count: items.length,
      getItemKey: (index: number) => items[index]!.key,
      estimateSize: (index: number) => items[index]!.height,
    });
    component = mount(VirtualizerTest, {
      target: document.body,
      props: {
        type: "element",
        options: options(normal),
        onInstanceChange: (instance: Instance | undefined) => {
          if (!instance) return;
          const rows = instance.getVirtualItems();
          snapshots.push({
            keys: rows.map((row) => row.key),
            starts: rows.map((row) => row.start),
            total: instance.getTotalSize(),
          });
        },
      },
    });
    await tick();
    await vi.waitFor(() => {
      expect(snapshots.at(-1)).toEqual({
        keys: ["user", "tools", "answer"],
        starts: [0, 100, 150],
        total: 650,
      });
    });

    const controller = component as ReturnType<typeof mount> & {
      setOptions: (value: ReturnType<typeof options>) => void;
    };
    controller.setOptions(options(focused));
    await tick();
    await vi.waitFor(() => {
      expect(snapshots.at(-1)).toEqual({
        keys: ["user", "answer"],
        starts: [0, 100],
        total: 600,
      });
    });

    controller.setOptions(options(normal));
    await tick();
    await vi.waitFor(() => {
      expect(snapshots.at(-1)).toEqual({
        keys: ["user", "tools", "answer"],
        starts: [0, 100, 150],
        total: 650,
      });
    });
    expect(scroller.scrollTop).toBe(0);
  });
});
