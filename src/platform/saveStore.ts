/**
 * The save-store seam: a wrapper shell offering durable storage the game can
 * use instead of localStorage. Bound today by the Electron desktop shell in the
 * private distribution repo; every other build omits it entirely.
 *
 * BLOB-SHAPED ON PURPOSE. Nothing here names a path, a directory, or a
 * filename, in either direction. The game hands over an id and a string and
 * gets a string back, so the whole question of where bytes live stays on the
 * shell side of the process boundary. That is not tidiness: on the desktop
 * shell the answer contains an account identifier, and the game must never be
 * in a position to render, log, or export one.
 *
 * The scope token is the other half of that. The game never asks for a
 * namespace and never names one; it reads whichever scopes the shell reports,
 * echoes a record's token back when it writes, and treats the token as opaque.
 * A shell that later reports a second scope (an account directory beside the
 * shared one) needs no public change at all, which is what keeps
 * account-selective saves an additive step rather than a rewrite here.
 */

/**
 * Minted by the shell, per session. Opaque by contract: the game compares
 * tokens for equality and does nothing else with one. It is deliberately NOT a
 * union of known values, because the set of scopes is the shell's business and
 * a public union would leak the shape of it.
 */
export type SaveScopeToken = string;

/** A storage area the shell is offering, as the player should see it. */
export interface SaveScope {
  /** Opaque handle. Echo it back on write; never parse it. */
  readonly token: SaveScopeToken;
  /**
   * Display text, supplied by the shell rather than composed here. The game
   * renders it verbatim, so wording lives with the side that knows what the
   * scope actually is. Never a path.
   */
  readonly label: string;
}

/**
 * Store-neutral failure codes. A shell maps its own errors onto these before
 * rejecting, so no raw filesystem error (which would carry an absolute path)
 * crosses the bridge, and so the game's copy does not have to guess at the
 * cause of a failure it cannot see.
 */
export type SaveStoreErrorCode = "full" | "denied" | "io" | "not-found" | "too-large";

/** A rejection from any {@link SaveStorePort} member. */
export interface SaveStoreError {
  readonly code: SaveStoreErrorCode;
  /** Safe to show a player. Never a path, never a raw errno string. */
  readonly message?: string;
}

/** One stored tower, as the shell describes it. Note the absence of a path. */
export interface SaveRecord {
  /** The slot id the game wrote under, from its own closed list. */
  readonly id: string;
  /** Which scope this record came FROM, which is not necessarily the scope a
   *  new save would go to. Autosave targets this, so a tower opened from one
   *  scope is never written back into another. */
  readonly scope: SaveScopeToken;
  readonly bytes: number;
  /** Write time, when the shell knows it. Absent rather than guessed. */
  readonly savedAt?: number;
}

/** What {@link SaveStorePort.list} reports: the records plus the scopes they
 *  refer to, resolved in one round trip so the UI never renders a token it has
 *  no label for. */
export interface SaveStoreSnapshot {
  readonly scopes: readonly SaveScope[];
  readonly records: readonly SaveRecord[];
}

export interface SaveStorePort {
  /**
   * Everything the shell can see right now. The game awaits this ONCE during
   * boot, before the splash, and serves its synchronous readers from the
   * result; see `SaveGame`. Rejecting is allowed and means "no durable store
   * this session", which falls back to localStorage rather than failing boot.
   */
  list(): Promise<SaveStoreSnapshot>;
  /** Resolves null when the id is absent, which is not an error. */
  read(id: string): Promise<string | null>;
  /**
   * Durably store `contents` under `id` in `scope`.
   *
   * `seq` is a per-id monotonic counter minted by the game. The shell drops any
   * write whose seq is below the last it committed for that id, so a slow write
   * that lands late cannot overwrite a newer one. It is the shell's ordering
   * authority precisely because arrival order across a process boundary is not
   * one.
   */
  write(id: string, contents: string, scope: SaveScopeToken, seq: number): Promise<void>;
  delete(id: string): Promise<void>;
}

/**
 * Duck-check for the optional port member, mirroring `isPlatformPort`'s posture:
 * an injection is untrusted, and a malformed one must degrade to localStorage
 * rather than throw out of boot. Property reads are guarded because a throwing
 * getter or a revoked Proxy is just another malformed injection.
 */
export function isSaveStorePort(value: unknown): value is SaveStorePort {
  if (typeof value !== "object" || value === null) return false;
  try {
    const port = value as Record<string, unknown>;
    return (
      typeof port.list === "function" &&
      typeof port.read === "function" &&
      typeof port.write === "function" &&
      typeof port.delete === "function"
    );
  } catch {
    return false;
  }
}
