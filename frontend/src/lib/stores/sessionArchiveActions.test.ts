// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { SessionsService } from "../api/generated/index.js";
import type { Session } from "../api/types.js";
import { sessions, filtersToParams } from "./sessions.svelte.js";
import { sessionArchive } from "./sessionArchive.svelte.js";

function session(id: string, archived_at?: string): Session {
  return {
    id,
    project: "test-project",
    machine: "local",
    agent: "claude",
    first_message: "inspect the issue",
    created_at: "2026-09-01T10:00:00Z",
    started_at: "2026-09-01T10:00:00Z",
    ended_at: "2026-09-01T10:01:00Z",
    message_count: 2,
    user_message_count: 2,
    is_automated: false,
    compaction_count: 0,
    consecutive_failure_max: 0,
    edit_churn_count: 0,
    ended_with_role: "assistant",
    final_failure_streak: 0,
    mid_task_compaction_count: 0,
    outcome: "",
    outcome_confidence: "",
    secret_leak_count: 0,
    tool_failure_signal_count: 0,
    tool_retry_count: 0,
    total_output_tokens: 0,
    peak_context_tokens: 0,
    has_peak_context_tokens: false,
    has_total_output_tokens: false,
    archived_at,
  };
}

beforeEach(() => {
  sessions.sessions = [session("session-a"), session("session-b", "2026-09-01T10:00:00Z")];
  sessions.activeSessionId = "session-a";
  sessionArchive.visibility = "hide";
  sessionArchive.onlyArchived = false;
  vi.spyOn(sessions, "load").mockResolvedValue();
});
afterEach(() => {
  sessions.clearArchiveUndo();
  sessions.sessions = [];
  sessions.childSessions.clear();
  sessions.activeSessionId = null;
  sessionArchive.visibility = "hide";
  sessionArchive.onlyArchived = false;
  vi.restoreAllMocks();
});

describe("session archive actions", () => {
  it("keeps the transcript open while removing its row from the hidden-archive sidebar", async () => {
    vi.spyOn(SessionsService, "postApiV1SessionsBatchArchive").mockResolvedValue({
      sessions: [{ id: "session-a", archived_at: "2026-09-02T10:00:00Z" }],
    });
    const metadata = vi.spyOn(sessions, "invalidateFilterCaches");
    await sessions.setArchived(["session-a"], true);
    expect(sessions.activeSessionId).toBe("session-a");
    expect(sessions.activeSession?.archived_at).toBeTruthy();
    expect(sessions.groupedSessions).toHaveLength(0);
    expect(metadata).not.toHaveBeenCalled();
    expect(sessions.load).toHaveBeenCalledWith({ force: true });
  });

  it("undoes only changed sessions, not sessions that were already archived", async () => {
    const mutate = vi
      .spyOn(SessionsService, "postApiV1SessionsBatchArchive")
      .mockResolvedValueOnce({
        sessions: [{ id: "session-a", archived_at: "2026-09-02T10:00:00Z" }],
      })
      .mockResolvedValueOnce({ sessions: [{ id: "session-a", archived_at: null }] });
    await sessions.setArchived(["session-a", "session-b"], true);
    expect(sessions.archiveUndo?.ids).toEqual(["session-a"]);
    await sessions.undoArchive();
    expect(mutate).toHaveBeenLastCalledWith({ session_ids: ["session-a"], archived: false });
    expect(sessions.sessions.find((row) => row.id === "session-a")?.archived_at).toBeUndefined();
    expect(sessions.sessions.find((row) => row.id === "session-b")?.archived_at).toBe(
      "2026-09-01T10:00:00Z",
    );
    expect(sessions.archiveUndo).toBeNull();
  });

  it("keeps a partially completed large batch undoable and reports the failure", async () => {
    const ids = Array.from({ length: 1001 }, (_, i) => `session-${i}`);
    vi.spyOn(SessionsService, "postApiV1SessionsBatchArchive")
      .mockResolvedValueOnce({ sessions: [{ id: ids[0]!, archived_at: "2026-09-02T10:00:00Z" }] })
      .mockRejectedValueOnce(new Error("offline"));
    await expect(sessions.setArchived(ids, true)).rejects.toThrow("offline");
    expect(sessions.archiveUndo?.ids).toEqual([ids[0]]);
    expect(sessions.archiveBusy).toBe(false);
  });

  it("does not lose the old marker or offer undo after a failed mutation", async () => {
    vi.spyOn(SessionsService, "postApiV1SessionsBatchArchive").mockRejectedValue(
      new Error("offline"),
    );
    await expect(sessions.setArchived(["session-b"], false)).rejects.toThrow("offline");
    expect(sessions.sessions[1]?.archived_at).toBe("2026-09-01T10:00:00Z");
    expect(sessions.archiveUndo).toBeNull();
    expect(sessions.archiveBusy).toBe(false);
  });

  it("keeps archive preferences out of shared search/analytics filter params", () => {
    sessionArchive.onlyArchived = true;
    expect(filtersToParams(sessions.filters)).not.toHaveProperty("archive_state");
    expect(sessions.groupedSessions.map((group) => group.primarySessionId)).toEqual(["session-b"]);
    sessionArchive.onlyArchived = false;
    sessionArchive.visibility = "dim";
    expect(sessions.groupedSessions).toHaveLength(2);
  });
});
