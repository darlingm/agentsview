# A small conversation that reproduces missing transcript rows

This is synthetic sample data, not a captured private conversation. It contains
one user prompt, an intermediate assistant message, two tool calls, and a final
assistant answer.

## Reproduce in the app

1. Put the accompanying `rollout-2026-09-30T12-00-00-11111111-1111-4111-8111-111111111111.jsonl`
   file in an isolated Codex sessions directory configured for AgentsView. Use a
   separate AgentsView data directory for the demonstration, not your normal
   archive. Sync the sample, then open its conversation.
2. Use the Default message layout. Keep all block types visible and the
   transcript at the top. The short conversation should fit in the viewport.
3. Select **Focused**, then select **Normal**, without scrolling or resizing.

Before the fix, the tool-call group and final answer do not return. The original
messages are still stored. Resizing the window makes the missing rows appear.
With the fix, switching back to Normal immediately restores the whole
conversation.

The comparison uses source snapshot `e6004b6a` without the fix and `35a9ed36`
with it. Both frontends read the same imported sample from an isolated SQLite
archive. No API responses, element sizes, or visible rows are altered for this
comparison. Three repeated mode switches produced the same result on each
build, and the old build was still incomplete after waiting for it to settle.

The screenshots show the same conversation and the same final Normal mode.
