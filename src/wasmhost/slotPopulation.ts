import type { WasmModule } from "../dualrun/binding";
import type { SlotPopulationReader } from "../storage/slotCensus";

/** How many saves' counts the reader remembers. The dialogs list the autosave
 *  and the manual slots on every open; the memo holds more than those so a
 *  save that was replaced does not push the others out at once. */
export const SLOT_MEMO_ENTRIES = 16;

/** A 53-bit hash of `text` (cyrb53), cheap beside loading a tower. */
function hashText(text: string): number {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/**
 * A reader that loads each save into a short-lived engine, reads the engine's
 * population and frees it. A save already read comes from the memo, keyed by
 * the text's length and hash, so reopening the Saves dialog does not load every
 * tower again (the engine's memory only grows, and it is the memory the live
 * tower runs in). A refused save is not remembered: it throws every time.
 */
export function populationReaderFromModule(mod: Pick<WasmModule, "Engine">): SlotPopulationReader {
  const memo = new Map<string, number>();
  return (text) => {
    const key = `${text.length}:${hashText(text)}`;
    const known = memo.get(key);
    if (known !== undefined) {
      memo.delete(key); // most recently used goes last
      memo.set(key, known);
      return known;
    }
    const engine = mod.Engine.fromSave(text);
    let population: number;
    try {
      const stats = JSON.parse(engine.towerStats()) as { population: unknown };
      if (typeof stats.population !== "number" || !Number.isFinite(stats.population)) throw new Error("The engine reported no population.");
      population = stats.population;
    } finally {
      engine.free();
    }
    memo.set(key, population);
    if (memo.size > SLOT_MEMO_ENTRIES) {
      const oldest = memo.keys().next();
      if (!oldest.done) memo.delete(oldest.value);
    }
    return population;
  };
}
