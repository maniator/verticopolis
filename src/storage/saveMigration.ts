import { saveStoreErrorCode, type SaveStoreErrorCode, type SaveStorePort } from "../platform/saveStore";
import type { SharedScopeToken } from "./saveStoreSession";
import { sameTowerFile, toTowerFile } from "./towerFileCodec";

/**
 * One-time migration of localStorage towers into a shell-provided save store.
 *
 * ## Why this never deserializes
 *
 * `markFounderFromLoadedFile` grants Founder status to any tower whose
 * `appVersion` is absent, and `SaveGame`'s `stamp()` sets `appVersion` on every
 * write. So a migration that read a tower and saved it back would set the stamp
 * on towers that had none, and the badge those players earned would be gone,
 * permanently, with the original bytes overwritten and nothing logged. It would
 * also never be reported, because nobody can see a badge they no longer have.
 *
 * The mitigation is structural rather than careful. `SaveGame.saveTo` packs
 * with fflate's `deflateSync` and `SaveGame.export` packs with
 * `CompressionStream("deflate-raw")`, and BOTH produce raw deflate, so the two
 * containers wrap byte-identical payloads:
 *
 *     localStorage:  VCZ1:<base64 of raw deflate>
 *     .vctower:      VCTOWER1\n<base64 of raw deflate>\n
 *
 * Converting one to the other is therefore a header rewrite. No inflate feeds
 * the output, no `JSON.parse` feeds the output, no `Simulation.deserialize`, no
 * re-stamp. The payload this module writes is the payload it read, so Founder
 * status cannot be affected by it, and that holds by construction rather than
 * by anyone remembering to preserve a field.
 *
 * The only case needing real work is a pre-compression save, which is raw JSON.
 * That one gets deflated here, but it is still the ORIGINAL string being
 * compressed. It is never parsed and re-serialized, so an absent `appVersion`
 * stays absent there too.
 */

/**
 * Destination ids, closed by construction. The shell membership-tests against
 * this list rather than sanitizing, because sanitizing an id would turn it into
 * a filename channel; an unrecognized id is refused, never created.
 *
 * `auto-legacy` exists because the two autosave keys can both hold a tower at
 * once (a partial migration, or two tabs, or an older build re-writing the old
 * key after a newer one moved it). `SaveGame.loadResult` prefers the current
 * key and falls back to the legacy one, so both are real saves and collapsing
 * them onto a single destination would silently drop whichever lost.
 */
export const SAVE_SLOT_IDS = ["auto", "auto-legacy", "slot-1", "slot-2", "slot-3", "unreadable"] as const;

export type SaveSlotId = (typeof SAVE_SLOT_IDS)[number];

export function isSaveSlotId(value: unknown): value is SaveSlotId {
  return typeof value === "string" && (SAVE_SLOT_IDS as readonly string[]).includes(value);
}

/**
 * Every localStorage key holding a tower, paired with where it lands.
 *
 * `preserve` marks a destination whose job is KEEPING BYTES rather than
 * carrying a loadable tower. `simtower-clone-unreadable` is populated by
 * `SaveGame.preserveUnreadable` from an autosave this build could not read, so
 * gating it on decodability would make the migration refuse precisely the bytes
 * that key exists to protect. It is preserved verbatim instead, and the saves
 * UI already has wording for a slot that will not load here.
 *
 * Preserve relaxes the DECODE checks only. A value that cannot survive the trip
 * intact (see the lone-surrogate guard in {@link toTowerFile}) is still
 * refused, in both modes, because writing something different from what was
 * read and calling it preserved would be the one outcome worse than declining.
 */
export const MIGRATION_SOURCES: readonly {
  readonly key: string;
  readonly id: SaveSlotId;
  readonly preserve?: true;
}[] = [
  { key: "verticopolis-save", id: "auto" },
  { key: "simtower-clone-save", id: "auto-legacy" },
  { key: "simtower-clone-slot-1", id: "slot-1" },
  { key: "simtower-clone-slot-2", id: "slot-2" },
  { key: "simtower-clone-slot-3", id: "slot-3" },
  { key: "simtower-clone-unreadable", id: "unreadable", preserve: true },
];

/** The localStorage key a store id hydrates back into, or undefined for an id
 *  the game does not own. The inverse of {@link MIGRATION_SOURCES}, derived
 *  from it rather than restated, so the two can never disagree about which key
 *  a slot lives under. */
export function localStorageKeyFor(id: string): string | undefined {
  return MIGRATION_SOURCES.find((s) => s.id === id)?.key;
}

// The .vctower container codec (toTowerFile, fromTowerFile, sameTowerFile)
// lives in ./towerFileCodec, split at the 500-line guard; re-exported here so
// existing import sites keep one path to the save-migration family.
export { fromTowerFile, type ConversionResult, type FromTowerFileResult } from "./towerFileCodec";
export { sameTowerFile, toTowerFile };

/** What one source key did during a migration run. */
export type MigrationOutcome = "migrated" | "absent" | "already-present" | "unreadable" | "write-failed";

/** A destination that could not be written, with the store's own reason when
 *  it supplied one. Kept so a caller can tell "disk full" from "denied"
 *  instead of showing one message for every failure. */
export interface MigrationFailure {
  readonly id: SaveSlotId;
  readonly code?: SaveStoreErrorCode;
}

export interface MigrationReport {
  readonly outcomes: ReadonlyMap<SaveSlotId, MigrationOutcome>;
  readonly failures: readonly MigrationFailure[];
  /** True when at least one tower moved. */
  readonly migratedAny: boolean;
  /**
   * True when no source key held anything, so there was nothing to do. Distinct
   * from "migrated nothing", which can also mean every value was corrupt.
   */
  readonly nothingToDo: boolean;
  /**
   * True when nothing was left to move: every destination the sources map to is
   * either occupied already or has no source. It must be distinguishable from
   * "six unreadable keys", which produces the same `migratedAny: false` and is
   * worth telling someone about.
   *
   * NOT the same as "a migration ran here before". `already-present` is derived
   * from what the store holds, and the destination ids are the same ids the
   * game saves under normally, so an install that never had a localStorage
   * tower and simply autosaved once reports this too. It means "nothing to do",
   * never "your towers were moved over".
   */
  readonly alreadyComplete: boolean;
}

/** Reads one localStorage key. Injectable so the migration is testable without
 *  a DOM, and so a throwing storage (private mode, disabled site storage) is a
 *  normal absent rather than an exception out of boot. */
export type RawSaveReader = (key: string) => string | null;

export function localStorageReader(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * Seq for a migration write, deliberately the lowest value there is.
 *
 * A migration must never outrank a real save. It cannot know what the shell has
 * already committed for an id (it consults the caller's snapshot, which can be
 * stale, and never probes the store first), so it claims the weakest possible
 * position and lets the read-back afterwards establish what actually happened.
 *
 * The DEFAULT only. A caller with a live session counter must mint from it
 * instead (the `mintSeq` parameter): the shell's high-water mark counts this
 * write, so a constant here while the session counter reads 0 makes the first
 * real save of the session re-mint the same seq and vanish as `stale`.
 */
const MIGRATION_SEQ = 1;

/**
 * Move every readable localStorage tower into `store`, once.
 *
 * Safe to run on every boot, and safe by construction rather than by flag:
 *
 *  - A destination that already exists is SKIPPED, never merged or overwritten.
 *    That is the done-marker, derived from the store's own contents, so there
 *    is no separate flag to get out of sync with reality and a re-run is a
 *    no-op without needing to know it already ran.
 *  - localStorage is never written and never cleared. The old copy stays put as
 *    the fallback, which also means a half-finished run leaves nothing damaged
 *    and the next boot simply finishes it.
 *  - Every write is READ BACK before it is called migrated. A duck-checked port
 *    can only be trusted for shape, not behavior: a `write` that returns a
 *    non-Promise, or one the shell discarded as stale, would otherwise be
 *    reported as a save that does not exist.
 *
 * `existingIds` are the ids already present IN `scope`; the caller filters the
 * snapshot, because a record in some other scope must not suppress a migration
 * into this one.
 *
 * `scope` is a `SharedScopeToken`, whose only producer is `migrationTarget`.
 * The type is the enforcement: a doc comment saying "MUST be the shared scope"
 * left `migrateSavesToStore(store, session.defaultScope!, ...)` compiling
 * cleanly and passing the whole suite.
 *
 * A tower found in localStorage has no knowable owner. localStorage is
 * per-origin and predates any notion of an account, so the previous account on
 * this machine may have left it. Once a default scope means "the account logged
 * in right now", migrating into it would sweep the previous player's towers
 * into this player's Steam Cloud.
 */
export async function migrateSavesToStore(
  store: SaveStorePort,
  scope: SharedScopeToken,
  existingIds: ReadonlySet<string>,
  read: RawSaveReader = localStorageReader,
  // The seq each migrated write claims. The desktop caller passes its shared
  // per-address counter (`nextSeq`), and that sharing is LOAD-BEARING: the
  // shell's high-water mark counts every commit, so a migration that wrote a
  // constant seq 1 while the session's own counter still read 0 made the
  // FIRST real save of the session mint the same seq 1 and vanish as
  // `stale`, under a success toast (success-by-supersession). The packaged
  // smoke caught it: Quick Save after a migration boot changed nothing.
  // The default keeps the standalone weakest-claim behavior for callers with
  // no session counter (tests, non-desktop wiring).
  mintSeq: (address: { id: SaveSlotId; scope: SharedScopeToken }) => number = () => MIGRATION_SEQ,
): Promise<MigrationReport> {
  const outcomes = new Map<SaveSlotId, MigrationOutcome>();
  const failures: MigrationFailure[] = [];

  for (const { key, id, preserve } of MIGRATION_SOURCES) {
    if (existingIds.has(id)) {
      outcomes.set(id, "already-present");
      continue;
    }
    // Guarded at the CALL SITE, not just inside the default reader. Migration
    // runs during boot, so a storage that throws (private mode, site storage
    // disabled, a reader supplied by a caller) has to end up as "nothing to
    // migrate" rather than as an exception that takes the splash down with it.
    let raw: string | null;
    try {
      raw = read(key);
    } catch {
      raw = null;
    }
    // Typed as `string | null`, but the default reader is localStorage and an
    // injected one is just a function. A number or an object here would throw
    // out of `toTowerFile` below, which is outside any try, and take boot with
    // it. Anything that is not a string is nothing to migrate.
    if (typeof raw !== "string") {
      outcomes.set(id, "absent");
      continue;
    }
    const converted = toTowerFile(raw, preserve);
    if (!converted.ok) {
      outcomes.set(id, converted.reason === "empty" ? "absent" : "unreadable");
      continue;
    }

    // Write, then establish what is ACTUALLY there. The two are separate
    // because they fail for different reasons and must not be confused: a
    // read that rejects after a write that landed would otherwise be reported
    // as a failed write, carrying the read's error code.
    let wrote = false;
    let writeErr: unknown;
    try {
      await store.write(id, converted.text, scope, mintSeq({ id, scope }));
      wrote = true;
    } catch (err) {
      writeErr = err;
    }

    let stored: string | null = null;
    let verified = true;
    try {
      stored = await store.read(id, scope);
    } catch {
      verified = false;
    }

    if (verified && stored !== null && sameTowerFile(stored, converted.text)) {
      outcomes.set(id, "migrated");
      continue;
    }
    if (verified && stored !== null && !wrote) {
      // Something else holds this destination: the caller's snapshot was stale,
      // or another process won the race. That is a SKIP, not a failure. The
      // shell's own O_EXCL refusal lands here, and reporting it as an error
      // would show the player a scary message about a save that is fine.
      outcomes.set(id, "already-present");
      continue;
    }
    // Deliberately NOT deleting a mismatched destination, though an earlier
    // revision did. Two reasons, and both are worse than the debris it was
    // meant to clear. `wrote` proves only that OUR write resolved, not that
    // what sits there now is ours, so a writer who committed in between would
    // have its record deleted by us. And clearing the destination means the
    // next boot finds it empty and repeats the whole failure, where leaving it
    // lets the next boot report `already-present` and converge. localStorage
    // still holds the original in either case, so nothing is lost by leaving
    // it alone, and something can be lost by not.
    outcomes.set(id, "write-failed");
    // The code is OMITTED rather than set to undefined when there is none, so a
    // consumer testing `"code" in failure` agrees with one testing the value.
    const code = wrote ? undefined : saveStoreErrorCode(writeErr);
    failures.push(code === undefined ? { id } : { id, code });
  }

  const values = [...outcomes.values()];
  return {
    outcomes,
    failures,
    migratedAny: values.includes("migrated"),
    nothingToDo: values.every((v) => v === "absent"),
    alreadyComplete:
      values.every((v) => v === "absent" || v === "already-present") && values.includes("already-present"),
  };
}
