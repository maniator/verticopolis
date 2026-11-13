import { describe, expect, it } from "vitest";
import type { WasmEngine } from "../../engineBinding/binding";
import type { EnginePort } from "../../simport/enginePort";
import { canonicalJson } from "../conformance/canonical";
import { hasWasmPackage, wasm } from "../conformance/wasmEngine";
import type { FrameDayStart } from "../goldens/frameDays";
import { BULLDOZE, PORT_EDIT_CASES, runPortEditCase, type PortEditCase } from "../goldens/portEditCases";
import { firstPortEditDifference, portEditProblems, readPortEdits, writePortEdits, type PortEditGolden, type PortEditLine } from "../goldens/portEditLines";
import { PortEditSession, type PortEditLeg } from "../goldens/portEdits";
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
 * passed, and it refuses to run in CI.
 */

if (UPDATE && !hasWasmPackage()) throw new Error("the port-edit golden needs the engine package (VC_PORT_EDITS_UPDATE=1), and engine-rs/pkg/ is not built; run npm run wasm:build");

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

/** The tower the session tests load: the four-star case's, whose crowd
 *  moves on the first frame. */
const FOUR_STAR: FrameDayStart = { kind: "fixture", file: "towerone-star4.vctower" };

/** The port method the frame loop steps through, which `holdingClock`
 *  holds. */
const ADVANCE: keyof EnginePort = "advance";

/** What a held frame answers for the steps it ran. */
const NO_STEPS = 0;

/** The leg with its clock held for its first `frames` frames: `advance`
 *  steps nothing and still owes what it was given. `heldLeft` answers the
 *  frames still to hold. */
function holdingClock(leg: PortEditLeg, frames: number): { leg: PortEditLeg; heldLeft: () => number } {
  let held = frames;
  const heldAdvance: EnginePort["advance"] = (owed) => {
    held--;
    return Float64Array.of(NO_STEPS, owed);
  };
  const port = new Proxy(leg.port, {
    get(target, key) {
      if (key === ADVANCE && held > 0) return heldAdvance;
      const value: unknown = Reflect.get(target, key);
      return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  });
  return { leg: { ...leg, port }, heldLeft: () => held };
}

/** Run `body` on a session over a fresh Rust engine, its clock held for
 *  its first `heldFrames` frames, freeing the engine after. The session's
 *  start must spend none of the hold, and a body that returns all of it. */
function withSession<T>(body: (s: PortEditSession) => T, heldFrames = 0): T {
  const leg = rustLeg();
  try {
    const clock = holdingClock(leg, heldFrames);
    const session = new PortEditSession(clock.leg, "session test", FOUR_STAR);
    expect(clock.heldLeft(), "frames held after the session's start").toBe(heldFrames);
    const answer = body(session);
    expect(clock.heldLeft(), "frames held after the body").toBe(0);
    return answer;
  } finally {
    leg.free();
  }
}

const sortedIds = (ids: Set<number>): number[] => [...ids].sort((a, b) => a - b);

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

  it("reads the crowd after a play's first frame that moves the clock", () => {
    // Each run holds the clock for its first frame, a frame that leaves the
    // clock still. At the play speed a frame that moves the clock moves it a
    // minute or more, so a play of one minute ends on the first such frame,
    // and both runs play it at the same frame time.
    const [atStart, afterFirstMove] = withSession((s) => {
      const before = sortedIds(s.personIds());
      s.play(1);
      return [before, sortedIds(s.personIds())];
    }, 1);
    expect(afterFirstMove).not.toEqual(atStart);
    expect(withSession((s) => sortedIds(s.playReadingFirstMove(30)), 1)).toEqual(afterFirstMove);
    expect(() => withSession((s) => s.play(0))).toThrow(/play needs a positive number of minutes, and got 0/);
  });

  it("refuses to tell new people apart across a swap, an undo or a redo, or after the next person id went down, and keeps the mark across an undo or redo with nothing to step", () => {
    const acrossSwap = (s: PortEditSession) => {
      const mark = s.markPeople();
      s.restore("restore the tower", s.port.serialize());
      s.shaftsBetween(0, 1, mark);
    };
    // The escalator bulldoze as the tools send it, its own undo step.
    const acrossStep = (which: "undo" | "redo") => (s: PortEditSession) => {
      s.capture("Bulldoze");
      s.done("bulldoze the escalator at floor 1, x 234", "demolish", s.shaftAt(1, 234).id, BULLDOZE);
      s.commit("close the bulldoze's undo step");
      if (which === "redo") s.history("undo the bulldoze", "undo", "done");
      const mark = s.markPeople();
      s.history(`${which} the bulldoze`, which, "done");
      s.shaftsBetween(0, 1, mark);
    };
    const arms: [string, (s: PortEditSession) => void][] = [
      ["a restore", acrossSwap],
      ["an undo", acrossStep("undo")],
      ["a redo", acrossStep("redo")],
    ];
    for (const [step, arm] of arms) expect(() => withSession(arm), `across ${step}`).toThrow(/a swap, undo or redo since the mark can start the crowd's ids again/);
    // An undo or redo with nothing to step keeps the generation and the
    // crowd's ids, so the mark holds. The crowd is grown first and plays on
    // after, so an id that started again would show.
    const acrossNothing = (which: "undo" | "redo") => (s: PortEditSession) => {
      s.play(30);
      const mark = s.markPeople();
      expect(mark.nextId, "people set out before the mark").toBeGreaterThan(1);
      s.history(`${which} with nothing to step`, which, "nothingToStep");
      s.play(30);
      s.shaftsBetween(0, 1, mark);
    };
    for (const which of ["undo", "redo"] as const) expect(() => withSession(acrossNothing(which)), `across ${which} with nothing to step`).not.toThrow();
    const aheadOfTheCrowd = (s: PortEditSession) => {
      const mark = s.markPeople();
      s.shaftsBetween(0, 1, { ...mark, nextId: mark.nextId + 1 });
    };
    expect(() => withSession(aheadOfTheCrowd)).toThrow(/the crowd's next person id went from \d+ to \d+ with no swap, undo or redo/);
  });
});
