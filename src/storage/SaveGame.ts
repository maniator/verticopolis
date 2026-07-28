import { deflateSync } from "fflate";
import { Simulation } from "../engine/Simulation";
import type { SerializedGame } from "../engine/types";
import { isGameMode } from "../engine/types";
import type { SlotInfo } from "./slotInfo";

// The slot-metadata shape lives in its own module (pure types, no runtime), and
// is re-exported here so every existing `from "../storage/SaveGame"` import of
// it keeps working.
export type { SlotInfo } from "./slotInfo";
import {
  compressionDecodeSupported,
  compressionEncodeSupported,
  deflate,
  fromBase64,
  inflate,
  inflateCapped,
  toBase64,
  TowerTooLargeError,
} from "./saveCompression";

/**
 * Persistence. Games are stored in localStorage: one auto-save slot plus a
 * handful of named manual slots, so the player can keep multiple towers. Also
 * supports export/import of Verticopolis tower files (.vctower) for sharing
 * or backups.
 *
 * localStorage values are DEFLATE-compressed (see {@link STORE_MAGIC}): a real
 * late-game tower is hundreds of KB of JSON even in the sparse v3 unit shape,
 * and across the autosave slot plus three manual slots the raw JSON would
 * crowd the ~5MB localStorage quota and risk a failed save on a large tower.
 * Compressed, each slot lands around 100-120KB. The compression is
 * synchronous (fflate) on purpose: saving happens at boot, on a timer, and —
 * critically — right before a reload in the crash-recovery / update paths,
 * where an async write could be interrupted mid-flush and lose the tower. (The
 * .vctower FILE format keeps using the async native CompressionStream: those
 * exports are user-initiated and never race a reload.)
 */

const AUTO_KEY = "verticopolis-save";
const LEGACY_AUTO_KEY = "simtower-clone-save";
const SLOT_KEY = (n: number) => `simtower-clone-slot-${n}`;
export const SLOT_COUNT = 3;

/**
 * Backup key for an autosave that couldn't be read at boot (see
 * {@link SaveGame.preserveUnreadable}). A truly corrupt save is dead, but a save
 * written by a *newer* build and opened on an older one is only unreadable
 * *here* — stashing the raw bytes keeps them off the autosave slot's chopping
 * block so a later version can still recover them.
 */
const UNREADABLE_KEY = "simtower-clone-unreadable";

/**
 * Prefix marking a compressed localStorage value: this magic, then the
 * base64 of the DEFLATE-compressed JSON. A legacy uncompressed save is raw
 * JSON (starts with `{`), so the prefix check cleanly tells the two apart and
 * old saves keep loading — they re-write compressed on the next save.
 */
const STORE_MAGIC = "VCZ1:";
// Latest-start write token for same-tab async saves. A synchronous save clears
// the token before it writes, so an older async compression can never commit
// over a newer durable flush.
let latestAsyncSave: object | null = null;

/**
 * The Verticopolis tower-file container (.vctower): a magic first line naming
 * the format and its version, then the save payload — deflate-compressed
 * JSON, base64-encoded. The file is deliberately NOT raw JSON — exports
 * travel as downloads and come back through the file picker, never through a
 * copy-paste textarea — and the compression makes it a fraction of the JSON
 * it replaces (a ~1.2MB tower packs to ~40KB). Bumping the container format
 * later means a new magic line (VCTOWER2), with this one still accepted on
 * import.
 */
export const TOWER_FILE_EXT = ".vctower";
const TOWER_FILE_MAGIC = "VCTOWER1";

function readSlot(key: string): SerializedGame | null {
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  try {
    // Compressed values carry STORE_MAGIC; anything else is a legacy raw-JSON
    // save from before compression (still loads, then upgrades on next write).
    // The decoder is `fatal` (like the .vctower path) so a flipped byte fails
    // loudly here — caught below, treated as a corrupt slot — rather than
    // silently loading a U+FFFD-mangled tower.
    const json = raw.startsWith(STORE_MAGIC)
      ? new TextDecoder("utf-8", { fatal: true }).decode(inflateCapped(fromBase64(raw.slice(STORE_MAGIC.length))))
      : raw;
    return JSON.parse(json) as SerializedGame;
  } catch {
    return null;
  }
}

function autosaveKey(): string {
  return localStorage.getItem(AUTO_KEY) !== null || localStorage.getItem(LEGACY_AUTO_KEY) === null
    ? AUTO_KEY
    : LEGACY_AUTO_KEY;
}

/** The largest timestamp JS Date can represent (ECMA-262: 8,640,000,000,000,000
 *  ms either side of the epoch). A finite savedAt beyond this still renders
 *  "Invalid Date", so the read treats it as absent. */
const MAX_DATE_MS = 8.64e15;

/** A save's write time, trusted only when it is a finite number Date can
 *  represent (+/-8.64e15 ms). A forged savedAt (string, NaN, or out of range)
 *  reads as absent, never as a confidently wrong date. Shared by the Saves
 *  dialog metadata and the boot-time return-recency read so the trust posture
 *  is defined once. */
function parseSavedAt(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= MAX_DATE_MS ? value : undefined;
}

/**
 * Slot metadata for the saves manager and the title screen's picker.
 *
 * Takes the key LIST that slot's loader would walk, so the row describes what
 * loading would actually do. The autosave passes both keys, mirroring
 * {@link SaveGame.loadResult}'s fallback: a partial migration or multi-tab
 * divergence can leave `verticopolis-save` undecodable beside a healthy legacy
 * save, and reading only the first would call that row unreadable while
 * `load()` opens it fine and the splash offers Continue for it.
 *
 * `exists` means LOADABLE by construction: it is claimed only once
 * `Simulation.deserialize` has accepted the payload, the same bar `loadSlot`
 * clears, so a row can never offer a Load that is certain to fail. Defensive
 * today (deserialize coerces rather than throws, and readSlot already catches a
 * null payload); it keeps the guarantee free if that ever changes.
 */
function infoFrom(slot: number | "auto", ...keys: string[]): SlotInfo {
  // From the RAW keys, before any parse: readSlot returns null for an absent
  // key and an undecodable one alike (see SlotInfo.present).
  const present = keys.some((k) => localStorage.getItem(k) !== null);
  for (const key of keys) {
    const data = readSlot(key);
    if (!data) continue;
    let population: number;
    try {
      population = Simulation.deserialize(data).population;
    } catch {
      continue; // decoded, but the schema will not load: try the next key
    }
    return {
      slot,
      exists: true,
      present: true,
      towerName: data.towerName,
      star: data.star,
      population,
      funds: data.money,
      // Same trust posture as every other save field: a forged savedAt reads as
      // absent (see parseSavedAt), so the dialog shows an empty timestamp
      // instead of "Invalid Date". Absent, not clamped: a clamped forgery would
      // display a confidently wrong date.
      savedAt: parseSavedAt(data.savedAt),
      // Founded mode, run through the same isGameMode coercion deserialize
      // uses (absent/forged = classic), so the chip can never carry a raw file
      // string.
      mode: isGameMode(data.mode) ? data.mode : "classic",
      // 1-indexed in-game day, matching the TDT import report's convention. A
      // day is 1440 minutes in EVERY calendar (see src/engine/calendar.ts), so
      // this cannot disagree with the in-game date for either mode. Same
      // absent-not-clamped posture as savedAt: negative or absurdly large
      // minutes (past ~1,000 in-game years, the TDT importer's own ceiling)
      // read as absent rather than as a confidently wrong day.
      day:
        typeof data.minutes === "number" &&
        Number.isFinite(data.minutes) &&
        data.minutes >= 0 &&
        data.minutes / 1440 <= MAX_SLOT_DAY
          ? Math.floor(data.minutes / 1440) + 1
          : undefined,
    };
  }
  return { slot, exists: false, present };
}

/** Ceiling on the save's day COUNTER (minutes / 1440, zero-indexed), mirroring
 *  the TDT importer's MAX_IMPORT_DAY (~1,000 in-game years). The dialog shows
 *  1-indexed days, so the largest label this admits is "Day 360,001"; a forged
 *  minutes beyond the ceiling would render a screen-wide number and reads as
 *  absent instead. */
const MAX_SLOT_DAY = 360_000;

export const SaveGame = {
  // ---- Auto-save slot (used on startup) --------------------------------
  save(sim: Simulation): void {
    this.saveTo(AUTO_KEY, sim);
  },
  async saveAsync(sim: Simulation): Promise<void> {
    await this.saveToAsync(AUTO_KEY, sim);
  },
  hasSave(): boolean {
    return localStorage.getItem(AUTO_KEY) !== null || localStorage.getItem(LEGACY_AUTO_KEY) !== null;
  },
  load(): Simulation | null {
    return this.loadResult().sim;
  },
  /**
   * Load the autosave, distinguishing a genuinely ABSENT save from one that's
   * present but UNREADABLE (corrupt, or from an incompatible/newer format). Boot
   * needs the difference: on `corrupt` it must warn and not silently offer
   * "Continue" (which would drop the player into a fresh tower behind a title
   * that promised their old one) — see main.ts.
   */
  loadResult(): { sim: Simulation | null; corrupt: boolean; savedAt: number | undefined } {
    // Try the Verticopolis key first, then the legacy key: a partial migration
    // or multi-tab divergence can leave an unreadable value on one key beside a
    // healthy save on the other, and the healthy one must still load. `corrupt`
    // reports whether any key checked before the successful load was present
    // but unreadable, so boot still stashes those bytes (preserveUnreadable)
    // and warns honestly even when the fallback rescued a tower.
    let corrupt = false;
    for (const key of [AUTO_KEY, LEGACY_AUTO_KEY]) {
      if (localStorage.getItem(key) === null) continue; // absent, not corrupt
      const data = readSlot(key); // null ⇒ present but undecodable
      if (data) {
        try {
          const sim = Simulation.deserialize(data);
          // Surface the loaded tower's write time from the SAME decoded data and
          // the SAME key that actually loaded (legacy fallback included), so the
          // boot return-recency bucket needs no second decode of the slot. A
          // forged or out-of-range stamp reads as absent (parseSavedAt).
          return { sim, corrupt, savedAt: parseSavedAt(data.savedAt) };
        } catch {
          /* decoded, but the schema won't load; treated as unreadable below */
        }
      }
      corrupt = true;
    }
    return { sim: null, corrupt, savedAt: undefined };
  },
  clear(): void {
    localStorage.removeItem(AUTO_KEY);
    localStorage.removeItem(LEGACY_AUTO_KEY);
  },
  /**
   * Stash an unreadable autosave under a backup key so the 30s autosave doesn't
   * silently destroy it. A truly corrupt compressed save is unrecoverable, but a
   * save from a *newer* build (opened on an older one) is not — keeping the bytes
   * lets a later version recover them instead of overwriting on the next tick.
   */
  preserveUnreadable(): void {
    const raw = localStorage.getItem(autosaveKey());
    if (raw === null) return;
    try {
      localStorage.setItem(UNREADABLE_KEY, raw);
    } catch {
      /* best effort — a full quota just means we can't back it up */
    }
  },

  // ---- Named manual slots ----------------------------------------------
  saveSlot(n: number, sim: Simulation): void {
    this.saveTo(SLOT_KEY(n), sim);
  },
  /** Raw presence check for a manual slot, parse-free and cheap, so a
   *  corrupt-but-present slot still reads as occupied. Anything that picks a
   *  "free" slot to WRITE must use this, never `listSlots().exists` (which is
   *  parse-based and would offer a possibly-recoverable slot for overwrite). */
  hasSlot(n: number): boolean {
    return localStorage.getItem(SLOT_KEY(n)) !== null;
  },
  loadSlot(n: number): Simulation | null {
    const data = readSlot(SLOT_KEY(n));
    if (!data) return null;
    try {
      return Simulation.deserialize(data);
    } catch {
      return null;
    }
  },
  deleteSlot(n: number): void {
    localStorage.removeItem(SLOT_KEY(n));
  },

  /** Metadata for every slot, for the saves manager UI. */
  listSlots(): SlotInfo[] {
    const slots: SlotInfo[] = [infoFrom("auto", AUTO_KEY, LEGACY_AUTO_KEY)];
    for (let n = 1; n <= SLOT_COUNT; n++) slots.push(infoFrom(n, SLOT_KEY(n)));
    return slots;
  },

  // ---- Shared writer + export/import -----------------------------------
  saveTo(key: string, sim: Simulation): void {
    // Only an AUTOSAVE-slot write invalidates an in-flight async autosave (the
    // token exists so older compressed state can't commit over this newer
    // flush of the SAME slot). A manual slot save targets a different key, so
    // it must not cancel the pending autosave commit; that would leave the
    // autosave slot stale until the next timer tick.
    if (key === AUTO_KEY) latestAsyncSave = null;
    const data = stamp(sim.serialize());
    // DEFLATE the JSON so four full-tower slots stay well under the ~5MB
    // localStorage quota (see STORE_MAGIC). Synchronous by design — this runs
    // just before a reload in the crash-recovery path, where an async write
    // could be lost. base64 keeps the value a safe ASCII string.
    //
    // Level 1 on purpose: sparse v3 saves (serializeUnit omits default fields)
    // have already shed their redundancy, so on a real 12,975-unit tower level 1
    // compressed within 0.8% of the level-6 size at a third of the cost (7ms vs
    // 21ms), keeping the pre-reload flush short.
    const packed = STORE_MAGIC + toBase64(deflateSync(new TextEncoder().encode(JSON.stringify(data)), { level: 1 }));
    writeSlot(key, packed);
  },
  async saveToAsync(key: string, sim: Simulation): Promise<void> {
    if (!compressionEncodeSupported()) {
      this.saveTo(key, sim);
      return;
    }
    const token = {};
    latestAsyncSave = token;
    const data = stamp(sim.serialize());
    const packed = await deflate(new TextEncoder().encode(JSON.stringify(data)));
    if (latestAsyncSave !== token) return;
    latestAsyncSave = null;
    writeSlot(key, STORE_MAGIC + toBase64(packed));
  },

  /** Serialize the tower into the .vctower container (see TOWER_FILE_MAGIC). */
  async export(sim: Simulation): Promise<string> {
    // Export only WRITES compressed data, so it needs just the encoder; a
    // browser missing only the decoder can still create tower files.
    if (!compressionEncodeSupported()) {
      throw new Error("This browser is too old to create tower files. Try a current browser.");
    }
    // Exports carry the same write-time provenance as local saves: a moved
    // file says when and by which build it was written.
    const packed = await deflate(new TextEncoder().encode(JSON.stringify(stamp(sim.serialize()))));
    return TOWER_FILE_MAGIC + "\n" + toBase64(packed) + "\n";
  },

  /** Download name for an export: the tower's name slugged, e.g. "tower-one.vctower". */
  exportFilename(sim: Simulation): string {
    const slug = (sim.tower.towerName || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    return (slug || "tower") + TOWER_FILE_EXT;
  },

  /** Parse a `.vctower` tower file. */
  async import(text: string): Promise<Simulation> {
    const trimmed = text.trim();
    // Match the whole VCTOWER family, not just this version's magic, so a file
    // from a newer build gets an honest "update the game" rather than a generic
    // "not a tower file".
    const magic = /^VCTOWER(\d+)/.exec(trimmed);
    if (!magic) {
      throw new Error("Not a Verticopolis tower file.");
    }
    if (magic[0] !== TOWER_FILE_MAGIC) {
      throw new Error("This tower file was made by a newer version of Verticopolis. Update the game to load it.");
    }
    // Distinguish "your browser can't decompress" from "this file is broken"
    // BEFORE the try below — otherwise a missing API blames a healthy file.
    // Import only READS compressed data, so it needs just the decoder.
    if (!compressionDecodeSupported()) {
      throw new Error("This browser is too old to open compressed tower files. Try a current browser.");
    }
    let data: SerializedGame;
    try {
      // Whitespace-tolerant: survives files re-wrapped by editors or mailers.
      const packed = fromBase64(trimmed.slice(magic[0].length).replace(/\s+/g, ""));
      // fatal decoder: a flipped byte must fail the import loudly, never
      // silently half-load a tower with U+FFFD-mangled strings.
      data = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await inflate(packed))) as SerializedGame;
    } catch (err) {
      // A crafted tiny file can inflate to gigabytes (a decompression bomb);
      // inflate() caps the output and throws this, distinct from "damaged".
      if (err instanceof TowerTooLargeError) {
        throw new Error("This tower file is too large to open safely.");
      }
      // Bad base64, corrupt deflate data, mangled UTF-8, or truncated JSON —
      // the container was recognized, so the file is OURS but broken. Say so.
      throw new Error("This tower file is damaged and can't be read.");
    }
    if (typeof data.minutes !== "number" || !Array.isArray(data.units)) {
      throw new Error("Not a valid tower save file.");
    }
    return Simulation.deserialize(data);
  },
};

/** True when a failed save write is STORAGE's fault (quota full, private
 *  mode, storage disabled) rather than a serialize/compression bug. Callers
 *  word their failure feedback on this: "free up space or allow site storage"
 *  is real advice for a storage failure and a wild-goose chase for a code bug.
 *  Matched by NAME, not `instanceof DOMException`: a cross-realm exception or
 *  a wrapper rethrowing a plain error-like object fails the instanceof check
 *  while still being a genuine quota/security failure. SecurityError is only
 *  trusted on a real DOMException (the name is too generic on arbitrary
 *  objects); the two quota names are unambiguous wherever they appear. */
export function isStorageWriteError(err: unknown): boolean {
  const name = (err as { name?: unknown } | null | undefined)?.name;
  if (name === "QuotaExceededError" || name === "NS_ERROR_DOM_QUOTA_REACHED") return true; // Firefox's quota name
  return err instanceof DOMException && err.name === "SecurityError";
}

/**
 * Honest manual-save failure copy, shared by Quick Save (saveLoad) and the
 * slot saves (appModals). Blames storage only when it IS a storage failure:
 * the "free up space or allow site storage" advice matches the
 * reload-hardening spec's crash-card wording, and would misdirect the player
 * if a serialize/compression bug threw instead (those keep the raw detail,
 * the same diagnosability contract as "Import failed: <message>").
 */
export function saveFailureMessage(err: unknown): string {
  return isStorageWriteError(err)
    ? "Save failed: storage is full or blocked. Free up space or allow site storage, then try again."
    : "Save failed: " + (err instanceof Error && err.message ? err.message : String(err));
}

function writeSlot(key: string, value: string): void {
  if (key !== AUTO_KEY) {
    localStorage.setItem(key, value);
    return;
  }
  const legacy = localStorage.getItem(LEGACY_AUTO_KEY);
  const needsQuotaReclaim = legacy !== null && localStorage.getItem(AUTO_KEY) === null;
  if (needsQuotaReclaim) {
    localStorage.removeItem(LEGACY_AUTO_KEY);
    try {
      writeAutosaveValue(value);
    } catch (err) {
      try {
        localStorage.setItem(LEGACY_AUTO_KEY, legacy);
      } catch {
        /* best effort: preserve the old key if the migrated write fails */
      }
      throw err;
    }
    return;
  }
  try {
    writeAutosaveValue(value);
  } catch (err) {
    // Both keys can coexist (multi-tab, or an older build re-writing the
    // legacy key after this build migrated it). The legacy value is usually a
    // stale duplicate of an already-persisted tower, so under quota pressure
    // drop it first and retry the write before giving up.
    if (legacy === null) throw err;
    localStorage.removeItem(LEGACY_AUTO_KEY);
    try {
      writeAutosaveValue(value);
    } catch (retryErr) {
      // If the retry fails too, put the legacy value back: an unreadable
      // primary falls back to the legacy save at load (see loadResult), so
      // the deleted value may be the only readable tower left.
      try {
        localStorage.setItem(LEGACY_AUTO_KEY, legacy);
      } catch {
        /* best effort: quota may still be exhausted */
      }
      throw retryErr;
    }
    return;
  }
  if (legacy !== null) localStorage.removeItem(LEGACY_AUTO_KEY);
}

function writeAutosaveValue(value: string): void {
  localStorage.setItem(AUTO_KEY, value);
}

function nowMs(): number {
  // Date is unavailable in the deterministic engine, but the storage layer is
  // UI-side, so a wall-clock stamp here is fine.
  return typeof Date !== "undefined" ? Date.now() : 0;
}

/** Write-time provenance: when the save was written and by which build. The
 *  engine never emits these (serialize() is stamp-free); every write path
 *  (localStorage and .vctower alike) re-stamps here, so the values always
 *  describe THIS file, never a previous device's. */
function stamp(data: SerializedGame): SerializedGame {
  data.savedAt = nowMs();
  data.appVersion = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "dev";
  return data;
}
