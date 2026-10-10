/**
 * TDT differential test: the TypeScript codec (`parseTDT`, `buildTDT`) and the
 * Rust port (`importTdt`, `exportTdt` through the WASM binding) run on the same
 * inputs and must answer the same. An import is compared as the canonical
 * digest of the serialized game plus the binary walk's warnings IN ORDER (the
 * lock in `conformance/tdt-cases.json` sorts them; this test does not), or as
 * the exact refusal message. An export is compared as the SHA-256 of the bytes,
 * or as the exact refusal message. A throw that is not a side's deliberate
 * refusal is labeled with its side (`crash (Rust side) TypeError: ...`,
 * `crash (TypeScript side) TypeError: ...`), so it never matches a refusal
 * from the other side, and two crashes never match each other by design. The
 * engine-load step compares the two engines' load and serialize: both refusing
 * is agreement (`engineLoad-both-refused`), one refusing is a load divergence,
 * and the export after it runs only when both loaded. The side runners and the
 * bookkeeping live in `../conformance/tdtDifferential.ts`, the input builders
 * in `../fixtures/tdtDifferentialInputs.ts`. The counts a default and a
 * full-scale run produce are recorded once, in the story's review record
 * (`_bmad-output/implementation-artifacts/story-engine-tdt-port.md`).
 *
 * Inputs, all generated from seeded Mulberry32 streams (`engine/rng.ts`):
 *   - round trips: every `.vctower` fixture, the lock's export saves, the edge
 *     saves and the seeded towers go export, import, export again, then
 *     through each engine's own load and serialize and export once more;
 *   - seeded towers built and run by the TypeScript engine, both modes;
 *   - edge saves (empty tower, money extremes, odd names, missing keys);
 *   - the live host's export path: the TypeScript exporter takes the save
 *     object as it sits in memory (NaN and Infinity included) while the Rust
 *     exporter takes the JSON text `JSON.stringify` makes of it;
 *   - forged values (strings, booleans, arrays, objects) in numeric fields;
 *   - mutation fuzz over every valid `.TDT` the round trips start from plus
 *     the lock's synthetic import files: byte flips, truncation, inserted
 *     junk, deleted ranges, u16 and u32 extremes on structural fields, swapped
 *     records.
 *
 * Every test draws from its own stream, seeded from the root seed and the
 * test's name, and the towers and the mutation corpus are built on first use
 * from streams of their own. Running one test alone (`-t`) therefore sees the
 * same inputs and the same divergence ids as a full run.
 *
 * Switches:
 *   - `VC_TDT_DIFF_N` sets the number of mutation cases (default 240, at
 *     least 1; 0 or a negative is an error) and the mutation test's timeout
 *     with it. It also scales the seeded towers
 *     (`max(3, ceil(N / 400))` per mode) and the units the NaN and forged
 *     sweeps visit (`max(4, ceil(N / 200))`), and above 240 it widens the
 *     forged sweep from 2 drawn values per field on the sample save to all 22
 *     `FORGED` values on two bases (the sample and the first Classic tower).
 *   - `VC_TDT_DIFF_SEED` moves the root seed.
 *   - `VC_TDT_DIFF_OUT` names a directory that receives every divergence's
 *     input (`<base>.tdt` for an import, `<base>.input.json` for an export or
 *     a load) with a `<base>.meta.json` sidecar holding the original id, the
 *     filename an import was given, and both answers, for minimizing by hand.
 *     `<base>` is the id with unsafe characters replaced plus the first 8 hex
 *     digits of the id's SHA-256, so distinct ids never share a file. An
 *     export also writes `<base>.ts-input.json`, the object the TypeScript
 *     exporter took, with NaN, Infinity and -Infinity tagged as
 *     `{"$nonFinite": "NaN"}` (and so on): `input.json` is the Rust side's
 *     JSON text, where they are already null, so only the tagged file
 *     reproduces the live pairing. Read it back with
 *     `JSON.parse(text, reviveNonFinite)` (exported beside the runners).
 *   - `VC_TDT_DIFF_REPORT=1` prints the tally from the last test (vitest
 *     shows the output of a passing test with `--reporter=verbose`). Run
 *     alone with `-t "reports the tally"`, that test has nothing to report:
 *     it says so and skips its checks.
 *   - `VC_TDT_DIFF_KNOWN=1` adds the inputs the two sides are known to answer
 *     differently today, so a fix can be checked against them. They stay out
 *     of the default run until both sides agree: the edge saves in
 *     {@link KNOWN_DIVERGENT_EDGES}; in the NaN sweep, a unit's floor (skipped
 *     by default) and the live pairing, where the TypeScript exporter gets
 *     the in-memory object (by default both sides get the JSON form); in the
 *     forged sweep, a unit's floor, x and width (skipped by default, #884),
 *     and the sweep widens to all 22 values on two bases as under a raised N.
 */
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { RNG } from "../../engine/rng";
import type { SerializedGame } from "../../engine/types";
import { parseTDT } from "../../storage/tdtImport";
import { decodeVctower } from "../../storage/vctowerContainer";
import { count, counted, diffExport, diffImport, diffLoad, divergences, roundTrip, rustLoadSerialize, tally, tsExport, tsLoadSerialize } from "../conformance/tdtDifferential";
import { hasWasmPackage, wasmRequired } from "../conformance/wasmEngine";
import {
  FILENAMES,
  FORGED,
  edgeSaves,
  fieldsOf,
  fixtureSave,
  mutateOnce,
  numericPaths,
  seededTower,
  setPath,
  viaJson,
  type Fields,
} from "../fixtures/tdtDifferentialInputs";
import { exportInputs } from "../fixtures/tdtExportCases";
import { importInputs } from "../fixtures/tdtImportCases";

const REPO_ROOT = resolve(__dirname, "../../..");
const FIXTURES = resolve(__dirname, "../fixtures");

function envInt(name: string, fallback: number, min = 0): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min) throw new Error(`${name} must be a whole number of at least ${min}, got ${raw}`);
  return n;
}
const DEFAULT_MUTATIONS = 240;
const MUTATIONS = envInt("VC_TDT_DIFF_N", DEFAULT_MUTATIONS, 1);
const ROOT_SEED = envInt("VC_TDT_DIFF_SEED", 0x7d7);
/** Seeded towers per mode, and how many units the NaN and forged sweeps visit. */
const TOWERS = Math.max(3, Math.ceil(MUTATIONS / 400));
const NAN_UNITS = Math.max(4, Math.ceil(MUTATIONS / 200));
const KNOWN = process.env.VC_TDT_DIFF_KNOWN === "1";
/** The forged sweep's wide form: every value on two bases. */
const FORGED_WIDE = KNOWN || MUTATIONS > DEFAULT_MUTATIONS;
/** A generous budget for building and playing one seeded tower (the default
 *  run builds six in a few seconds). */
const TOWER_BUDGET = 30_000;
/** The default run's 240 mutations take seconds; the budget keeps a wide
 *  margin and grows with a raised `VC_TDT_DIFF_N`. It also covers building
 *  the corpus, which builds every seeded tower when the mutation test runs
 *  alone with `-t`. */
const MUTATION_TIMEOUT = Math.max(300_000, MUTATIONS * 250) + TOWERS * 2 * TOWER_BUDGET;
/** The towers test round-trips every seeded tower, so its budget grows with
 *  them. */
const TOWERS_TIMEOUT = Math.max(600_000, TOWERS * 2 * TOWER_BUDGET * 2);
/** Below this many mutations the mutation test skips its "something parsed
 *  and exported" checks: a handful of draws can all land on structural
 *  fields and be refused, so the checks would fail by chance at, say, 3. Most
 *  draws parse (the story's review record has the default run's share), so
 *  at 50 or more a run where none parses means the harness is broken. */
const MUTATIONS_GUARDED = 50;

/**
 * Edge saves the two exporters answer differently today. A save with no
 * `towerName` loads on both engines, and then the TypeScript exporter throws
 * a TypeError (`legacyFilename` upper-cases undefined) where the Rust one
 * writes the file; a save whose `units` or `transports` is not an array is a
 * TypeError in TypeScript and a refusal in Rust.
 */
const KNOWN_DIVERGENT_EDGES = new Set(["no-name", "no-units", "no-transports", "units-null"]);

/** A stream of its own for each named consumer: FNV-1a over the root seed
 *  and the name, so no consumer's draws depend on which others ran first. */
function rngFor(name: string): RNG {
  let h = 0x811c9dc5;
  for (const ch of `${ROOT_SEED}:${name}`) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return new RNG(h);
}

/** Build a value on first use and keep it, so a test run alone with `-t`
 *  builds exactly what a full run builds. */
function memo<T>(build: () => T): () => T {
  let value: { v: T } | undefined;
  return () => (value ??= { v: build() }).v;
}

// ---- Inputs, built on first use ---------------------------------------------

type Case = { id: string; save: unknown; filename?: string };

const sampleBase = memo(() => (exportInputs().find(([id]) => id === "sample")![1] as { save: SerializedGame }).save);

const fixtureCases = memo((): (Case & { file: string })[] => {
  const out: (Case & { file: string })[] = [];
  for (const f of readdirSync(FIXTURES).filter((n) => n.endsWith(".vctower")).sort()) {
    const file = `src/tests/fixtures/${f}`;
    const save = fixtureSave(file);
    out.push({ id: `fixture-${f}`, save, filename: `${f.replace(/\.vctower$/, "").toUpperCase()}.TDT`, file });
  }
  return out;
});

/** A Modern save relabeled Classic puts its Modern rooms in front of the
 *  exporter (a Modern save is refused by both). */
const asClassic = (c: Case): Case[] => ((c.save as SerializedGame).mode === "modern" ? [{ id: `${c.id}-as-classic`, save: { ...viaJson(c.save as object), mode: "classic" } }] : []);

const lockCases = memo((): Case[] => {
  const saves = new Map<string, unknown>();
  const out: Case[] = [];
  for (const [id, entry] of exportInputs()) {
    const save = "save" in entry ? viaJson(entry.save) : { ...(saves.get(entry.base) as object), ...viaJson(entry.patch) };
    saves.set(id, save);
    out.push({ id: `lock-${id}`, save });
  }
  return out;
});

const edgeCases = memo((): Case[] => {
  const rng = rngFor("edge saves");
  const out: Case[] = [];
  for (const [id, save] of edgeSaves(sampleBase())) {
    const filename = rng.pick(FILENAMES);
    if (KNOWN || !KNOWN_DIVERGENT_EDGES.has(id)) out.push({ id: `edge-${id}`, save, filename });
  }
  return out;
});

/** `TOWERS` seeded towers per mode, in draw order. */
const towers = memo((): [string, SerializedGame][] => {
  const rng = rngFor("seeded towers");
  const out: [string, SerializedGame][] = [];
  for (let i = 0; i < TOWERS; i++) {
    for (const mode of ["classic", "modern"] as const) {
      const seed = rng.int(1, 2 ** 31);
      out.push([`tower-${mode}-${seed}`, seededTower(seed, mode)]);
    }
  }
  return out;
});
const towerCases = memo((): Case[] => towers().flatMap(([id, save]) => [{ id, save }, ...asClassic({ id, save })]));
const classicTowers = (n: number) => towers().filter(([id]) => id.startsWith("tower-classic")).slice(0, n);

/** Valid `.TDT` files the mutation fuzz starts from, with a filename each:
 *  the TypeScript export of every round-trip input and its re-export after
 *  an import, then the lock's synthetic import files. */
const corpus = memo((): { id: string; bytes: Uint8Array; filename: string }[] => {
  const out: { id: string; bytes: Uint8Array; filename: string }[] = [];
  const cases = [...fixtureCases().flatMap((c) => [c, ...asClassic(c)]), ...lockCases(), ...edgeCases(), ...towerCases()];
  for (const { id, save, filename = "TOWER.TDT" } of cases) {
    const first = tsExport(viaJson(save));
    if (!first.ok) continue;
    out.push({ id, bytes: first.bytes, filename });
    let back: unknown;
    try {
      back = parseTDT(first.bytes.slice().buffer as ArrayBuffer, filename).save;
    } catch {
      continue;
    }
    const second = tsExport(back);
    if (second.ok) out.push({ id: `${id}/re`, bytes: second.bytes, filename });
  }
  for (const [id, bytes, filename] of importInputs()) out.push({ id: `lock-${id}`, bytes, filename: filename ?? "TOWER.TDT" });
  return out;
});

// ---- The run ---------------------------------------------------------------

if (wasmRequired() && !hasWasmPackage()) throw new Error("VC_REQUIRE_WASM=1 but engine-rs/pkg/ is not built; run npm run wasm:build");

/** One test with its own stream: no divergence, and when `expectWrites` is
 *  set, at least one export both sides wrote (a run where every input is
 *  refused must not pass quietly). Every test passes it but the mutation
 *  test, whose inputs are not sure to parse; that test checks its own work
 *  when it draws enough of it. */
function diffIt(name: string, body: (rng: RNG) => void, timeout: number, expectWrites = true): void {
  it(
    name,
    () => {
      const mark = divergences.length;
      const wrote = counted("export-both-wrote");
      body(rngFor(name));
      expect(divergences.slice(mark)).toEqual([]);
      if (expectWrites) expect(counted("export-both-wrote")).toBeGreaterThan(wrote);
    },
    timeout,
  );
}

describe.skipIf(!hasWasmPackage())("TDT import and export, TypeScript against the Rust port", () => {
  diffIt(
    "round-trips every .vctower fixture identically",
    () => {
      for (const c of fixtureCases()) {
        roundTrip(c.id, c.save, c.filename);
        // The live path on each engine: load the fixture, serialize it there
        // and export that. The decoded fixture goes through both engines'
        // load and serialize here (c.save is the same TypeScript load, made
        // once by fixtureSave), and a load that fails on either side is
        // recorded rather than exported.
        const raw = decodeVctower(readFileSync(resolve(REPO_ROOT, c.file), "utf8"), c.file);
        const text = JSON.stringify(raw);
        const loaded = diffLoad(`${c.id}/own-load`, tsLoadSerialize(raw), rustLoadSerialize(text), text);
        if (loaded) diffExport(`${c.id}/own-load-export`, loaded.ts.save, loaded.rust.text);
        for (const k of asClassic(c)) roundTrip(k.id, k.save);
      }
    },
    120_000,
  );

  diffIt(
    "round-trips the lock's export saves identically",
    () => {
      for (const c of lockCases()) roundTrip(c.id, c.save);
    },
    120_000,
  );

  diffIt(
    "round-trips edge saves identically",
    () => {
      for (const c of edgeCases()) roundTrip(c.id, c.save, c.filename);
    },
    120_000,
  );

  diffIt(
    "round-trips seeded towers built and played by the TypeScript engine",
    () => {
      expect(towers().length).toBe(TOWERS * 2);
      for (const c of towerCases()) roundTrip(c.id, c.save);
    },
    TOWERS_TIMEOUT,
  );

  diffIt(
    "exports the same when the in-memory save holds NaN, Infinity or a huge clock",
    (rng) => {
      // The live host hands the TypeScript exporter the object and the Rust
      // exporter JSON text, where NaN and Infinity become null. The two answer
      // differently for a non-finite unit x, width, floor or rent and for
      // non-finite minutes: the TypeScript exporter reads NaN differently from
      // null. With VC_TDT_DIFF_KNOWN=1 that live pairing runs; by default both
      // sides get the JSON form, which they answer the same for every field but
      // a unit's floor (null floor: TypeScript paves a type-0 tenant under the
      // room and leaves the floor edges at 0, Rust writes the room alone with
      // its own edges), so unit floors are left out of the default sweep.
      const bases: [string, SerializedGame][] = [["sample", viaJson(sampleBase())], ...classicTowers(2)];
      for (const [baseId, base] of bases) {
        for (const path of numericPaths(base, rng, NAN_UNITS)) {
          if (!KNOWN && path[0] === "units" && path[2] === "floor") continue;
          for (const bad of [NaN, Infinity, -Infinity]) {
            const save = structuredClone(base);
            setPath(save, path, bad);
            if (KNOWN) diffExport(`nan-${baseId}-${path.join(".")}=${bad}`, save, JSON.stringify(save), viaJson(save));
            else diffExport(`nan-${baseId}-${path.join(".")}=${bad}`, viaJson(save), JSON.stringify(save));
          }
        }
        for (const m of [2 ** 31 * 1440, 2 ** 31 * 1440 + 1, 2 ** 31 * 1440 + 1440 * 5 + 61, 2 ** 32 * 1440 + 7, 2 ** 53 - 1, 1e300, -(2 ** 31) * 1440 - 1]) {
          const save = structuredClone(base);
          save.minutes = m;
          diffExport(`minutes-${baseId}-${m}`, save, JSON.stringify(save), viaJson(save));
        }
      }
    },
    600_000,
  );

  diffIt(
    "exports the same for forged values in numeric fields",
    (rng) => {
      // Strings, booleans, arrays and objects where a number belongs: a forged
      // `.vctower` can carry them. Both sides get the same JSON text. Every
      // field but a unit's floor, x and width is read the way JavaScript's
      // Number() or Number.isFinite() reads it on both sides, and those run
      // by default. A unit's floor, x and width are known to part (TypeScript
      // keeps them raw and adds a string to a number by concatenation, and a
      // null, boolean or array floor is placed differently; backlog #884), so
      // they run only under VC_TDT_DIFF_KNOWN=1. The default run tries two
      // drawn values per field on the sample save; the wide run (a raised
      // VC_TDT_DIFF_N or VC_TDT_DIFF_KNOWN=1) tries every value on two bases.
      const bases: [string, SerializedGame][] = [["sample", viaJson(sampleBase())]];
      if (FORGED_WIDE) bases.push(...classicTowers(1));
      for (const [baseId, base] of bases) {
        for (const path of numericPaths(base, rng, NAN_UNITS)) {
          if (!KNOWN && path[0] === "units" && (path[2] === "floor" || path[2] === "x" || path[2] === "width")) continue;
          const values = FORGED_WIDE ? FORGED : [rng.pick(FORGED), rng.pick(FORGED)];
          for (const bad of values) {
            const save = viaJson(base);
            setPath(save, path, bad);
            diffExport(`forged-${baseId}-${path.join(".")}=${JSON.stringify(bad)}`, viaJson(save), JSON.stringify(save));
          }
        }
      }
    },
    600_000,
  );

  diffIt(
    "imports seeded mutations of every valid file identically",
    (rng) => {
      const files = corpus();
      // The lock's own files go through once unmutated too.
      for (const [id, bytes, filename] of importInputs()) diffImport(`lock-import-${id}`, bytes, filename ?? "TOWER.TDT");
      const fields = new Map<string, Fields>();
      const parsed = counted("import-both-parsed");
      const wrote = counted("export-both-wrote");
      for (let i = 0; i < MUTATIONS; i++) {
        const base = rng.pick(files);
        let f = fields.get(base.id);
        if (!f) fields.set(base.id, (f = fieldsOf(base.bytes)));
        let bytes = base.bytes;
        const ops: string[] = [];
        const n = rng.chance(0.25) ? rng.int(2, 4) : 1;
        for (let k = 0; k < n; k++) {
          const [op, next] = mutateOnce(bytes, rng, k === 0 ? f : fieldsOf(bytes));
          ops.push(op);
          count(`op-${op}`);
          bytes = next;
        }
        const filename = rng.chance(0.8) ? base.filename : rng.pick(FILENAMES);
        const both = diffImport(`mut-${i}-${base.id}-${ops.join("+")}`, bytes, filename);
        if (both) {
          count("mutationImported");
          diffExport(`mut-${i}-${base.id}-${ops.join("+")}/export`, both.ts.save, both.rust.saveText);
        } else count("mutationRefused");
      }
      if (MUTATIONS >= MUTATIONS_GUARDED) {
        expect(counted("import-both-parsed")).toBeGreaterThan(parsed);
        expect(counted("export-both-wrote")).toBeGreaterThan(wrote);
      }
    },
    MUTATION_TIMEOUT,
    false,
  );

  it("reports the tally", (ctx) => {
    // A -t run that skips the import tests or the export tests leaves the
    // tally partial, so there is nothing whole to report or check.
    if (counted("import") === 0 || counted("export") === 0) {
      ctx.skip("the tally is partial because only some tests ran; run the whole file to report it");
      return;
    }
    if (process.env.VC_TDT_DIFF_REPORT === "1") {
      console.log(JSON.stringify({ mutations: MUTATIONS, towers: TOWERS * 2, corpus: corpus().length, tally: Object.fromEntries([...tally].sort()), divergences }, null, 1));
    }
    // Agreement must include real work on both paths: a run where every
    // export or every import is refused by both sides fails here.
    expect(counted("export-both-wrote")).toBeGreaterThan(0);
    expect(counted("import-both-parsed")).toBeGreaterThan(0);
  });
});
