import type { SerializedGame } from "../engine/types";
import { LegacyExportError } from "./tdtExportTables";
import { gatherTower } from "./tdtExportGather";
import { encodeTower } from "./tdtEncoder";
import { buildExportReport, type ExportReport } from "./tdtExportReport";

/**
 * Writer for original 1994 SimTower saves (`.TDT`): the importer's mirror.
 * Serializes a {@link SerializedGame} into the binary layout documented in
 * `docs/canon/tdt-format.md`, plus an honest {@link ExportReport} of what the
 * 1994 format can and cannot carry. Semantic tables the importer also owns
 * (tenant IDs, part families, hotel flags, rent classes, elevator kinds) live
 * in `tdtTables.ts` and are inverted in `tdtExportTables.ts`, so reader and
 * writer cannot drift apart on those.
 *
 * Self-consistency is enforced by tests: every exported buffer must parse
 * back through `parseTDT` with zero warnings and identical room state.
 *
 * This file is the entry point + barrel. `buildTDT` is a thin orchestrator over
 * three cohesive passes, each in its own sibling so every existing
 * `import { … } from "./tdtExport"` keeps working unchanged:
 *   - `tdtExportTables.ts`: the inverted tenant/part/rent tables + the DOS
 *     filename rule (`classFromRent`, `legacyFilename`, `LegacyExportError`).
 *   - `tdtExportGather.ts`: the room walk into per-floor records + paving.
 *   - `tdtByteWriter.ts` + `tdtEncoder.ts`: the binary emission.
 *   - `tdtExportReport.ts`: the reverse fidelity report.
 */

/** Result of a successful export build. */
export interface BuiltLegacyTower {
  bytes: Uint8Array;
  report: ExportReport;
}

/** `JSON.parse` reviver: an object's own `toString` key (never a function in
 *  JSON) makes every number or string conversion of that object throw a
 *  TypeError. Without it the object reads as NaN, as the engine's `js_number`
 *  reads any object. */
function withoutToString(_key: string, value: unknown): unknown {
  if (typeof value === "object" && value !== null && Object.prototype.hasOwnProperty.call(value, "toString")) {
    delete (value as { toString?: unknown }).toString;
  }
  return value;
}

/** The engine's JSON reader refuses this many nested arrays and objects,
 *  counting the root (serde_json's recursion limit). */
const MAX_DEPTH = 128;
/** `JSON.stringify` can throw before `depthRefusal` runs on very deep values. */
const STRINGIFY_PRECHECK_DEPTH = 2_048;
const RECURSION_REFUSAL = "save: recursion limit exceeded at line 1 column";

/** The engine's refusal for JSON text nested deeper than its reader allows,
 *  or `null` (#887). serde_json names the line and the 1-based UTF-8 byte
 *  column of the bracket that reaches the limit; `JSON.stringify` writes no
 *  raw line break, so the line is always 1. One pass over the text per
 *  export; the column is counted only on a refusal. */
function depthRefusal(text: string): string | null {
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 0x22) {
      // A string: skip to its closing quote, past every escape.
      for (i++; i < text.length; i++) {
        const d = text.charCodeAt(i);
        if (d === 0x5c) i++;
        else if (d === 0x22) break;
      }
    } else if (c === 0x5b || c === 0x7b) {
      if (++depth === MAX_DEPTH) return `${RECURSION_REFUSAL} ${utf8Length(text, i) + 1}`;
    } else if (c === 0x5d || c === 0x7d) {
      depth--;
    }

  }
  return null;
}

/** A stack-safe depth preflight over JSON-shaped values, used only to keep
 *  very deep forged input from crashing `JSON.stringify` before we can refuse
 *  it as the engine reader would. */
function exceedsDepth(value: unknown, limit: number): boolean {
  if (value === null || typeof value !== "object") return false;
  const seen = new WeakSet<object>();
  const stack: { value: object; depth: number }[] = [{ value, depth: 1 }];
  while (stack.length > 0) {
    const top = stack.pop()!;
    if (top.depth >= limit) return true;
    if (seen.has(top.value)) continue;
    seen.add(top.value);
    if (Array.isArray(top.value)) {
      for (const v of top.value) {
        if (v !== null && typeof v === "object") stack.push({ value: v as object, depth: top.depth + 1 });
      }
      continue;
    }
    for (const v of Object.values(top.value as Record<string, unknown>)) {
      if (v !== null && typeof v === "object") stack.push({ value: v as object, depth: top.depth + 1 });
    }
  }
  return false;
}

/** The UTF-8 length of `text`'s first `end` code units. A lone surrogate,
 *  which `JSON.stringify` escapes anyway, counts as U+FFFD's three bytes, as
 *  the binding encodes it. */
function utf8Length(text: string, end: number): number {
  let n = 0;
  for (let i = 0; i < end; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if ((c & 0xfc00) === 0xd800 && i + 1 < end && (text.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
      n += 4;
      i++;
    } else n += 3;
  }
  return n;
}

/**
 * Build the `.TDT` bytes plus the reverse fidelity report for a serialized
 * tower. Takes any JSON value. Throws {@link LegacyExportError} for towers the
 * format cannot hold (modern mode is refused earlier, in the UI flow, with its
 * own message) and for the forged shapes the Rust codec also refuses (`units`
 * or `transports` that is not an array, a unit kind outside the catalog), with
 * that codec's message, and for JSON nested 128 arrays and objects deep (the
 * root included), which the engine's reader refuses; every other JSON value
 * writes bytes. A value JSON cannot carry (a BigInt or a cycle) throws
 * `JSON.stringify`'s own error: the live save never holds one, and the
 * engine's exporter could not be handed it.
 */
export function buildTDT(save: SerializedGame): BuiltLegacyTower {
  if (exceedsDepth(save, STRINGIFY_PRECHECK_DEPTH)) {
    throw new LegacyExportError(`${RECURSION_REFUSAL} 1`);
  }
  // Read the tower as JSON carries it, the input the engine's exporter gets
  // across the binding (#887): NaN and Infinity become null, -0 becomes 0,
  // undefined fields drop and undefined array slots read null. One copy per
  // export, a menu action; the reviver runs only when the text needs it.
  const text = JSON.stringify(save) as string | undefined;
  const tooDeep = text === undefined ? null : depthRefusal(text);
  if (tooDeep !== null) throw new LegacyExportError(tooDeep);
  const reviver = text?.includes('"toString":') ? withoutToString : undefined;
  const input = (text === undefined ? null : JSON.parse(text, reviver)) as SerializedGame;
  if (input?.mode === "modern") {
    throw new LegacyExportError(
      "This tower uses Modern rules. SimTower (1994) can only load Classic towers.",
    );
  }
  const gathered = gatherTower(input);
  const { bytes, stats } = encodeTower(input, gathered);
  const report = buildExportReport(input, gathered, stats);
  return { bytes, report };
}

// ---- Barrel: preserve the original public surface of this module. ----
export { LegacyExportError, classFromRent, legacyFilename } from "./tdtExportTables";
export type { ExportReport } from "./tdtExportReport";
