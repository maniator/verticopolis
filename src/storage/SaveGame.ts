import { Simulation } from "../engine/Simulation";
import type { SerializedGame } from "../engine/types";

/**
 * Persistence. Games are stored in localStorage: one auto-save slot plus a
 * handful of named manual slots, so the player can keep multiple towers. Also
 * supports export/import of Verticopolis tower files (.vctower) for sharing
 * or backups.
 *
 * (localStorage suffices for a single save object well under its ~5MB quota.
 * IndexedDB would only be needed for very large numbers of saves; see the
 * project notes for the v2 path.)
 */

const AUTO_KEY = "simtower-clone-save";
const SLOT_KEY = (n: number) => `simtower-clone-slot-${n}`;
export const SLOT_COUNT = 3;

/**
 * The Verticopolis tower-file container (.vctower): a magic first line naming
 * the format and its version, then the base64-encoded save payload. The file
 * is deliberately NOT raw JSON — exports travel as downloads and come back
 * through the file picker, never through a copy-paste textarea, and the
 * encoding keeps casual hand-edits (the classic corrupted-save source) out.
 * Bumping the container format later means a new magic line (VCTOWER2), with
 * this one still accepted on import.
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
    return JSON.parse(raw) as SerializedGame;
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
    localStorage.setItem(key, JSON.stringify(data));
  },

  /** Serialize the tower into the .vctower container (see TOWER_FILE_MAGIC). */
  export(sim: Simulation): string {
    return TOWER_FILE_MAGIC + "\n" + toBase64(JSON.stringify(sim.serialize())) + "\n";
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
  import(text: string): Simulation {
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
      try {
        // Whitespace-tolerant: survives files re-wrapped by editors or mailers.
        data = JSON.parse(fromBase64(trimmed.slice(magic[0].length).replace(/\s+/g, ""))) as SerializedGame;
      } catch {
        // Bad base64, mangled UTF-8, or truncated JSON — the container was
        // recognized, so the file is OURS but broken. Say so.
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

// Base64 with explicit UTF-8 handling (tower names aren't Latin-1), chunked so
// String.fromCharCode never sees an argument list long enough to blow the stack.
function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

function fromBase64(b64: string): string {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  // fatal: a flipped byte inside a multi-byte character must fail the import
  // loudly, not silently half-load a tower with U+FFFD-mangled strings.
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

function nowMs(): number {
  // Date is unavailable in the deterministic engine, but the storage layer is
  // UI-side, so a wall-clock stamp here is fine.
  return typeof Date !== "undefined" ? Date.now() : 0;
}
