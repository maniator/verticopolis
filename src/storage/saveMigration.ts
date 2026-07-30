import { deflateSync } from "fflate";
import {
  fromBase64,
  inflateCapped,
  STORE_MAGIC,
  toBase64,
  TOWER_FILE_MAGIC,
} from "./saveCompression";
import type { SaveScopeToken, SaveStorePort } from "../platform/saveStore";

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
 * Converting one to the other is therefore a string operation on the header. No
 * inflate, no `JSON.parse`, no `Simulation.deserialize`, no re-stamp. The
 * payload this module writes is the same payload it read, so Founder status
 * cannot be affected by it, and that holds by construction rather than by
 * anyone remembering to preserve a field.
 *
 * The only case needing real work is a pre-compression save, which is raw JSON.
 * That one gets deflated here, but note that it is still the ORIGINAL string
 * being compressed. It is never parsed and re-serialized, so an absent
 * `appVersion` stays absent there too.
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
 * Every localStorage key holding a tower, paired with where it lands. All six,
 * including `simtower-clone-unreadable`: that key exists precisely to hold
 * bytes an older build could not read, which is the case most likely to be
 * recoverable later and the one a player would be angriest to lose.
 */
export const MIGRATION_SOURCES: readonly { readonly key: string; readonly id: SaveSlotId }[] = [
  { key: "verticopolis-save", id: "auto" },
  { key: "simtower-clone-save", id: "auto-legacy" },
  { key: "simtower-clone-slot-1", id: "slot-1" },
  { key: "simtower-clone-slot-2", id: "slot-2" },
  { key: "simtower-clone-slot-3", id: "slot-3" },
  { key: "simtower-clone-unreadable", id: "unreadable" },
];

/** Outcome of converting one stored value into `.vctower` text. */
export type ConversionResult =
  | { readonly ok: true; readonly text: string; readonly kind: "reheadered" | "compressed" }
  | { readonly ok: false; readonly reason: "empty" | "unreadable" };

/**
 * Convert a raw localStorage value into `.vctower` file text.
 *
 * Pure, and pure on purpose: it is the one piece of this file whose correctness
 * is a byte-fidelity question, so it takes a string and returns a string with
 * no store, no clock, and no globals to stand in the way of testing it.
 */
export function toTowerFile(raw: string): ConversionResult {
  const trimmed = raw.trim();
  if (trimmed === "") return { ok: false, reason: "empty" };

  if (trimmed.startsWith(STORE_MAGIC)) {
    const payload = trimmed.slice(STORE_MAGIC.length).replace(/\s+/g, "");
    // Validate by decoding, then THROW THE DECODED BYTES AWAY and re-header the
    // original. The check keeps a corrupt value from becoming a `.vctower` that
    // only fails at load, while the discard is what keeps the payload
    // bit-identical. Both properties are wanted, and they are not in tension
    // as long as the validation output is never the thing written.
    try {
      inflateCapped(fromBase64(payload));
    } catch {
      return { ok: false, reason: "unreadable" };
    }
    return { ok: true, kind: "reheadered", text: TOWER_FILE_MAGIC + "\n" + payload + "\n" };
  }

  // Pre-compression save: raw JSON. `.vctower` readers require a deflate
  // payload, so this one really is re-encoded, but only the ENCODING changes.
  // The bytes fed to deflateSync are the stored string's own bytes, so no field
  // is added, removed, or restamped, and an absent appVersion stays absent.
  try {
    JSON.parse(trimmed); // validation only; the result is deliberately unused
  } catch {
    return { ok: false, reason: "unreadable" };
  }
  const packed = deflateSync(new TextEncoder().encode(trimmed), { level: 1 });
  return { ok: true, kind: "compressed", text: TOWER_FILE_MAGIC + "\n" + toBase64(packed) + "\n" };
}

/** What one source key did during a migration run. */
export type MigrationOutcome =
  | "migrated"
  | "absent"
  | "already-present"
  | "unreadable"
  | "write-failed";

export interface MigrationReport {
  readonly outcomes: ReadonlyMap<SaveSlotId, MigrationOutcome>;
  /** True when at least one tower moved. */
  readonly migratedAny: boolean;
  /**
   * True when every source key was absent, so there was nothing to do. Distinct
   * from "migrated nothing", which can also mean every destination was already
   * occupied or every value was corrupt, and those are not the same event.
   */
  readonly nothingToDo: boolean;
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
 * Seq for a migration write. Every destination is verified absent first, so
 * this is by definition the first write for that id and the lowest seq is
 * correct. A migration must never outrank a real save.
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
 *  - A value that will not decode is reported and left alone rather than
 *    written through as a `.vctower` that fails at load.
 */
export async function migrateSavesToStore(
  store: SaveStorePort,
  scope: SaveScopeToken,
  existingIds: ReadonlySet<string>,
  read: RawSaveReader = localStorageReader,
): Promise<MigrationReport> {
  const outcomes = new Map<SaveSlotId, MigrationOutcome>();

  for (const { key, id } of MIGRATION_SOURCES) {
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
    if (raw === null) {
      outcomes.set(id, "absent");
      continue;
    }
    const converted = toTowerFile(raw);
    if (!converted.ok) {
      outcomes.set(id, converted.reason === "empty" ? "absent" : "unreadable");
      continue;
    }
    try {
      await store.write(id, converted.text, scope, MIGRATION_SEQ);
      outcomes.set(id, "migrated");
    } catch {
      // The shell refuses an existing destination itself (it writes O_EXCL), so
      // a rejection here can mean another process won the race. Either way the
      // tower is still in localStorage and the next boot retries.
      outcomes.set(id, "write-failed");
    }
  }

  const values = [...outcomes.values()];
  return {
    outcomes,
    migratedAny: values.includes("migrated"),
    nothingToDo: values.every((v) => v === "absent"),
  };
}
