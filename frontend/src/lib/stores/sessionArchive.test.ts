import { describe, expect, it } from "vite-plus/test";
import { SessionArchiveStore } from "./sessionArchive.svelte.js";

function storage(initial?: string) {
  const values = new Map<string, string>();
  if (initial) values.set("agentsview-archived-session-visibility", initial);
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

describe("SessionArchiveStore", () => {
  it("hides archived sessions by default without changing their state", () => {
    const store = new SessionArchiveStore(storage());
    expect(store.visibility).toBe("hide");
    expect(store.onlyArchived).toBe(false);
    expect(store.filter).toBe("unarchived");
    expect(store.includes(undefined)).toBe(true);
    expect(store.includes("2026-09-01T10:00:00Z")).toBe(false);
  });

  it("remembers Hide/Dim but not the archived-only filter", () => {
    const saved = storage();
    const store = new SessionArchiveStore(saved);
    store.setVisibility("dim");
    store.onlyArchived = true;
    const reopened = new SessionArchiveStore(saved);
    expect(reopened.visibility).toBe("dim");
    expect(reopened.onlyArchived).toBe(false);
    expect(reopened.filter).toBe("all");
    reopened.setVisibility("hide");
    expect(new SessionArchiveStore(saved).filter).toBe("unarchived");
  });

  it.each(["hide", "dim"] as const)(
    "archived-only overrides %s and clearing it restores the preference",
    (visibility) => {
      const store = new SessionArchiveStore(storage());
      store.setVisibility(visibility);
      store.onlyArchived = true;
      expect(store.filter).toBe("archived");
      expect(store.includes(undefined)).toBe(false);
      expect(store.includes("2026-09-01T10:00:00Z")).toBe(true);
      store.onlyArchived = false;
      expect(store.filter).toBe(visibility === "hide" ? "unarchived" : "all");
    },
  );

  it("handles unavailable storage and unknown saved values", () => {
    const unavailable = {
      getItem: () => {
        throw new Error("disabled");
      },
      setItem: () => {
        throw new Error("disabled");
      },
    };
    const store = new SessionArchiveStore(unavailable);
    expect(store.filter).toBe("unarchived");
    expect(() => store.setVisibility("dim")).not.toThrow();
    expect(store.filter).toBe("all");
    expect(new SessionArchiveStore(storage("unknown")).filter).toBe("unarchived");
  });
});
