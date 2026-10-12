<script lang="ts">
  import type { Virtualizer } from "@tanstack/virtual-core";
  import { createVirtualizer } from "./createVirtualizer.svelte.js";

  type Item = { key: string; height: number };
  let { initialItems }: { initialItems: Item[] } = $props();
  // svelte-ignore state_referenced_locally
  let items = $state(initialItems);
  let scroller = $state<HTMLDivElement>();
  const virtualizer = createVirtualizer(() => {
    const projection = items;
    return {
      count: projection.length,
      getItemKey: (index) => projection[index]?.key ?? index,
      getScrollElement: () => scroller ?? null,
      estimateSize: () => 80,
      measureElement: (node) => node.getBoundingClientRect().height,
      observeElementRect: (_instance, callback) => {
        callback({ width: 800, height: 1000 });
        return () => {};
      },
      observeElementOffset: (_instance, callback) => {
        callback(0, false);
        return () => {};
      },
      scrollToFn: () => {},
    };
  });

  // Mirror MessageList's measured keyed rows, including action updates.
  function measureElement(
    node: HTMLElement,
    instance: Virtualizer<HTMLElement, HTMLElement> | undefined,
  ) {
    instance?.measureElement(node);
    return {
      update(next: Virtualizer<HTMLElement, HTMLElement> | undefined) {
        next?.measureElement(node);
      },
    };
  }

  export function setItems(next: Item[]) {
    items = next;
  }
</script>

<div bind:this={scroller}>
  <div data-total={virtualizer.instance?.getTotalSize() ?? 0}>
    {#each virtualizer.instance?.getVirtualItems() ?? [] as row (row.key)}
      {@const item = items[row.index]}
      {#if item}
        <div
          data-row={item.key}
          data-index={row.index}
          data-height={item.height}
          data-start={row.start}
          use:measureElement={virtualizer.instance}
        >{item.key}</div>
      {/if}
    {/each}
  </div>
</div>
