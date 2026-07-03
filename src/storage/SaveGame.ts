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
 * tower is ~750KB of JSON, which — across the autosave slot plus three manual
 * slots — would crowd the ~5MB localStorage quota and risk a failed save on a
 * large tower. Compressed, each is a few tens of KB. The compression is
 * synchronous (fflate) on purpose: saving happens at boot, on a timer, and —
 * critically — right before a reload in the crash-recovery / update paths,
 * where an async write could be interrupted mid-flush and lose the tower. (The
 * .vctower FILE format keeps using the async native CompressionStream: those
 * exports are user-initiated and never race a reload.)
 */

const AUTO_KEY = "simtower-clone-save";
const SLOT_KEY = (n: number) => `simtower-clone-slot-${n}`;
export const SLOT_COUNT = 3;

/**
 * Prefix marking a compressed localStorage value: this magic, then the
 * base64 of the DEFLATE-compressed JSON. A legacy uncompressed save is raw
 * JSON (starts with `{`), so the prefix check cleanly tells the two apart and
 * old saves keep loading — they re-write compressed on the next save.
 */
const STORE_MAGIC = "VCZ1:";

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
  hasSave(): boolean {
    return localStorage.getItem(AUTO_KEY) !== null;
  },
  load(): Simulation | null {
    const data = readSlot(AUTO_KEY);
    if (!data) return null;
    try {
      return Simulation.deserialize(data);
    } catch {
      return null;
    }
  },
  clear(): void {
    localStorage.removeItem(AUTO_KEY);
  },

  // ---- Named manual slots ----------------------------------------------
  saveSlot(n: number, sim: Simulation): void {
    this.saveTo(SLOT_KEY(n), sim);
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
    const slots: SlotInfo[] = [infoFrom("auto", AUTO_KEY)];
    for (let n = 1; n <= SLOT_COUNT; n++) slots.push(infoFrom(n, SLOT_KEY(n)));
    return slots;
  },

  // ---- Shared writer + export/import -----------------------------------
  saveTo(key: string, sim: Simulation): void {
    const data = sim.serialize() as SerializedGame & { savedAt: number };
    // Stamp save time without relying on a deterministic clock in the engine.
    data.savedAt = nowMs();
    // DEFLATE the JSON so four full-tower slots stay well under the ~5MB
    // localStorage quota (see STORE_MAGIC). Synchronous by design — this runs
    // just before a reload in the crash-recovery path, where an async write
    // could be lost. base64 keeps the value a safe ASCII string.
    const packed = STORE_MAGIC + toBase64(deflateSync(new TextEncoder().encode(JSON.stringify(data))));
    localStorage.setItem(key, packed);
  },

  /** Serialize the tower into the .vctower container (see TOWER_FILE_MAGIC). */
  async export(sim: Simulation): Promise<string> {
    if (!compressionSupported()) {
      throw new Error("This browser is too old to create tower files — try a current browser.");
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

  /** Parse a .vctower file. Raw-JSON exports from older builds still load. */
  async import(text: string): Promise<Simulation> {
    const trimmed = text.trim();
    // Match the whole VCTOWER family, not just this version's magic, so a file
    // from a newer build gets an honest "update the game" instead of falling
    // through to the JSON path and reporting gibberish as "not a tower file".
    const magic = /^VCTOWER(\d+)/.exec(trimmed);
    let data: SerializedGame;
    if (magic) {
      if (magic[0] !== TOWER_FILE_MAGIC) {
        throw new Error("This tower file was made by a newer version of Verticopolis — update the game to load it.");
      }
      // Distinguish "your browser can't decompress" from "this file is broken"
      // BEFORE the try below — otherwise a missing API blames a healthy file.
      if (!compressionSupported()) {
        throw new Error("This browser is too old to open compressed tower files — try a current browser.");
      }
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
    } else {
      try {
        data = JSON.parse(trimmed) as SerializedGame;
      } catch {
        throw new Error("Not a Verticopolis tower file.");
      }
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

// True when this browser can both compress and decompress raw deflate. Built
// by actually constructing the streams: the "deflate-raw" format string is
// newer than CompressionStream itself (Chrome had the API before the format),
// so a `typeof` check alone would pass on browsers that then throw at use.
function compressionSupported(): boolean {
  try {
    new CompressionStream("deflate-raw");
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
