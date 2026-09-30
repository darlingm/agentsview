<script lang="ts">
  import type { Snippet } from "svelte";
  import { ui } from "../../stores/ui.svelte.js";

  let { children }: { children: Snippet } = $props();
</script>

<div class="transcript-appearance" class:outlined={ui.transcriptStyle === "outlined"}>
  {@render children()}
</div>

<style>
  /* Style scope only: preserve the transcript's flex and virtual-row geometry. */
  .transcript-appearance { display: contents; }

  /* Inline role colors and layout overrides own the accented presentation.
     Only the opt-in style overrides them; padding, density and headers stay
     under the selected layout's control. */
  .outlined :global(.message) {
    border-left: none !important;
    border-radius: var(--radius-md) !important;
    background: transparent !important;
  }

  .outlined :global(.message.is-user) {
    border: 1px solid var(--accent-blue) !important;
    background: color-mix(in srgb, var(--accent-blue) 20%, var(--bg-primary)) !important;
  }

  /* Match kit-ui's toned ink recipe: the light-mode wash needs darker blue
     text. Keep dark-mode accents and the card's border color unchanged. */
  :global(:root:not(.dark)) .outlined :global(.message.is-user .role-label),
  :global(:root:not(.dark)) .outlined :global(.message.is-user .markdown a) {
    color: color-mix(in srgb, var(--accent-blue) 72%, var(--text-primary)) !important;
  }

  .outlined :global(.tool-group),
  .outlined :global(.tool-block:not(.in-group)),
  .outlined :global(.thinking-block),
  .outlined :global(.skill-block),
  .outlined :global(.parallel-group),
  .outlined :global(.subagent-messages),
  .outlined :global(.sa-expand),
  .outlined :global(.cgroup),
  .outlined :global(.system-boundary),
  .outlined :global(.boundary-preview) {
    border: 1px solid var(--transcript-card-color) !important;
    border-radius: var(--radius-md) !important;
    background: color-mix(
      in srgb, var(--transcript-card-color) var(--transcript-card-tint, 8%), var(--bg-primary)
    ) !important;
  }

  /* Keep hover backgrounds inside the card's rounded corners without clipping
     the headers' keyboard focus rings. Grouped tool rows inherit square corners. */
  .outlined :global(.tool-header-row),
  .outlined :global(.output-header-row),
  .outlined :global(.tool-header),
  .outlined :global(.thinking-header),
  .outlined :global(.skill-header) { border-radius: inherit; }

  .outlined :global(.tool-group),
  .outlined :global(.tool-block:not(.in-group)),
  .outlined :global(.boundary-preview) { --transcript-card-color: var(--accent-amber); }
  .outlined :global(.thinking-block) { --transcript-card-color: var(--accent-purple); }
  .outlined :global(.skill-block) { --transcript-card-color: var(--accent-teal); }
  .outlined :global(.parallel-group),
  .outlined :global(.cgroup) {
    --transcript-card-color: var(--cat-mixed);
    --transcript-card-tint: 12%;
  }
  /* Replacing CallGroup's rail must preserve its high-contrast color. */
  :global(.high-contrast) .outlined :global(.cgroup) {
    --transcript-card-color: var(--border-default);
  }
  .outlined :global(.subagent-messages) { --transcript-card-color: var(--accent-green); }
  .outlined :global(.sa-expand) {
    --transcript-card-color: var(--cat-task);
    --transcript-card-tint: 10%;
  }
  .outlined :global(.system-boundary) {
    --transcript-card-color: var(--text-muted);
    --transcript-card-tint: 6%;
  }

  /* One outline and wash per group, not a stack of tinted tool cards. */
  .outlined :global(.tool-group .tool-block),
  .outlined :global(.parallel-group .tool-block) {
    border-left: none !important;
    border-right: none !important;
    border-bottom: none !important;
    border-radius: 0 !important;
  }
  .outlined :global(.tool-group .tool-block:not(.in-group)),
  .outlined :global(.parallel-group .tool-block:not(.in-group)) {
    border-top: none !important;
  }
  .outlined :global(:is(.tool-group, .parallel-group, .subagent-messages, .sa-expand, .cgroup)
    :is(.message, .tool-block, .thinking-block, .skill-block, .parallel-group,
      .subagent-messages, .sa-expand, .cgroup, .call:not(:hover))) {
    background: transparent !important;
  }
  .outlined :global(.cgroup .cg-rail::before) { display: none; }
</style>
