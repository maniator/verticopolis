import { describe, expect, it } from "vitest";
import type { WasmEngine } from "../../dualrun/binding";
import type { EnginePort } from "../../simport/enginePort";
import { canonicalJson } from "../conformance/canonical";
import { hasWasmPackage, wasm, wasmRequired } from "../conformance/wasmEngine";
import { PORT_EDIT_CASES, runPortEditCase, type PortEditCase } from "../goldens/portEditCases";
import { firstPortEditDifference, portEditProblems, readPortEdits, writePortEdits, type PortEditGolden, type PortEditLeg, type PortEditLine } from "../goldens/portEdits";
import { PORT_EDITS_UPDATE as UPDATE, writeAfterPassingRun } from "../goldens/updateGate";

/**
 * The port-edit golden on the Rust engine (`src/tests/goldens/portEdits.ts`):
 * the player's edits the dual run mirrored, sent as the game's port commands,
 * must answer and move the tower as pinned at every step. It is the
 * proposed evidence for the edit half of the #945 Dual run row once the
 * TypeScript engine is gone (owner sign-off pending on #945).
 *
 * A moved line is an engine change. Regenerate the golden with intent, in the
 * same pull request, saying why:
 * `VC_PORT_EDITS_UPDATE=1 npx vitest run --project integration conformanceWasmPortEdits`.
 * An update writes only from a run in which every test in this file ran and
 * passed, and it refuses to run in CI. While the TypeScript engine exists, its
 * referee check (`portEditsReferee.integration.test.ts`) must pass on the new
 * file too.
 */

if ((wasmRequired() || UPDATE) && !hasWasmPackage()) throw new Error("the port-edit golden needs the engine package (VC_REQUIRE_WASM=1 or VC_PORT_EDITS_UPDATE=1), and engine-rs/pkg/ is not built; run npm run wasm:build");

/** A fresh Rust engine; the case loads or founds its own tower over the
 *  placeholder it starts with. */
function rustLeg(): PortEditLeg & { free(): void } {
  const engine: WasmEngine = wasm().Engine.newGame(1, "classic");
  return {
    name: "rust",
    port: engine as unknown as EnginePort,
    stateView: () => canonicalJson(JSON.parse(engine.stateView())),
    crowdView: () => canonicalJson(JSON.parse(engine.crowdView())),
    setMoney: (amount) => engine.setMoney(amount),
    free: () => engine.free(),
  };
}

function run(c: PortEditCase, afterStart?: (port: EnginePort) => void): PortEditLine[] {
  const leg = rustLeg();
  try {
    return runPortEditCase(leg, c, afterStart);
  } finally {
    leg.free();
  }
}

const ids = PORT_EDIT_CASES.map((c) => c.id);
const fresh: Record<string, PortEditLine[]> = {};
writeAfterPassingRun(
  "port-edit golden",
  UPDATE,
  () => ids.filter((id) => !fresh[id]),
  () => writePortEdits(ids, fresh),
);

describe.skipIf(!hasWasmPackage())("the port-edit golden on the Rust engine", () => {
  const pinned: PortEditGolden = UPDATE ? { cases: {} } : readPortEdits();

  it("pins every case and nothing else", () => {
    expect(new Set(ids).size, "case ids are unique").toBe(ids.length);
    if (!UPDATE) expect(Object.keys(pinned.cases)).toEqual(ids);
  });

  for (const c of PORT_EDIT_CASES) {
    it(c.id, () => {
      const got = run(c);
      // Checked before a refresh writes it, too.
      expect(portEditProblems(c.start, got)).toEqual([]);
      if (UPDATE) {
        fresh[c.id] = got;
        return;
      }
      expect(firstPortEditDifference(got, pinned.cases[c.id])).toBeNull();
    }, 120_000);
  }

  it("runs a case the same way twice in one process", () => {
    const c = PORT_EDIT_CASES.find((x) => x.id === "malformed charge commands and the drag mark")!;
    expect(run(c)).toEqual(run(c));
  });

  it("catches a tower changed between steps at the next line, in the state hash alone", () => {
    // What the dual run's drifting shadow showed: a change no step recorded is
    // named at the first line after it. The tower's name moves the state and
    // sends no event, so the state hash alone has to catch it. It compares
    // with a plain run of the same case, so it runs in an update too.
    const c = PORT_EDIT_CASES.find((x) => x.id === "the floor and lobby brush")!;
    const plain = run(c);
    const changed = run(c, (port) => port.nameTower("Drifted"));
    expect(firstPortEditDifference(changed, plain)).toMatch(/^line 1 \(set money to 1000000000\): state "[0-9a-f]{16}" != pinned "[0-9a-f]{16}"$/);
  });
});
