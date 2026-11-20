import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  CONFORMANCE_DIR,
  firstDivergence,
  loadScenario,
  runScenario,
  type Checkpoint,
  type EngineStart,
} from "../conformance/scenario";
import { hasWasmPackage, startWasmEngine, startWasmHandle, wasm, wasmEngine } from "../conformance/wasmEngine";
import { CATALOG_VERSION, readCatalog } from "@verticopolis/components/binding/catalog";
import { catalogLockView } from "../conformance/catalogLockView";
import { canonicalJson, digest } from "../conformance/canonical";
import { done } from "../engineFixtures/engineSubject.fixture";
import { writeAfterPassingRun, writeGoldenFile } from "../goldens/updateGate";

/**
 * Engine conformance suite: every scenario of the installed
 * `@verticopolis/engine/conformance` runs on the installed engine through the
 * WASM binding in Node and must reproduce that package's checkpoint hashes
 * (`expected.json`) and catalog digests (`catalog-digests.json`) exactly, so
 * the engine the game pins is the one the lock describes. The lock is written
 * in Verticopolis/engine, which owns it, so `VC_CONFORMANCE_UPDATE=1` refuses
 * to run here. The binding is the installed `@verticopolis/engine/tooling`;
 * without it the suite skips.
 */

const SCENARIO_DIR = resolve(CONFORMANCE_DIR, "scenarios");
const LOCK = resolve(CONFORMANCE_DIR, "expected.json");
const CATALOG_LOCK = resolve(CONFORMANCE_DIR, "catalog-digests.json");
const CATALOG_MODES = ["classic", "modern"] as const;
const UPDATE = process.env.VC_CONFORMANCE_UPDATE === "1";
if (UPDATE && process.env.CI)
  throw new Error("VC_CONFORMANCE_UPDATE is a local regeneration switch and never runs in CI");
if (UPDATE)
  throw new Error(
    "the conformance lock lives in Verticopolis/engine; regenerate it there (VC_CONFORMANCE_UPDATE=1 in that repository)",
  );

type Lock = { scenarios: Record<string, Checkpoint[]> };

const lock: Lock = existsSync(LOCK) ? (JSON.parse(readFileSync(LOCK, "utf8")) as Lock) : { scenarios: {} };
const files = readdirSync(SCENARIO_DIR)
  .filter((f) => f.endsWith(".json"))
  .sort();
const fresh: Lock = { scenarios: {} };
/** A scenario's pinned checkpoints: the lock's, or during an update the ones
 *  this run produced, so the checks after the scenario loop hold the new lock. */
const pinned = (id: string): Checkpoint[] | undefined => (UPDATE ? fresh.scenarios[id] : lock.scenarios[id]);

function writeLock(l: Lock): void {
  const ids = Object.keys(l.scenarios).sort();
  const body = ids.map((id) => {
    const rows = l.scenarios[id]
      .map((c) => `      ${JSON.stringify({ label: c.label, state: c.state, crowd: c.crowd, events: c.events })}`)
      .join(",\n");
    return `    ${JSON.stringify(id)}: [\n${rows}\n    ]`;
  });
  writeGoldenFile(LOCK, `{\n  "scenarios": {\n${body.join(",\n")}\n  }\n}\n`);
}

if (UPDATE && !hasWasmPackage())
  throw new Error("VC_CONFORMANCE_UPDATE=1 writes the lock from the Rust engine; run npm install first");

// An update writes the lock only from a run in which every test in this file
// ran and passed, so a filtered (`-t`) or failing run never leaves a partial
// lock behind, and says so.
writeAfterPassingRun(
  "conformance lock",
  UPDATE,
  () => files.map((f) => f.replace(/\.json$/, "")).filter((id) => !fresh.scenarios[id]),
  () => writeLock(fresh),
);

type CatalogLock = { catalogs: Record<string, string> };
const catalogLock = JSON.parse(readFileSync(CATALOG_LOCK, "utf8")) as CatalogLock;
const freshCatalogs: CatalogLock = { catalogs: {} };
writeAfterPassingRun(
  "catalog lock",
  UPDATE,
  () => CATALOG_MODES.filter((mode) => !freshCatalogs.catalogs[mode]),
  () =>
    writeGoldenFile(
      CATALOG_LOCK,
      `${JSON.stringify({ catalogs: Object.fromEntries(CATALOG_MODES.map((m) => [m, freshCatalogs.catalogs[m]])) }, null, 2)}\n`,
    ),
);

describe.skipIf(!hasWasmPackage())("engine conformance through the WASM binding", () => {
  it("has a scenario for every lock entry and a unique id per file", () => {
    const ids = files.map((f) => loadScenario(resolve(SCENARIO_DIR, f)).id);
    expect(ids).toEqual(files.map((f) => f.replace(/\.json$/, "")));
    if (!UPDATE) expect(Object.keys(lock.scenarios).sort()).toEqual([...ids].sort());
  });

  for (const file of files) {
    const scenario = loadScenario(resolve(SCENARIO_DIR, file));
    it(`${scenario.id} matches its pinned checkpoints`, () => {
      const got = runScenario(scenario, startWasmEngine);
      if (UPDATE) {
        fresh.scenarios[scenario.id] = got;
        return;
      }
      const want = lock.scenarios[scenario.id];
      if (!want) throw new Error(`${scenario.id} is not in the lock; regenerate it with VC_CONFORMANCE_UPDATE=1`);
      // Report the first divergent checkpoint, the useful fact for a port.
      expect(firstDivergence(got, want)).toBeNull();
    }, 60_000);
  }

  it("runs a new game and a loaded save the same way twice in one process", () => {
    for (const id of ["starter-classic", "fixture-split-tower"]) {
      const s = loadScenario(resolve(SCENARIO_DIR, `${id}.json`));
      expect(runScenario(s, startWasmEngine)).toEqual(runScenario(s, startWasmEngine));
    }
  }, 60_000);

  // The emergency dialog answers through the port's `answerChoice`. The runner
  // answers through `resolveChoice`, so the two scenarios that answer a choice
  // run again with the answer given through the port, and must land on the
  // same checkpoints.
  for (const id of ["fire-rescue-paid-modern", "ransom-paid-modern"]) {
    it(`${id} matches its pinned checkpoints when answered through answerChoice`, () => {
      const scenario = loadScenario(resolve(SCENARIO_DIR, `${id}.json`));
      const answers = scenario.commands.filter((c) => c.op === "resolveChoice").length;
      expect(answers, `${id} no longer answers a choice`).toBeGreaterThan(0);
      expect(
        scenario.commands.some((c) => c.op === "reload"),
        `${id} reloads, which would drop the override`,
      ).toBe(false);
      let answered = 0;
      const throughPort: EngineStart = (start) => {
        const handle = startWasmHandle(start);
        const resolveChoice = (accept: boolean): void => {
          answered++;
          expect(done(handle.answerChoice(accept)), `answerChoice(${accept}): ${handle.lastReason()}`).toBe(true);
        };
        return { ...wasmEngine(handle), resolveChoice };
      };
      const want = pinned(id);
      if (!want) throw new Error(`${id} is not in the lock; regenerate it with VC_CONFORMANCE_UPDATE=1`);
      expect(firstDivergence(runScenario(scenario, throughPort), want)).toBeNull();
      expect(answered, `${id}: every answer went through answerChoice`).toBe(answers);
    }, 60_000);
  }

  // The catalog the binding hands a frontend is the one the lock pins, and its
  // text is the canonical form the lock hashes. The Rust catalog is the only
  // source: the lock is written from it, never from a TypeScript table. The
  // lock view leaves out the wedding hall's footprint, so it is pinned here.
  for (const mode of CATALOG_MODES) {
    it(`catalog(${mode}) is canonical and matches the lock`, () => {
      const { catalog } = wasm();
      if (typeof catalog !== "function") throw new Error("the WASM package predates catalog(mode); run npm install");
      const text = catalog(mode);
      const got = readCatalog(wasm(), mode);
      expect(canonicalJson(catalogLockView(JSON.parse(text)))).toBe(canonicalJson(catalogLockView(got)));
      const hash = digest(catalogLockView(got));
      if (UPDATE) freshCatalogs.catalogs[mode] = hash;
      else expect(hash).toBe(catalogLock.catalogs[mode]);
      const hall = got.facilities.find((f) => f.key === "weddingHall");
      expect(hall).toMatchObject({ width: 28, floors: 5 });
    });
  }

  it("refuses a catalog for an unknown mode, or of a shape version it does not read", () => {
    expect(() => readCatalog(wasm(), "arcade" as "classic")).toThrow(/classic or modern/);
    expect(() => readCatalog(wasm(), "classic", CATALOG_VERSION + 1)).toThrow(/expected version/);
  });

  // Each refusal must surface as the binding's own error with its message; a
  // Rust panic would trap (a RuntimeError) and poison the one module instance
  // for every scenario after it.
  it("refuses a scenario start it cannot honor with an error that leaves the module usable", () => {
    expect(() => startWasmEngine({ newGame: { seed: 1, mode: "arcade" as "classic" } })).toThrow(/classic or modern/);
    expect(() => startWasmEngine({ fixture: "node_modules/@verticopolis/engine/conformance/README.md" })).toThrow(
      /not a VCTOWER1 file/,
    );
    expect(() =>
      startWasmEngine({
        fixture: "node_modules/@verticopolis/engine/conformance/fixtures/sixseven-december.vctower",
        mode: "arcade" as "classic",
      }),
    ).toThrow(/classic or modern/);
    // The module still answers after the refusals: a fresh game founds and
    // hashes the same as the lock's starter.
    const want = pinned("starter-classic")?.[0];
    if (!want) throw new Error("starter-classic is not in the lock; regenerate it with VC_CONFORMANCE_UPDATE=1");
    const fresh = startWasmEngine(loadScenario(resolve(SCENARIO_DIR, "starter-classic.json")).start);
    try {
      expect(fresh.stateDigest()).toBe(want.state);
    } finally {
      fresh.free?.();
    }
  });
});
