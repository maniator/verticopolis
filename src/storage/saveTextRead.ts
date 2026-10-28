import type { SaveText } from "./SaveGame";
import { parseSaveJson } from "./saveCompression";

/**
 * Reads of a save's text that spare the whole-tower parse: the engine parses
 * a save it loads, so a load parses once, there. Each read here is a scan of
 * the text, and a parse happens only on a path that is already failing (or a
 * save whose surrogates need repair).
 */

/** Only text holding a surrogate (escaped, or raw) can need repair. */
const SURROGATE = /\\u[dD][89a-fA-F]|[\uD800-\uDFFF]/;

/** The text an engine loads a save from: the text itself, or, when its
 *  surrogates need repair, the repaired save (`parseSaveJson`) printed again,
 *  so both engines read the save the same way. Throws on text that is no JSON
 *  only in that repair. */
export function engineSaveText(text: string): SaveText {
  return SURROGATE.test(text) ? JSON.stringify(parseSaveJson(text)) : text;
}

const SAVED_AT = '"savedAt":';
const NUMBER = /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/;

/** The write stamp's time as the save's text holds it, or undefined when the
 *  text carries none as the writers print it. A `"savedAt":` outside a string
 *  can only be a key, and a later key wins, as in a parse. */
export function readSavedAt(text: SaveText): number | undefined {
  const at = text.lastIndexOf(SAVED_AT);
  if (at < 0) return undefined;
  const m = NUMBER.exec(text.slice(at + SAVED_AT.length, at + SAVED_AT.length + 32));
  return m ? Number(m[0]) : undefined;
}

const DAMAGED = "This tower file is damaged and can't be read.";
const NOT_A_TOWER = "Not a valid tower save file.";

/** Whether the text holds a tower's clock and units as the writers print
 *  them; a text that does not is checked by {@link importObjection}. */
export function looksLikeTowerSave(text: SaveText): boolean {
  return /"minutes":-?\d/.test(text) && text.includes('"units":[');
}

/** What the import's checks hold against a save's text, in the player's
 *  words, or undefined when they hold nothing: text that is no JSON is
 *  damaged, and a save without a numeric clock and a units list is no tower
 *  save. Parses the text, so it runs only where an import is failing or the
 *  text scan was unsure. */
export function importObjection(text: SaveText): string | undefined {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return DAMAGED;
  }
  const save = data as { minutes?: unknown; units?: unknown } | null;
  if (typeof save !== "object" || save === null || typeof save.minutes !== "number" || !Array.isArray(save.units)) return NOT_A_TOWER;
  return undefined;
}
