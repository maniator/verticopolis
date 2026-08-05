/**
 * The save-store seam: durable storage a wrapper shell may offer the game in
 * place of localStorage. Nothing binds it yet. The Electron desktop shell in
 * the private distribution repo is the intended first implementer, and this
 * contract exists so that shell can be built against something.
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
 * addresses records by (id, scope), and treats the token as opaque. A shell
 * that later reports a second scope needs no change to this file, which is what
 * keeps account-selective saves an additive step rather than a rewrite.
 */

declare const SAVE_SCOPE_TOKEN: unique symbol;

/**
 * Minted by the shell, per session. Opaque by contract AND by type: branded so
 * a `label`, an id, or a tower name cannot be passed where a token belongs.
 *
 * The brand is a TYPE-LEVEL aid, not a runtime check, and it is one-directional.
 * `SaveScopeToken` is still a `string`, so a token remains assignable to the
 * `id` parameter of `read`, `write` and `delete`; the brand stops arbitrary
 * strings becoming tokens, not tokens becoming ids. {@link asScopeToken} is the
 * sanctioned assertion site for a string the game holds, but tokens reaching
 * the game inside a {@link SaveStoreSnapshot} are branded by the declaration of
 * `list()` alone, with nothing validating them. Treat a snapshot the way
 * `isPlatformPort` treats an injection.
 *
 * Deliberately not a union of known values: the set of scopes is the shell's
 * business, and a public union would leak the shape of it.
 */
export type SaveScopeToken = string & { readonly [SAVE_SCOPE_TOKEN]: never };

/** Narrow a bridge-supplied string to a token. The one cast site. */
export function asScopeToken(raw: string): SaveScopeToken {
  return raw as SaveScopeToken;
}

/** A storage area the shell is offering, as the player should see it. */
export interface SaveScope {
  /** Opaque handle. Pass it back when addressing a record; never parse it. */
  readonly token: SaveScopeToken;
  /**
   * Display text, supplied by the shell rather than composed here. The game
   * renders it verbatim, so wording lives with the side that knows what the
   * scope actually is.
   *
   * MUST NOT be a path. The game cannot verify this (a duck-check cannot tell a
   * sentence from a directory), so it is a contract obligation on the shell,
   * and it is load-bearing: this string is rendered to the screen, and on the
   * desktop shell a path would carry an account identifier onto it.
   */
  readonly label: string;
  /**
   * True for the one scope SHARED across accounts on this machine, false for an
   * account-private one. REQUIRED, and exactly one scope should be true.
   *
   * Required rather than optional, and that is load-bearing. The game cannot
   * infer which namespace is shared, and every fallback it makes depends on
   * knowing: localStorage is per-origin and carries no scope, so writing a
   * tower there is safe only when the tower was headed somewhere equally
   * shared. An optional flag meant the obvious first shell (one scope, left
   * unmarked) answered "no scope is shared", which made every fallback unsafe
   * and silently sent autosaves nowhere at all.
   *
   * A scope missing this is DROPPED by `sessionFromSnapshot`, so an
   * under-specified shell degrades to plain localStorage rather than to a
   * half-working store. That is the safe direction: it is the behavior every
   * browser session already has.
   *
   * It also lets the localStorage migration be aimed structurally rather than
   * by convention. A tower found in localStorage has no knowable owner (the
   * previous account on this machine may have left it), so migrating into
   * whatever scope happened to be default would, once a default means "the
   * account logged in right now", sweep the previous player's towers into this
   * player's Steam Cloud.
   */
  readonly shared: boolean;
}

/**
 * Store-neutral failure codes. A shell maps its own errors onto these before
 * rejecting, so no raw filesystem error (which would carry an absolute path)
 * crosses the bridge, and so the game's copy does not have to guess at the
 * cause of a failure it cannot see.
 */
export type SaveStoreErrorCode = "full" | "denied" | "io" | "not-found" | "too-large" | "stale";

/** A rejection from any {@link SaveStorePort} member. */
export interface SaveStoreError {
  readonly code: SaveStoreErrorCode;
  /** Safe to show a player. Never a path, never a raw errno string. */
  readonly message?: string;
}

/** The set of codes, for runtime narrowing of a rejection. */
const SAVE_STORE_ERROR_CODES: readonly SaveStoreErrorCode[] = [
  "full",
  "denied",
  "io",
  "not-found",
  "too-large",
  // A write superseded by a HIGHER seq at the same address. Not a failure:
  // the store already holds newer content, so the correct caller response is
  // a silent skip, never a fallback and never a scary toast. Without this
  // code, the ordinary interleave (an async autosave parked mid-flight while
  // a sync manual save commits first) read as disk-full.
  "stale",
];

/**
 * Recover the store-neutral code from a rejection, or undefined when the shell
 * rejected with something unshaped.
 *
 * Exists because a taxonomy nothing narrows to is documentation rather than a
 * contract: without this, every caller writes `catch {}` and the codes are
 * decorative.
 */
export function saveStoreErrorCode(err: unknown): SaveStoreErrorCode | undefined {
  // The property read is guarded because this runs INSIDE a catch: a rejection
  // carrying a throwing getter or a revoked Proxy would otherwise throw a
  // second time from the handler, abandoning the remaining slots.
  let code: unknown;
  try {
    code = (err as { code?: unknown } | null | undefined)?.code;
  } catch {
    return undefined;
  }
  return SAVE_STORE_ERROR_CODES.includes(code as SaveStoreErrorCode) ? (code as SaveStoreErrorCode) : undefined;
}

/** One stored tower, as the shell describes it. Note the absence of a path. */
export interface SaveRecord {
  /** The slot id the game wrote under, from its own closed list. */
  readonly id: string;
  /**
   * Which scope this record came FROM, which is not necessarily the scope a new
   * save would go to. An id is unique only WITHIN a scope, so (id, scope) is
   * the address of a record and `id` alone is not.
   */
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
   * Every record the shell can see right now, across every scope it offers.
   *
   * Reports IDENTITY and SIZE, not tower contents: producing a tower name or a
   * population would mean the shell inflating and parsing a save, and the shell
   * is deliberately too dumb to do that. A caller that needs slot metadata
   * reads the payloads it cares about and parses them itself.
   *
   * Rejecting is allowed and means "no durable store this session", which the
   * caller should treat as a fallback to localStorage rather than a boot
   * failure.
   */
  list(): Promise<SaveStoreSnapshot>;
  /** Resolves null when the record is absent, which is not an error. */
  read(id: string, scope: SaveScopeToken): Promise<string | null>;
  /**
   * Durably store `contents` under (`id`, `scope`).
   *
   * `seq` is a per-id monotonic counter minted by the game, and its authority
   * is SESSION-SCOPED: the shell compares against the highest seq it has
   * committed for that id since the game connected, and must not persist a
   * high-water mark across restarts. A persisted mark would silently drop every
   * write of the next session, because the game's counter starts over.
   * Cross-process safety is the single-instance lock's job, not this counter's.
   * For the same reason a shell must not serve TWO game windows from one mark:
   * each window mints its own counter from 1, so the idler window's high seq
   * would make the store report the active window's newer saves as `stale`,
   * which the game rightly treats as success-by-supersession. One game window
   * per shell instance, or a mark per connection.
   *
   * A write the shell DISCARDS as stale must REJECT, never resolve. A resolved
   * promise is a commit, so resolving on a drop would let a caller report a
   * save that does not exist.
   */
  write(id: string, contents: string, scope: SaveScopeToken, seq: number): Promise<void>;
  delete(id: string, scope: SaveScopeToken): Promise<void>;
  /**
   * Durably store `contents` and return only once the bytes are COMMITTED.
   *
   * Exists for exactly two kinds of caller: a manual save whose UI confirms
   * success synchronously, and the crash flush that runs immediately before a
   * reload, where an async write could be interrupted mid-flight. Everything
   * else uses `write`.
   *
   * CONTRACT OBLIGATIONS ON THE SHELL, all load-bearing:
   *
   *  - BOUNDED. The game's crash screen blocks on this call, and a renderer
   *    cannot time out a synchronous IPC round trip, so an unbounded
   *    implementation would freeze the one screen that exists to survive
   *    failure. Cap the total write-plus-retry budget and return
   *    `{ok:false, code:"io"}` past it, never block indefinitely.
   *  - The seq high-water mark is SHARED with `write`, per (id, scope), and
   *    checked AT COMMIT TIME. Mixed sync and async traffic makes arrival
   *    order different from commit order: this call can run to completion
   *    while an async write sits parked mid-await, so a mark checked at
   *    message arrival lets older bytes commit over newer ones after the
   *    caller already reported success.
   *  - A write superseded by a higher seq returns `{ok:false, code:"stale"}`,
   *    which the game treats as a silent skip (the store holds newer content),
   *    never as a failure.
   *
   * Optional like every member added after the original three: a shell without
   * it simply leaves the game's synchronous save paths on their existing
   * localStorage behavior.
   */
  writeSync?(
    id: string,
    contents: string,
    scope: SaveScopeToken,
    seq: number,
  ): { ok: true } | { ok: false; code?: SaveStoreErrorCode };
  /**
   * Export a STORED record's bytes to a player-chosen destination (story D7,
   * closing D2's AC22). The shell resolves the record, runs its own save
   * dialog, and copies the file: no re-serialization, so the destination
   * bytes equal the stored bytes, and nothing that re-stamps a save can run.
   * The renderer supplies an id from the closed list and a suggested NAME
   * only; no path crosses in either direction. Resolves on cancel, like
   * `saveFile`, because cancel is not an error.
   *
   * Optional like every member added after the original three: the export
   * flow falls back to its live-serialize path when this is absent.
   */
  exportRecord?(id: string, suggestedName: string): Promise<void>;
}

/**
 * Duck-check for the optional port member, mirroring `isPlatformPort`'s posture:
 * an injection is untrusted, and a malformed one must degrade to localStorage
 * rather than throw out of boot. Property reads are guarded because a throwing
 * getter or a revoked Proxy is just another malformed injection.
 *
 * This checks SHAPE only, and cannot check behavior. A `write` that ignores its
 * arguments, or a `list` that resolves something malformed, passes here and
 * fails later; callers that need certainty verify the effect rather than trust
 * the signature (see `saveMigration.ts`, which reads its writes back).
 */
export function isSaveStorePort(value: unknown): value is SaveStorePort {
  if (typeof value !== "object" || value === null) return false;
  try {
    const port = value as Record<string, unknown>;
    // `writeSync` is optional (absent-or-function), like every member added
    // after the original contract: requiring it would demote a shell built
    // against the four-member revision.
    return (
      typeof port.list === "function" &&
      typeof port.read === "function" &&
      typeof port.write === "function" &&
      typeof port.delete === "function" &&
      (port.writeSync === undefined || typeof port.writeSync === "function") &&
      (port.exportRecord === undefined || typeof port.exportRecord === "function")
    );
  } catch {
    return false;
  }
}
