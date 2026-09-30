export type ArchivedSessionVisibility = "hide" | "dim";
export type SessionArchiveFilter = "all" | "unarchived" | "archived";
const STORAGE_KEY = "agentsview-archived-session-visibility";
type PreferenceStorage = Pick<Storage, "getItem" | "setItem">;

function browserStorage(): PreferenceStorage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

/** A browser-local display preference and a separate, temporary list filter.
 * Neither belongs in the shared filters used by search and analytics. */
export class SessionArchiveStore {
  visibility: ArchivedSessionVisibility = $state("hide");
  onlyArchived = $state(false);
  private storage: PreferenceStorage | undefined;

  constructor(storage: PreferenceStorage | undefined = browserStorage()) {
    this.storage = storage;
    try {
      if (storage?.getItem(STORAGE_KEY) === "dim") this.visibility = "dim";
    } catch {
      /* Storage is optional. */
    }
  }

  setVisibility(value: ArchivedSessionVisibility): void {
    this.visibility = value;
    try {
      this.storage?.setItem(STORAGE_KEY, value);
    } catch {
      /* Keep the in-memory preference. */
    }
  }

  get filter(): SessionArchiveFilter {
    if (this.onlyArchived) return "archived";
    return this.visibility === "hide" ? "unarchived" : "all";
  }

  includes(archivedAt: string | null | undefined): boolean {
    return this.filter === "all" || Boolean(archivedAt) === (this.filter === "archived");
  }
}
export const sessionArchive = new SessionArchiveStore();
