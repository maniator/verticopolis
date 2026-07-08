import { deflateSync, Inflate } from "fflate";
import { Simulation } from "../engine/Simulation";
import type { SerializedGame } from "../engine/types";

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

export interface SlotInfo {
  slot: number | "auto";
  exists: boolean;
  towerName?: string;
  star?: number;
  population?: number;
  funds?: number;
  savedAt?: number;
}

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

function infoFrom(slot: number | "auto", key: string): SlotInfo {
  const data = readSlot(key);
  if (!data) return { slot, exists: false };
  let population = 0;
  try {
    population = Simulation.deserialize(data).population;
  } catch {
    /* ignore corrupt slot */
  }
  return {
    slot,
    exists: true,
    towerName: data.towerName,
    star: data.star,
    population,
    funds: data.money,
    savedAt: (data as SerializedGame & { savedAt?: number }).savedAt,
  };
}

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
  loadResult(): { sim: Simulation | null; corrupt: boolean } {
    const key = autosaveKey();
    if (localStorage.getItem(key) === null) return { sim: null, corrupt: false }; // truly empty
    const data = readSlot(key); // null ⇒ present but undecodable
    if (!data) return { sim: null, corrupt: true };
    try {
      return { sim: Simulation.deserialize(data), corrupt: false };
    } catch {
      return { sim: null, corrupt: true }; // decoded, but the schema won't load
    }
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
    const slots: SlotInfo[] = [infoFrom("auto", autosaveKey())];
    for (let n = 1; n <= SLOT_COUNT; n++) slots.push(infoFrom(n, SLOT_KEY(n)));
    return slots;
  },

  // ---- Shared writer + export/import -----------------------------------
  saveTo(key: string, sim: Simulation): void {
    latestAsyncSave = null;
    const data = sim.serialize() as SerializedGame & { savedAt: number };
    // Stamp save time without relying on a deterministic clock in the engine.
    data.savedAt = nowMs();
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
    const data = sim.serialize() as SerializedGame & { savedAt: number };
    data.savedAt = nowMs();
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
    const packed = await deflate(new TextEncoder().encode(JSON.stringify(sim.serialize())));
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

// Base64 over raw bytes, chunked so String.fromCharCode never sees an argument
// list long enough to blow the stack.
function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
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
  writeAutosaveValue(value);
  if (legacy !== null) localStorage.removeItem(LEGACY_AUTO_KEY);
}

function writeAutosaveValue(value: string): void {
  localStorage.setItem(AUTO_KEY, value);
}

// Cap on a decompressed localStorage save. A maxed-out tower is well under 2MB
// of JSON; 32MB is generous headroom. localStorage is quota-bounded and
// same-origin, but a corrupt or tampered VCZ1 value could still inflate
// enormously and hang the tab at boot — so, like the .vctower import path, we
// bound it. fflate's streaming Inflate lets us abort as soon as the output
// passes the cap (inflateSync would allocate the whole buffer first).
const MAX_SAVE_INFLATED_BYTES = 32 * 1024 * 1024;

class SaveTooLargeError extends Error {}

function inflateCapped(packed: Uint8Array): Uint8Array {
  const chunks: Uint8Array[] = [];
  let total = 0;
  const inflater = new Inflate((chunk) => {
    total += chunk.length;
    if (total > MAX_SAVE_INFLATED_BYTES) throw new SaveTooLargeError();
    chunks.push(chunk);
  });
  inflater.push(packed, true); // ondata fires synchronously; a throw aborts here
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

// Per-direction support probes, built by actually constructing the streams:
// the "deflate-raw" format string is newer than CompressionStream itself
// (Chrome had the API before the format), so a `typeof` check alone would pass
// on browsers that then throw at use. Probed separately because each caller
// needs only one direction — export/saveToAsync encode, import decodes — and a
// browser missing one must not be blocked from the operation it can perform.
function compressionEncodeSupported(): boolean {
  try {
    new CompressionStream("deflate-raw");
    return true;
  } catch {
    return false;
  }
}

function compressionDecodeSupported(): boolean {
  try {
    new DecompressionStream("deflate-raw");
    return true;
  } catch {
    return false;
  }
}

// Hard ceiling on a decompressed tower. A real maxed-out tower is comfortably
// under 2MB of JSON; 64MB is generous headroom while still defusing a
// decompression bomb (a few-KB file that would otherwise inflate to gigabytes
// and hang the tab before validation ever runs).
const MAX_INFLATED_BYTES = 64 * 1024 * 1024;

/** Thrown by inflate() when a decompressing stream exceeds MAX_INFLATED_BYTES. */
class TowerTooLargeError extends Error {}

// deflate-raw via the native streams API (no zlib/gzip framing — the magic
// line already identifies the format, and raw deflate is the smallest).
function deflate(bytes: Uint8Array): Promise<Uint8Array> {
  // Compressing our own bounded JSON — no cap needed on the output.
  return pipe(bytes, new CompressionStream("deflate-raw"));
}

function inflate(bytes: Uint8Array): Promise<Uint8Array> {
  // Decompressing untrusted input — cap the output to bound bombs.
  return pipe(bytes, new DecompressionStream("deflate-raw"), MAX_INFLATED_BYTES);
}

async function pipe(bytes: Uint8Array, transform: GenericTransformStream, maxBytes = Infinity): Promise<Uint8Array> {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  }).pipeThrough(transform);
  // Read chunk by chunk so a bomb is aborted mid-inflation, before it can
  // materialize a giant buffer — rather than Response().arrayBuffer(), which
  // would buffer the whole (unbounded) output first.
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new TowerTooLargeError();
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

function nowMs(): number {
  // Date is unavailable in the deterministic engine, but the storage layer is
  // UI-side, so a wall-clock stamp here is fine.
  return typeof Date !== "undefined" ? Date.now() : 0;
}
