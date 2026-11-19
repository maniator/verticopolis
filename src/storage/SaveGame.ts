import type { GameMode, SerializedGame } from "@verticopolis/components/shared/types";
import type { SlotInfo } from "./slotInfo";

// The slot-metadata shape lives in its own module (pure types, no runtime), and
// is re-exported here so every existing `from "../storage/SaveGame"` import of
// it keeps working.
export type { SlotInfo } from "./slotInfo";
import {
  checkSaveBytes,
  compressionDecodeSupported,
  compressionEncodeSupported,
  encodeSaveJson,
  fromBase64,
  inflate,
  inflateCapped,
  parseSaveJson,
  STORE_MAGIC,
  TOWER_FILE_MAGIC,
  TowerTooLargeError,
} from "./saveCompression";
import { packVctower, payloadLine } from "./vctowerWriter";
import { packHere, PackerLostError, packSave } from "./savePacker";
import { stashedText, stashUnreadable } from "./unreadableStash";
import { stampText, type SaveStamp } from "./saveStamp";
import { engineSaveText, importObjection, looksLikeTowerSave, readSavedAt } from "./saveTextRead";
import { slotPopulation } from "./slotCensus";
import { rememberedSlotInfo } from "./slotInfoMemo";
import { openSaveStore, saveStore, type SaveStoreKeys } from "./saveStore";
import { UNREADABLE_KEY } from "./unreadableStash";

/**
 * Persistence. Games are stored in the browser (`saveStore`: IndexedDB with
 * a localStorage mirror, or localStorage alone): one auto-save slot plus a
 * handful of named manual slots, so the player can keep multiple towers. Also
 * supports export/import of .vctower tower files for sharing or backups.
 *
 * Stored values are DEFLATE-compressed (see {@link STORE_MAGIC}), about
 * 100-120KB a slot for a late-game tower. The flushes before a reload (crash
 * recovery, update, tab hide) compress synchronously with fflate level 1, so
 * the write lands before the page goes; the timer autosave packs in a worker
 * (`savePacker`). Every .vctower writer, the engine's too, writes the same bits.
 */

const AUTO_KEY = "verticopolis-save";
const LEGACY_AUTO_KEY = "simtower-clone-save";
const SLOT_KEY = (n: number) => `simtower-clone-slot-${n}`;
export const SLOT_COUNT = 3;

export { UNREADABLE_KEY } from "./unreadableStash";

const SLOT_KEYS = Array.from({ length: SLOT_COUNT }, (_, i) => SLOT_KEY(i + 1));
/** Whether `key` names one of the manual slots. */
export const isSlotKey = (key: string): boolean => SLOT_KEYS.includes(key);
const SAVE_KEYS = [AUTO_KEY, LEGACY_AUTO_KEY, ...SLOT_KEYS, UNREADABLE_KEY];

/** Every key that holds a save, and the keys localStorage mirrors
 *  (`saveStore`). The first release on IndexedDB mirrors every save, so a
 *  rollback still finds every tower and what an older build wrote wins here
 *  when newer; the release after it mirrors only the autosave. */
export const SAVE_STORE_KEYS: SaveStoreKeys = { managed: SAVE_KEYS, mirrored: SAVE_KEYS };

/** Open the save store before the first save is read (boot). Resolves false
 *  when the saves stay in localStorage; never rejects. */
export function openSaves(factory?: IDBFactory): Promise<boolean> {
  return openSaveStore(SAVE_STORE_KEYS, {
    factory,
    savedAt: (value) => {
      const text = decodeSlotText(value);
      return text === null ? undefined : parseSavedAt(readSavedAt(text));
    },
  });
}

// Latest-start write token for same-tab async saves. A synchronous save clears
// the token before it writes, so an older async compression can never commit
// over a newer durable flush.
let latestAsyncSave: object | null = null;

/** The Verticopolis tower-file container (.vctower): a magic first line
 *  naming the format and its version, then the deflate-compressed save, so a
 *  ~1.2MB tower packs to ~40KB. A new container version is a new magic line,
 *  with the old ones still accepted on import. */
export const TOWER_FILE_EXT = ".vctower";

/** A save as the engine writes it (`EnginePort.serialize()`): the JSON text
 *  of a `SerializedGame`, with no write stamp yet. */
export type SaveText = string;

/** Hand a stored save to the engine (`loadSave`); true when it loaded the
 *  tower. */
export type TryLoad = (text: SaveText) => boolean;

/** A slot's save as the text an engine loads it from (`engineSaveText`), or
 *  null for an absent or undecodable slot. Nothing parses the tower here: the
 *  engine does, once. */
function readSlotText(key: string): SaveText | null {
  return decodeSlotText(saveStore.get(key));
}

/** {@link readSlotText} on a value already read from storage. */
function decodeSlotText(raw: string | null): SaveText | null {
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
    return engineSaveText(json);
  } catch {
    return null;
  }
}

export function autosaveKey(): string {
  return saveStore.get(AUTO_KEY) !== null || saveStore.get(LEGACY_AUTO_KEY) === null
    ? AUTO_KEY
    : LEGACY_AUTO_KEY;
}

/** The largest timestamp JS Date can represent (ECMA-262), in ms either side
 *  of the epoch: a savedAt beyond it reads as absent. */
const MAX_DATE_MS = 8.64e15;

/** A save's write time, trusted only when it is a finite number Date can
 *  represent; a forged one (string, NaN, out of range) reads as absent. Shared
 *  by the slot rows and the boot-time return-recency read. */
function parseSavedAt(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= MAX_DATE_MS ? value : undefined;
}

/**
 * Slot metadata for the saves manager and the title screen's picker.
 *
 * Takes the stored values of the keys that slot's loader would walk, in order,
 * so the row describes what loading would do. The autosave passes both keys'
 * values, mirroring {@link SaveGame.loadResult}'s fallback: a partial migration or multi-tab
 * divergence can leave `verticopolis-save` undecodable beside a healthy legacy
 * save, and reading only the first would call that row unreadable while
 * `load()` opens it fine and the splash offers Continue for it.
 *
 * `exists` means LOADABLE by construction: the save decodes and parses, and
 * once the engine package is installed the census in `slotCensus.ts` also
 * loads it, the same bar `loadSlot` clears. With no census installed (before
 * the package loads, or after a tick trap) a parseable save still reads as
 * existing and its row carries no population.
 */
function infoFrom(slot: number | "auto", raws: readonly (string | null)[]): SlotInfo {
  // From the RAW values, before any parse: decodeSlotText returns null for an
  // absent key and an undecodable one alike (see SlotInfo.present).
  const present = raws.some((raw) => raw !== null);
  for (const raw of raws) {
    const text = decodeSlotText(raw);
    if (text === null) continue;
    let data: SerializedGame, population: number | undefined;
    try {
      data = parseSaveJson(text) as SerializedGame;
      population = slotPopulation(text);
    } catch {
      continue; // undecodable, or the schema will not load: try the next key
    }
    return {
      slot,
      exists: true,
      present: true,
      size: raw?.length, // base64, a byte a character (see SlotInfo.size)
      towerName: data.towerName,
      star: data.star,
      population,
      funds: data.money,
      // A forged savedAt reads as absent (see parseSavedAt): the dialog shows an
      // empty timestamp instead of "Invalid Date" or a confidently wrong date.
      savedAt: parseSavedAt(data.savedAt),
      // Founded mode, coerced the way a load reads it (absent/forged = classic),
      // so the chip can never carry a raw file string.
      mode: foundedMode(data.mode),
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

/** A save's founded mode: Modern only when the file says so, Classic for an
 *  absent or unknown value, as a load reads it. */
function foundedMode(mode: unknown): GameMode {
  return mode === "modern" ? "modern" : "classic";
}

/** Stamp and pack `text` into a store value, synchronously. DEFLATE level 1
 *  on purpose: sparse v3 saves have already shed their redundancy, so it
 *  compresses within 0.8% of level 6 at a third of the cost. */
function packStamped(text: SaveText): { value: string; stamp: SaveStamp } {
  const { json, stamp } = stampText(text);
  return { value: STORE_MAGIC + payloadLine(packVctower(json, encodeSaveJson(json), stamp)), stamp };
}

export const SaveGame = {
  // ---- Auto-save slot (used on startup) --------------------------------
  /** Save `text` into the Auto-save now; answers the stamp it was written with. */
  save(text: SaveText): SaveStamp {
    return this.saveTo(AUTO_KEY, text);
  },
  /** Autosave `save` (its text, or a maker of the engine's stamped bytes).
   *  Answers the raw DEFLATE it wrote, or null when a newer save took over. */
  saveAsync(save: SaveText | (() => Uint8Array)): Promise<Uint8Array | null> {
    return this.saveToAsync(AUTO_KEY, save);
  },
  hasSave(): boolean {
    return saveStore.get(AUTO_KEY) !== null || saveStore.get(LEGACY_AUTO_KEY) !== null;
  },
  /** Load the autosave through `tryLoad`; true when a save loaded. */
  load(tryLoad: TryLoad): boolean {
    return this.loadResult(tryLoad).loaded;
  },
  /**
   * Load the autosave, distinguishing a genuinely ABSENT save from one that's
   * present but UNREADABLE (corrupt, or from an incompatible/newer format). Boot
   * needs the difference: on `corrupt` it must warn and not silently offer
   * "Continue" (which would drop the player into a fresh tower behind a title
   * that promised their old one) — see main.ts. `tryLoad` hands each decoded
   * save to the engine, which says whether it loaded it.
   */
  loadResult(
    tryLoad: TryLoad,
    refusedAsNewer: () => boolean = () => false,
  ): { loaded: boolean; corrupt: boolean; savedAt: number | undefined; refusedKey?: string; newerKey?: string } {
    // Try the Verticopolis key first, then the legacy key: a partial migration
    // or multi-tab divergence can leave an unreadable value on one key beside a
    // healthy save on the other, and the healthy one must still load. `corrupt`
    // reports whether any key checked before the successful load was present
    // but unreadable, so boot still stashes those bytes (preserveUnreadable)
    // and warns honestly even when the fallback rescued a tower.
    let corrupt = false;
    let refusedKey: string | undefined; // the first key that held an unreadable save
    let newerKey: string | undefined; // the first one the engine said a newer build wrote
    for (const key of [AUTO_KEY, LEGACY_AUTO_KEY]) {
      if (saveStore.get(key) === null) continue; // absent, not corrupt
      const text = readSlotText(key); // null ⇒ present but undecodable
      // The engine applies the founder rule: an unstamped stored tower
      // predates the appVersion stamp (pre-2.0). Surface the loaded tower's
      // write time from the SAME decoded data and the SAME key that actually
      // loaded (legacy fallback included), so the boot return-recency bucket
      // needs no second decode of the slot. A forged or out-of-range stamp
      // reads as absent (parseSavedAt). A save the engine refuses is
      // unreadable, as below.
      if (text !== null && tryLoad(text)) {
        return { loaded: true, corrupt, savedAt: parseSavedAt(readSavedAt(text)), refusedKey, newerKey };
      }
      corrupt = true;
      refusedKey ??= key;
      if (text !== null && refusedAsNewer()) newerKey ??= key;
    }
    return { loaded: false, corrupt, savedAt: undefined, refusedKey, newerKey };
  },
  clear(): void {
    saveStore.remove(AUTO_KEY);
    saveStore.remove(LEGACY_AUTO_KEY);
  },
  /** Keep an unreadable autosave aside (see `unreadableStash`); true when kept. */
  preserveUnreadable(key: string = autosaveKey(), newer = false): boolean {
    return stashUnreadable(key, newer);
  },
  /** The kept save, as text a download can carry, or null when none is kept. */
  unreadableBackup(): string | null {
    return stashedText();
  },

  // ---- Named manual slots ----------------------------------------------
  saveSlot(n: number, text: SaveText): void {
    this.saveTo(SLOT_KEY(n), text);
  },
  /** Raw presence check for a manual slot, parse-free and cheap, so a
   *  corrupt-but-present slot still reads as occupied. Anything that picks a
   *  "free" slot to WRITE must use this, never `listSlots().exists` (which is
   *  parse-based and would offer a possibly-recoverable slot for overwrite). */
  hasSlot(n: number): boolean {
    return saveStore.get(SLOT_KEY(n)) !== null;
  },
  /** Load a manual slot through `tryLoad` (the engine applies the founder
   *  rule); false for an empty, undecodable or refused slot. */
  loadSlot(n: number, tryLoad: TryLoad): boolean {
    const text = readSlotText(SLOT_KEY(n));
    return text !== null && tryLoad(text);
  },
  deleteSlot(n: number): void {
    saveStore.remove(SLOT_KEY(n));
  },
  /** A manual slot's stored value exactly as it sits in storage (packed, not
   *  decoded), or null for an empty slot. The overwrite guard
   *  (`./slotGuard`) fingerprints it and keeps it whole for Undo. */
  slotRaw(n: number): string | null {
    return saveStore.get(SLOT_KEY(n));
  },
  /** Put a value read by {@link SaveGame.slotRaw} back into its slot, byte for
   *  byte. Throws as a slot save does when storage refuses the write. */
  restoreSlotRaw(n: number, raw: string): void {
    saveStore.set(SLOT_KEY(n), raw);
  },

  /** Metadata for every slot, for the saves manager UI. A loaded or empty slot
   *  whose stored values and census reader hold reuses its last row. */
  listSlots(): SlotInfo[] {
    const row = (slot: SlotInfo["slot"], ...keys: string[]) => rememberedSlotInfo(slot, keys, (raws) => infoFrom(slot, raws));
    const slots: SlotInfo[] = [row("auto", AUTO_KEY, LEGACY_AUTO_KEY)];
    for (let n = 1; n <= SLOT_COUNT; n++) slots.push(row(n, SLOT_KEY(n)));
    return slots;
  },

  /** Pack a sim into the `VCZ1:` store value SYNCHRONOUSLY, without writing
   *  it anywhere (the desktop sync save path cannot await a crash flush).
   *  {@link SaveGame.saveTo} packs the same way. */
  packSync(text: SaveText): string {
    return packStamped(text).value;
  },

  // ---- Shared writer + export/import -----------------------------------
  saveTo(key: string, text: SaveText): SaveStamp {
    // Only an AUTOSAVE-slot write invalidates an in-flight async autosave (the
    // token exists so older compressed state can't commit over this newer
    // flush of the SAME slot). A manual slot save targets a different key, so
    // it must not cancel the pending autosave commit.
    if (key === AUTO_KEY) latestAsyncSave = null;
    // Synchronous by design: this runs just before a reload in the
    // crash-recovery path, where an async write could be lost.
    const { value, stamp } = packStamped(text);
    writeSlot(key, value);
    return stamp;
  },
  async saveToAsync(key: string, save: SaveText | (() => Uint8Array)): Promise<Uint8Array | null> {
    if (typeof save === "string" && !compressionEncodeSupported()) {
      this.saveTo(key, save);
      return null;
    }
    // Encode (and refuse an oversized save) before claiming the token: a
    // refused save leaves no token behind, so an older save of the same slot
    // still in flight commits instead of the slot keeping neither. The engine's
    // bytes come stamped; packing moves them to a worker (`savePacker`), and a
    // worker that dies with them has the save made again and packed here.
    const make = () => (typeof save === "string" ? encodeSaveJson(stampText(save).json) : checkSaveBytes(save()));
    const bytes = make();
    const token = {};
    latestAsyncSave = token;
    const { packed, base64 } = await packSave(bytes).catch((err: unknown) => {
      if (err instanceof PackerLostError) return packHere(make());
      throw err;
    });
    if (latestAsyncSave !== token) return null;
    latestAsyncSave = null;
    writeSlot(key, STORE_MAGIC + base64, packed);
    return packed;
  },

  /** Serialize the tower into the .vctower container (see TOWER_FILE_MAGIC). */
  async export(text: SaveText): Promise<string> {
    // Exports carry the same write-time provenance as local saves: a moved
    // file says when and by which build it was written. packVctower writes the
    // same bits in every browser, through the engine when it runs.
    const { json, stamp } = stampText(text);
    return packVctower(json, encodeSaveJson(json), stamp);
  },

  /** Download name for an export: the tower's name slugged, e.g. "tower-one.vctower". */
  exportFilename(towerName: string | undefined): string {
    const slug = (towerName || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    return (slug || "tower") + TOWER_FILE_EXT;
  },

  /** Read a `.vctower` file into save text for the engine's `loadSave`. The
   *  checks and refusal copy stay here, in front of the engine, whose own
   *  `.vctower` reader is more lenient (#1410 N4). */
  async importText(text: string): Promise<SaveText> {
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
    let json: SaveText;
    try {
      // Whitespace-tolerant: survives files re-wrapped by editors or mailers.
      const packed = fromBase64(trimmed.slice(magic[0].length).replace(/\s+/g, ""));
      // fatal decoder: a flipped byte must fail the import loudly, never
      // silently half-load a tower with U+FFFD-mangled strings.
      json = engineSaveText(new TextDecoder("utf-8", { fatal: true }).decode(await inflate(packed)));
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
    // The engine parses the save; a text the scan is unsure of is checked
    // here first, and a save the engine refuses is told apart by the caller
    // (`importObjection`), with the same copy.
    const objection = looksLikeTowerSave(json) ? undefined : importObjection(json);
    if (objection) throw new Error(objection);
    return json;
  },

  /** What the import's checks hold against a save the engine refused, in the
   *  player's words (`importObjection`), or undefined to give the engine's. */
  importObjection,
};

/** Store `value` under `key`; `packed`, when given, is its deflate bytes (see `saveStore.set`). */
function writeSlot(key: string, value: string, packed?: Uint8Array): void {
  if (key !== AUTO_KEY) {
    saveStore.set(key, value, packed);
    return;
  }
  const legacy = saveStore.get(LEGACY_AUTO_KEY);
  const needsQuotaReclaim = legacy !== null && saveStore.get(AUTO_KEY) === null;
  if (needsQuotaReclaim) {
    saveStore.remove(LEGACY_AUTO_KEY);
    try {
      writeAutosaveValue(value, packed);
    } catch (err) {
      try {
        saveStore.set(LEGACY_AUTO_KEY, legacy);
      } catch {
        /* best effort: preserve the old key if the migrated write fails */
      }
      throw err;
    }
    return;
  }
  try {
    writeAutosaveValue(value, packed);
  } catch (err) {
    // Both keys can coexist (multi-tab, or an older build re-writing the
    // legacy key after this build migrated it). The legacy value is usually a
    // stale duplicate of an already-persisted tower, so under quota pressure
    // drop it first and retry the write before giving up.
    if (legacy === null) throw err;
    saveStore.remove(LEGACY_AUTO_KEY);
    try {
      writeAutosaveValue(value, packed);
    } catch (retryErr) {
      // If the retry fails too, put the legacy value back: an unreadable
      // primary falls back to the legacy save at load (see loadResult), so
      // the deleted value may be the only readable tower left.
      try {
        saveStore.set(LEGACY_AUTO_KEY, legacy);
      } catch {
        /* best effort: quota may still be exhausted */
      }
      throw retryErr;
    }
    return;
  }
  if (legacy !== null) saveStore.remove(LEGACY_AUTO_KEY);
}

function writeAutosaveValue(value: string, packed?: Uint8Array): void {
  saveStore.set(AUTO_KEY, value, packed);
}

