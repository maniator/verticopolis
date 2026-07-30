import { deflateSync } from "fflate";
import { fromBase64, inflateCapped, STORE_MAGIC, toBase64, TOWER_FILE_MAGIC } from "./saveCompression";
import { saveStoreErrorCode, type SaveScopeToken, type SaveStoreErrorCode, type SaveStorePort } from "../platform/saveStore";

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

/** Outcome of converting one stored value into `.vctower` text. */
export type ConversionResult =
  | { readonly ok: true; readonly text: string; readonly kind: "reheadered" | "compressed" }
  | { readonly ok: false; readonly reason: "empty" | "unreadable" };

/**
 * True when the string holds half of a surrogate pair. `TextEncoder` replaces
 * one with U+FFFD, so the branch that encodes text must refuse rather than
 * quietly hand back a different string than it was given.
 *
 * Written as "delete every WELL-FORMED pair, then look for a survivor" instead
 * of the obvious lookbehind. Lookbehind is a parse-time SyntaxError on Safari
 * below 16.4, and the build targets `esnext` with no downleveling, so the
 * regex would not fail on old Safari, it would fail to PARSE, taking the whole
 * chunk with it. This formulation is ES5 and says the same thing.
 */
function hasLoneSurrogate(s: string): boolean {
  return /[\uD800-\uDFFF]/.test(s.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, ""));
}

/**
 * The shape `SaveGame.import` demands before it will accept a tower. Applied
 * here so a value that is merely valid JSON (`null`, `42`, `[]`, `"hi"`) cannot
 * be dressed up as a `.vctower` and written into durable storage, which is the
 * exact outcome the validation exists to prevent.
 */
function looksLikeTower(parsed: unknown): boolean {
  const data = parsed as { minutes?: unknown; units?: unknown } | null;
  return typeof data === "object" && data !== null && typeof data.minutes === "number" && Array.isArray(data.units);
}

/**
 * Convert a raw localStorage value into `.vctower` file text.
 *
 * Pure, and pure on purpose: it is the one piece of this file whose correctness
 * is a byte-fidelity question, so it takes a string and returns a string with
 * no store, no clock, and no globals to stand in the way of testing it.
 *
 * `preserve` switches from "only carry a loadable tower" to "keep these bytes
 * whatever they are". See {@link MIGRATION_SOURCES}.
 */
export function toTowerFile(raw: string, preserve = false): ConversionResult {
  const trimmed = raw.trim();
  if (trimmed === "") return { ok: false, reason: "empty" };

  if (trimmed.startsWith(STORE_MAGIC)) {
    const body = trimmed.slice(STORE_MAGIC.length);
    // In preserve mode the payload is passed through EXACTLY. Stripping
    // internal whitespace is a normalization, and a value that reached the
    // preserve destination is by definition one this build could not read, so
    // it is the last place to assume the contents follow the usual rules.
    // `SaveGame.import` strips whitespace itself when reading, so nothing is
    // lost by leaving it in.
    const payload = preserve ? body : body.replace(/\s+/g, "");
    // A header with no payload is not a rescue, it is an empty file that will
    // fail at import. There is nothing here to preserve.
    if (payload.trim() === "") return { ok: false, reason: "empty" };
    const reheadered: ConversionResult = {
      ok: true,
      kind: "reheadered",
      text: TOWER_FILE_MAGIC + "\n" + payload + "\n",
    };
    if (preserve) return reheadered;
    // Validate by decoding, then THROW THE DECODED BYTES AWAY and re-header the
    // original. The check keeps a corrupt value from becoming a `.vctower` that
    // only fails at load, while the discard is what keeps the payload
    // identical. Both properties are wanted, and they are not in tension as
    // long as the validation output is never the thing written.
    //
    // Validated to the SAME bar the load path applies (fatal UTF-8, then JSON,
    // then the tower shape). Checking only that it inflates would pass values
    // `SaveGame.import` goes on to reject, which is the failure this prevents.
    try {
      const json = new TextDecoder("utf-8", { fatal: true }).decode(inflateCapped(fromBase64(payload)));
      if (!looksLikeTower(JSON.parse(json))) return { ok: false, reason: "unreadable" };
    } catch {
      return { ok: false, reason: "unreadable" };
    }
    return reheadered;
  }

  // Pre-compression save: raw JSON. `.vctower` readers require a deflate
  // payload, so this one really is re-encoded, but only the ENCODING changes.
  // The bytes fed to deflateSync are the trimmed string's own bytes, so no
  // field is added, removed, or restamped, and an absent appVersion stays
  // absent.
  //
  // The surrogate check applies in BOTH modes, and that is the whole point:
  // preserve mode promises to keep bytes verbatim, and this is the one path
  // where encoding can silently fail to. Refusing is honest; writing a tower
  // whose name has been rewritten with U+FFFD while reporting it preserved is
  // not. A preserved value only reaches here when it is not VCZ1-prefixed,
  // which for the unreadable backup is exactly the arbitrary-bytes case.
  if (hasLoneSurrogate(trimmed)) return { ok: false, reason: "unreadable" };
  if (!preserve) {
    try {
      if (!looksLikeTower(JSON.parse(trimmed))) return { ok: false, reason: "unreadable" };
    } catch {
      return { ok: false, reason: "unreadable" };
    }
  }
  const packed = deflateSync(new TextEncoder().encode(trimmed), { level: 1 });
  return { ok: true, kind: "compressed", text: TOWER_FILE_MAGIC + "\n" + toBase64(packed) + "\n" };
}

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
 */
export async function migrateSavesToStore(
  store: SaveStorePort,
  scope: SaveScopeToken,
  existingIds: ReadonlySet<string>,
  read: RawSaveReader = localStorageReader,
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
      await store.write(id, converted.text, scope, MIGRATION_SEQ);
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

    if (verified && stored === converted.text) {
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
    if (wrote && verified && stored !== null) {
      // Our write landed but produced something other than what we sent. Left
      // alone this record becomes the derived done-marker and the source is
      // never retried, so the debris has to go before we report the failure.
      try {
        await store.delete(id, scope);
      } catch {
        /* best effort: a destination we cannot clean up is still reported below */
      }
    }
    // The source is untouched in localStorage either way, so the next boot
    // retries. The code is kept so a caller can say something truer than
    // "save failed"; it is only meaningful when the WRITE is what failed.
    outcomes.set(id, "write-failed");
    failures.push({ id, ...(wrote ? {} : { code: saveStoreErrorCode(writeErr) }) });
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
