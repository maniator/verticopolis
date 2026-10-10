/**
 * The side runners and bookkeeping of the TDT differential test
 * (`src/tests/integration/conformanceWasmTdt.integration.test.ts`): one
 * input through the TypeScript codec and the Rust port, labeled the same way
 * on both sides, every divergence recorded (and dumped under
 * `VC_TDT_DIFF_OUT`), and the round trip a player's tower takes through
 * import, play and export on each engine.
 *
 * The divergence list and the tally are module state, shared by every test in
 * the one file that imports this helper (the integration test above). A
 * second consumer in the same worker would share them too, so add a factory
 * here before giving this module another importer.
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Simulation } from "../../engine/Simulation";
import { UNIT_CAP, assertSaneUnitCount } from "../../engine/sim/deserializeGuards";
import type { SerializedGame } from "../../engine/types";
import type { exportTdt, importTdt } from "../../dualrun/engine";
import { LegacyExportError, buildTDT } from "../../storage/tdtExport";
import { LegacyImportError, parseTdtBinary } from "../../storage/tdtFormat";
import { parseTDT } from "../../storage/tdtImport";
import { viaJson } from "../fixtures/tdtDifferentialInputs";
import { digest } from "./canonical";
import { wasm } from "./wasmEngine";

const OUT_DIR = process.env.VC_TDT_DIFF_OUT;

type RustTdt = { importTdt: typeof importTdt; exportTdt: typeof exportTdt };
const rust = (): RustTdt => wasm() as unknown as RustTdt;

// ---- One input through both sides ------------------------------------------

/** A parse both sides answered; `saveText` is the Rust side's JSON. */
type Parsed = { ok: true; key: string; save: unknown; warnings: string[]; saveText: string };
type Imported = Parsed | { ok: false; key: string };
type Exported = { ok: true; key: string; bytes: Uint8Array } | { ok: false; key: string };

const sha = (b: Uint8Array): string => createHash("sha256").update(b).digest("hex");

/** A trap leaves the one module instance undefined for every later call, so
 *  the run stops at the first one rather than report noise after it. */
function rethrowTrap(e: unknown): void {
  if (e instanceof WebAssembly.RuntimeError) throw new Error(`the Rust side trapped (a panic): ${e.message}`);
}
const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));
/** An error a side did not mean to throw is labeled with that side, so it
 *  never matches a real refusal from the other side, and two crashes never
 *  match each other either. */
const crash = (side: "Rust" | "TypeScript", e: unknown): string => `crash (${side} side) ${e instanceof Error ? e.name : typeof e}: ${message(e)}`;

/** The messages the wasm-bindgen glue (0.2.129) throws as a plain `Error`: a
 *  freed or null handle, a borrow clash, a move out of a borrowed value, a
 *  bad allocation, a dropped closure. They are matched whole, so a refusal
 *  that merely mentions one of these words is still a refusal. Anything else
 *  thrown as a plain `Error` is the binding's `JsError`, which is how every
 *  refusal crosses. A trap arrives as `WebAssembly.RuntimeError` and is
 *  handled before this check. */
const GLUE_ERROR =
  /^(?:null pointer passed to rust|recursive use of an object detected which would lead to\s+unsafe aliasing in rust|attempted to take ownership of Rust value while it was borrowed|invalid malloc request|closure invoked recursively or after being dropped)$/;

/** The Rust side's label for a throw: a refusal only when it is the
 *  binding's own error; a TypeError, a glue error or anything else is a
 *  crash, so a binding failure cannot pass as a refusal. */
function rustFailure(e: unknown): string {
  rethrowTrap(e);
  if (e instanceof Error && Object.getPrototypeOf(e) === Error.prototype && !GLUE_ERROR.test(e.message)) return `refused: ${e.message}`;
  return crash("Rust", e);
}

/** The one deliberate refusal `Simulation.deserialize` throws (a plain
 *  `Error` from the unit-count guard), read from the guard itself so a
 *  rewording cannot drift from this test. */
const TS_LOAD_REFUSAL = ((): string => {
  try {
    assertSaneUnitCount(UNIT_CAP + 1);
  } catch (e) {
    return message(e);
  }
  throw new Error("assertSaneUnitCount no longer refuses past UNIT_CAP");
})();

function tsImport(bytes: Uint8Array, filename: string): Imported {
  try {
    const parsed = parseTDT(bytes.slice().buffer as ArrayBuffer, filename);
    // parseTDT folds the binary walk's warnings into the report's
    // `couldNotBring` among its own sentences and exposes no separate list,
    // so they are read from a second walk of the same bytes, which is
    // deterministic and the same walk parseTDT made.
    const warnings = [...parseTdtBinary(bytes).warnings];
    return { ok: true, key: `ok ${digest(parsed.save)} ${JSON.stringify(warnings)}`, save: parsed.save, warnings, saveText: "" };
  } catch (e) {
    return { ok: false, key: e instanceof LegacyImportError ? `refused: ${e.message}` : crash("TypeScript", e) };
  }
}

/** The binding's reply is parsed inside the guard, so a reply that is not
 *  the `{ save, warnings }` JSON it promises is a Rust-side crash. */
function rustImport(bytes: Uint8Array, filename: string): Imported {
  try {
    const v = JSON.parse(rust().importTdt(bytes.slice(), filename)) as { save?: unknown; warnings?: unknown };
    if (v === null || typeof v !== "object" || !("save" in v) || !Array.isArray(v.warnings) || !v.warnings.every((w) => typeof w === "string")) {
      throw new TypeError("importTdt replied without a save and a warnings list");
    }
    const warnings = v.warnings as string[];
    return { ok: true, key: `ok ${digest(v.save)} ${JSON.stringify(warnings)}`, save: v.save, warnings, saveText: JSON.stringify(v.save) };
  } catch (e) {
    return { ok: false, key: rustFailure(e) };
  }
}

export function tsExport(save: unknown): Exported {
  try {
    const bytes = buildTDT(save as SerializedGame).bytes;
    return { ok: true, key: `ok ${sha(bytes)}`, bytes };
  } catch (e) {
    return { ok: false, key: e instanceof LegacyExportError ? `refused: ${e.message}` : crash("TypeScript", e) };
  }
}

function rustExport(json: string): Exported {
  try {
    const bytes = rust().exportTdt(json);
    return { ok: true, key: `ok ${sha(bytes)}`, bytes };
  } catch (e) {
    return { ok: false, key: rustFailure(e) };
  }
}

// ---- Bookkeeping -----------------------------------------------------------

export interface Divergence {
  id: string;
  stage: string;
  ts: string;
  rust: string;
  detail?: string;
}
export const divergences: Divergence[] = [];
export const tally = new Map<string, number>();
export const count = (what: string) => tally.set(what, (tally.get(what) ?? 0) + 1);
export const counted = (what: string): number => tally.get(what) ?? 0;

/** The first path where two JSON values part, for the report. */
function firstDiff(a: unknown, b: unknown, path = "$"): string | null {
  if (Object.is(a, b)) return null;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null || Array.isArray(a) !== Array.isArray(b)) {
    return `${path}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`;
  }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of [...keys].sort()) {
    const d = firstDiff((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}.${k}`);
    if (d) return d;
  }
  return null;
}

/** `JSON.stringify` with NaN, Infinity and -Infinity kept as
 *  `{"$nonFinite": "NaN"}` (and so on), so a dump of the in-memory object the
 *  TypeScript exporter took still holds them. `Number(v.$nonFinite)` turns a
 *  tag back into the number; see {@link reviveNonFinite}. */
export const stringifyNonFinite = (v: unknown): string =>
  JSON.stringify(v, (_k, x: unknown) => (typeof x === "number" && !Number.isFinite(x) ? { $nonFinite: String(x) } : x), 1);

/** The reviver that undoes {@link stringifyNonFinite}. */
export const reviveNonFinite = (_k: string, x: unknown): unknown =>
  x !== null && typeof x === "object" && "$nonFinite" in x && Object.keys(x).length === 1 ? Number((x as { $nonFinite: string }).$nonFinite) : x;

/** Write a divergence's input under `VC_TDT_DIFF_OUT`, with a sidecar that
 *  keeps the original id and, for an import, the filename it was given (the
 *  tower name comes from it, so a filename-dependent divergence needs it).
 *  The base name is the sanitized id plus a short hash of the full id, so two
 *  ids that sanitize alike never overwrite each other. `extra` adds files
 *  beside the input (the TypeScript side's own input for an export). */
function dump(d: Divergence, ext: string, data: Uint8Array | string, filename?: string, extra: Record<string, string> = {}): void {
  if (!OUT_DIR) return;
  mkdirSync(OUT_DIR, { recursive: true });
  const base = `${d.id.replace(/[^A-Za-z0-9_.-]/g, "_")}-${createHash("sha256").update(d.id).digest("hex").slice(0, 8)}`;
  writeFileSync(resolve(OUT_DIR, `${base}.${ext}`), data);
  for (const [suffix, text] of Object.entries(extra)) writeFileSync(resolve(OUT_DIR, `${base}.${suffix}`), text);
  writeFileSync(resolve(OUT_DIR, `${base}.meta.json`), JSON.stringify({ ...d, filename }, null, 1));
}

/** Import on both sides; a divergence is recorded, and the agreed result (or
 *  null when they part or both refuse) is returned. */
export function diffImport(id: string, bytes: Uint8Array, filename: string): { ts: Parsed; rust: Parsed } | null {
  count("import");
  const t = tsImport(bytes, filename);
  const r = rustImport(bytes, filename);
  if (t.key === r.key) {
    count(t.ok ? "import-both-parsed" : "import-both-refused");
    if (t.ok) count(`warnings-${Math.min(t.warnings.length, 3)}`);
    return t.ok && r.ok ? { ts: t, rust: r } : null;
  }
  let detail: string | undefined;
  if (t.ok && r.ok) {
    const sameSorted = JSON.stringify([...t.warnings].sort()) === JSON.stringify([...r.warnings].sort());
    if (digest(t.save) !== digest(r.save)) detail = firstDiff(JSON.parse(JSON.stringify(t.save)), r.save) ?? "digest differs";
    else detail = sameSorted ? "warnings differ in order only" : "warnings differ";
  }
  const d: Divergence = { id, stage: "import", ts: t.key, rust: r.key, detail };
  divergences.push(d);
  dump(d, "tdt", bytes, filename);
  return null;
}

/** Export on both sides: `tsInput` is what the TypeScript exporter receives,
 *  `rustInput` the JSON text the Rust exporter receives. */
export function diffExport(id: string, tsInput: unknown, rustInput: string, tsJsonForm?: unknown): Uint8Array | null {
  count("export");
  const t = tsExport(tsInput);
  const r = rustExport(rustInput);
  if (t.key === r.key) {
    count(t.ok ? "export-both-wrote" : "export-both-refused");
    return t.ok ? t.bytes : null;
  }
  let detail: string | undefined;
  if (t.ok && r.ok) {
    const n = Math.min(t.bytes.length, r.bytes.length);
    let at = 0;
    while (at < n && t.bytes[at] === r.bytes[at]) at++;
    detail = `lengths ${t.bytes.length} vs ${r.bytes.length}, first differing byte at 0x${at.toString(16)}`;
  }
  if (tsJsonForm !== undefined) {
    const j = tsExport(tsJsonForm);
    detail = `${detail ?? ""}; TypeScript on the JSON form ${j.key === r.key ? "matches Rust" : `also differs (${j.key})`}`;
  }
  const d: Divergence = { id, stage: "export", ts: t.key, rust: r.key, detail };
  divergences.push(d);
  dump(d, "input.json", rustInput, undefined, { "ts-input.json": stringifyNonFinite(tsInput) });
  return null;
}

/** One engine's load and serialize: the serialized game (with its JSON text
 *  on the Rust side), or the labeled refusal or crash. */
export type Loaded = { ok: true; save: unknown; text: string } | { ok: false; key: string };

/** Load a save on the Rust engine and serialize it back, freeing the engine
 *  whatever happens. After a failure the engine is freed quietly, so the
 *  first error (a trap's message above all) is the one reported; after a
 *  clean load a `free()` that throws is reported itself. */
export function rustLoadSerialize(text: string): Loaded {
  let eng: ReturnType<ReturnType<typeof wasm>["Engine"]["fromSave"]> | undefined;
  let result: Loaded;
  try {
    eng = wasm().Engine.fromSave(text);
    const out = eng.serialize();
    result = { ok: true, save: JSON.parse(out) as unknown, text: out };
  } catch (e) {
    try {
      eng?.free();
    } catch {
      // Keep the first error.
    }
    return { ok: false, key: rustFailure(e) };
  }
  eng.free();
  return result;
}

/** The same on the TypeScript engine, which takes the save as an object. */
export function tsLoadSerialize(save: unknown): Loaded {
  try {
    const out = Simulation.deserialize(viaJson(save) as SerializedGame).serialize();
    return { ok: true, save: out, text: JSON.stringify(out) };
  } catch (e) {
    return { ok: false, key: message(e) === TS_LOAD_REFUSAL ? `refused: ${message(e)}` : crash("TypeScript", e) };
  }
}

/**
 * Compare the two engines' load and serialize of one save. Both loading and
 * serializing alike is agreement; both refusing is agreement too (counted as
 * `engineLoad-both-refused`; the two loaders word their refusals differently,
 * so only the kind is compared). One side refusing or either side crashing is
 * a load divergence. Only a pair that both loaded comes back, so a refusal is
 * never handed to an exporter as a save. A pair that loaded but serialized
 * differently is recorded and still comes back, so the export step runs.
 */
export function diffLoad(id: string, t: Loaded, r: Loaded, input: string): { ts: Extract<Loaded, { ok: true }>; rust: Extract<Loaded, { ok: true }> } | null {
  count("engineLoad");
  if (t.ok && r.ok) {
    count("engineLoad-both-loaded");
    const ts = viaJson(t.save);
    if (digest(ts) !== digest(r.save)) {
      const d: Divergence = { id, stage: "load+serialize", ts: digest(ts), rust: digest(r.save), detail: firstDiff(ts, r.save) ?? undefined };
      divergences.push(d);
      dump(d, "input.json", input);
    }
    return { ts: t, rust: r };
  }
  if (!t.ok && !r.ok && t.key.startsWith("refused: ") && r.key.startsWith("refused: ")) {
    count("engineLoad-both-refused");
    return null;
  }
  const d: Divergence = { id, stage: "load", ts: t.ok ? "loaded" : t.key, rust: r.ok ? "loaded" : r.key };
  divergences.push(d);
  dump(d, "input.json", input);
  return null;
}

/**
 * Export, import the bytes, export again, then load the imported save into
 * each engine, serialize it there and export that: the path a player's tower
 * takes through import, play and export, on each engine.
 */
export function roundTrip(id: string, save: unknown, filename = "TOWER.TDT"): void {
  count("roundTrip");
  const json = JSON.stringify(save);
  const first = diffExport(`${id}/export`, viaJson(save), json);
  if (!first) return;
  const back = diffImport(`${id}/import`, first, filename);
  if (!back) return;
  diffExport(`${id}/re-export`, back.ts.save, back.rust.saveText);
  // Each engine loads the imported game the way the import flow does and
  // serializes it back, then exports its own serialization (skipped when a
  // load fails, which diffLoad records).
  const loaded = diffLoad(`${id}/engine-load`, tsLoadSerialize(back.ts.save), rustLoadSerialize(back.rust.saveText), back.rust.saveText);
  if (loaded) diffExport(`${id}/engine-export`, loaded.ts.save, loaded.rust.text);
}
