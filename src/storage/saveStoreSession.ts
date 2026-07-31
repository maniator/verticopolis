import type { SaveRecord, SaveScope, SaveScopeToken, SaveStorePort, SaveStoreSnapshot } from "../platform/saveStore";
import { isSaveSlotId, type SaveSlotId } from "./saveMigration";

/**
 * The store as the game sees it for one session: resolved ONCE at boot, then
 * answered synchronously.
 *
 * That shape is forced by the readers rather than chosen. `SaveGame.load`,
 * `hasSave`, `listSlots` and `hasSlot` run at boot and behind the splash, and
 * asyncifying them would spread `await` through the boot path and the splash
 * controller for a question the shell can answer once. So `appBoot` awaits
 * `list()` a single time before the splash, and everything after it reads this.
 *
 * ## Origin, and the rule it exists to enforce
 *
 * A record's scope is where it CAME FROM, which is not necessarily where a new
 * save would go. The distinction has no visible consequence today, because a
 * shell offers one scope. It has a permanent one the day a shell offers two: a
 * tower opened from an account directory must be written back to that account
 * directory or not at all, never quietly into the shared local namespace where
 * every other account on the machine can read it.
 *
 * The refusal branch ships now, while there is exactly one scope and it cannot
 * fire, because a rule added after the second scope exists has to be
 * retrofitted onto call sites that were written without it. Here it is one
 * branch with a test behind it.
 */

declare const SHARED_SCOPE: unique symbol;

/**
 * A scope token the shell marked SHARED, distinguished at the type level.
 *
 * `migrationTarget` is the only producer, and `migrateSavesToStore` takes this
 * rather than a bare `SaveScopeToken`. That is the difference between the
 * unsafe call being discouraged and being inexpressible: with a plain token
 * parameter, `migrateSavesToStore(store, session.defaultScope!, ...)`
 * typechecked, compiled, and passed the whole suite, and a doc comment saying
 * "MUST be the shared scope" was the only thing standing between that and one
 * account's towers landing in another's Steam Cloud.
 */
export type SharedScopeToken = SaveScopeToken & { readonly [SHARED_SCOPE]: true };

/** How the game addresses a stored tower: an id is unique only within a scope. */
export interface SaveAddress {
  readonly id: SaveSlotId;
  readonly scope: SaveScopeToken;
}

/** Why a write was refused, when it was refused before being attempted. */
export type WriteRefusal = "no-store" | "origin-gone";

export interface SaveStoreSession {
  /** Every record the shell reported at boot, filtered to ids the game owns. */
  readonly records: readonly SaveRecord[];
  /** Scopes the shell offered, in the order it offered them. */
  readonly scopes: readonly SaveScope[];
  /** Where a NEW tower is written when nothing says otherwise. */
  readonly defaultScope: SaveScopeToken | undefined;
  /**
   * The one scope shared across accounts on this machine, if the shell marked
   * one. The ONLY scope the localStorage migration may write into.
   *
   * Kept separate from `defaultScope` on purpose, and they are the same token
   * today only because a shell offers one scope. The day they diverge,
   * migrating into the default would move the previous account's leftover
   * towers into the current account's Cloud, so the migration must not be able
   * to name the default at all.
   */
  readonly sharedScope: SaveScopeToken | undefined;
}

/**
 * Build the session from a snapshot, discarding anything malformed.
 *
 * A snapshot is untrusted input in the same sense an injected port is: the
 * duck-check that admitted the port verified four function names and nothing
 * about what they resolve to. So a record with an id the game does not own, or
 * a scope no listed `SaveScope` covers, is dropped rather than carried into
 * the readers where it would surface as a phantom slot.
 */
export function sessionFromSnapshot(snapshot: unknown): SaveStoreSession {
  const raw = snapshot as Partial<SaveStoreSnapshot> | null | undefined;
  const scopes = Array.isArray(raw?.scopes)
    ? raw.scopes.filter((s): s is SaveScope => typeof s?.token === "string" && typeof s?.label === "string")
    : [];
  const known = new Set(scopes.map((s) => s.token));
  const records = Array.isArray(raw?.records)
    ? raw.records.filter(
        (r): r is SaveRecord =>
          isSaveSlotId(r?.id) && typeof r?.scope === "string" && known.has(r.scope as SaveScopeToken),
      )
    : [];
  // Exactly ONE, or nothing. A shell that marks two is malformed, and picking
  // either would make the migration's destination depend on array order, which
  // is the same class of bug as guessing.
  const shared = scopes.filter((s) => s.shared === true);
  return {
    records,
    scopes,
    defaultScope: scopes[0]?.token,
    sharedScope: shared.length === 1 ? shared[0]!.token : undefined,
  };
}

/** Ids present in `scope`, which is what the migration's done-marker derives
 *  from. Scope-aware on purpose: a record in some OTHER scope must not suppress
 *  a migration into this one. */
export function idsInScope(session: SaveStoreSession, scope: SaveScopeToken): Set<string> {
  return new Set(session.records.filter((r) => r.scope === scope).map((r) => r.id));
}

/** The record for an address, or undefined. */
export function recordAt(session: SaveStoreSession, address: SaveAddress): SaveRecord | undefined {
  return session.records.find((r) => r.id === address.id && r.scope === address.scope);
}

/**
 * Decide where an autosave of the CURRENTLY LOADED tower goes.
 *
 * `loadedFrom` is the address the live tower was opened from, or undefined for
 * a tower that has never been stored (a new game, or one imported from a file).
 *
 *  - A tower with a known origin is written back to that origin. Not to the
 *    default scope, and not to "wherever we are now".
 *  - A tower whose origin scope has DISAPPEARED (the shell stopped offering it,
 *    which on a desktop shell means the account changed mid-session) is
 *    REFUSED. Falling back to the default scope here is the specific mistake
 *    this function exists to prevent: it would copy one account's tower into
 *    the namespace every account on the machine can read.
 *  - A tower with no origin goes to the default scope, which is what a first
 *    save is.
 */
export function resolveWriteTarget(
  session: SaveStoreSession,
  id: SaveSlotId,
  loadedFrom: SaveAddress | undefined,
): { readonly ok: true; readonly target: SaveAddress } | { readonly ok: false; readonly refusal: WriteRefusal } {
  if (loadedFrom) {
    if (!session.scopes.some((s) => s.token === loadedFrom.scope)) {
      return { ok: false, refusal: "origin-gone" };
    }
    return { ok: true, target: { id, scope: loadedFrom.scope } };
  }
  if (session.defaultScope === undefined) return { ok: false, refusal: "no-store" };
  return { ok: true, target: { id, scope: session.defaultScope } };
}

/**
 * Where the localStorage migration is allowed to write, or null when there is
 * nowhere safe.
 *
 * The whole point of this function is that it CANNOT return an account scope.
 * A caller wanting to migrate has to come through here, so "aim the migration
 * at the current account" is not expressible rather than merely discouraged.
 * Returning null (no shell-marked shared scope) means the migration is skipped
 * entirely, which is the correct conservative answer: localStorage keeps the
 * towers and a later boot with a properly marked scope moves them.
 */
export function migrationTarget(session: SaveStoreSession): SharedScopeToken | null {
  return session.sharedScope === undefined ? null : (session.sharedScope as SharedScopeToken);
}

/**
 * Resolve the store at boot: one `list()`, then everything else is synchronous.
 *
 * A rejection is not a boot failure. It means "no durable store this session",
 * and the caller falls back to localStorage, which is what every non-desktop
 * build does anyway. The same is true of a `list()` that resolves something
 * malformed, which is why the result goes through `sessionFromSnapshot`.
 */
export async function openSaveStore(port: SaveStorePort): Promise<SaveStoreSession | null> {
  try {
    const session = sessionFromSnapshot(await port.list());
    // A store offering no scope cannot be written to, so it is indistinguishable
    // from having none. Say so here rather than letting every write site
    // rediscover it.
    return session.defaultScope === undefined ? null : session;
  } catch {
    return null;
  }
}
