import { afterAll, afterEach, describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { CONFORMANCE_DIR, firstDivergence, loadScenario, runScenario, type Checkpoint } from "../conformance/scenario";

/**
 * Engine conformance suite (conformance/README.md). Every scenario runs on the
 * TypeScript engine and must reproduce the checkpoint hashes in
 * conformance/expected.json exactly. Any engine change that moves a hash is a
 * simulation change: regenerate with `VC_CONFORMANCE_UPDATE=1 npx vitest run
 * --project integration conformance` and commit the new lock with intent.
 */

const SCENARIO_DIR = resolve(CONFORMANCE_DIR, "scenarios");
const LOCK = resolve(CONFORMANCE_DIR, "expected.json");
const UPDATE = process.env.VC_CONFORMANCE_UPDATE === "1";
if (UPDATE && process.env.CI) throw new Error("VC_CONFORMANCE_UPDATE is a local regeneration switch and never runs in CI");

type Lock = { scenarios: Record<string, Checkpoint[]> };

const files = readdirSync(SCENARIO_DIR).filter((f) => f.endsWith(".json")).sort();
const lock: Lock = existsSync(LOCK) ? (JSON.parse(readFileSync(LOCK, "utf8")) as Lock) : { scenarios: {} };
const fresh: Lock = { scenarios: {} };

function writeLock(l: Lock): void {
  const ids = Object.keys(l.scenarios).sort();
  const body = ids.map((id) => {
    const rows = l.scenarios[id].map((c) => `      ${JSON.stringify({ label: c.label, state: c.state, crowd: c.crowd })}`).join(",\n");
    return `    ${JSON.stringify(id)}: [\n${rows}\n    ]`;
  });
  writeFileSync(LOCK, `{\n  "scenarios": {\n${body.join(",\n")}\n  }\n}\n`);
}

describe("engine conformance", () => {
  // An update writes the lock only from a complete run, so a filtered or
  // failing run can never leave a partial lock behind, and says so.
  let failed = false;
  afterEach((ctx) => {
    if (ctx.task.result?.state === "fail") failed = true;
  });
  afterAll(() => {
    if (!UPDATE) return;
    if (failed) throw new Error("conformance lock NOT written; a test in this run failed");
    const missing = files.map((f) => f.replace(/\.json$/, "")).filter((id) => !fresh.scenarios[id]);
    if (missing.length) throw new Error(`conformance lock NOT written; these scenarios did not finish: ${missing.join(", ")}`);
    writeLock(fresh);
  });

  it("has a scenario for every lock entry and a unique id per file", () => {
    const ids = files.map((f) => loadScenario(resolve(SCENARIO_DIR, f)).id);
    expect(ids).toEqual(files.map((f) => f.replace(/\.json$/, "")));
    if (!UPDATE) expect(Object.keys(lock.scenarios).sort()).toEqual([...ids].sort());
  });

  for (const file of files) {
    const scenario = loadScenario(resolve(SCENARIO_DIR, file));
    it(`${scenario.id} matches its pinned checkpoints`, () => {
      const got = runScenario(scenario);
      if (UPDATE) {
        fresh.scenarios[scenario.id] = got;
        return;
      }
      // Report the first divergent checkpoint, the useful fact for a port.
      expect(firstDivergence(got, lock.scenarios[scenario.id] ?? [])).toBeNull();
    }, 60_000);
  }

  it("runs a new game and a loaded save the same way twice in one process", () => {
    for (const id of ["starter-classic", "fixture-split-tower"]) {
      const s = loadScenario(resolve(SCENARIO_DIR, `${id}.json`));
      expect(runScenario(s)).toEqual(runScenario(s));
    }
  }, 60_000);
});
