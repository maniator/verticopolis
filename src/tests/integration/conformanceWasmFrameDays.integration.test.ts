import { describe, expect, it } from "vitest";
import type { WasmEngine } from "../../dualrun/binding";
import { readCatalog } from "../../dualrun/catalog";
import type { EnginePort } from "../../simport/enginePort";
import { canonicalJson } from "../conformance/canonical";
import { hasWasmPackage, wasm, wasmRequired } from "../conformance/wasmEngine";
import {
  EVENT_DAY_FIXTURE,
  FIRST_FRAME_CHECKPOINT,
  FRAME_DAY_CASES,
  FRAME_DAY_FIXTURES,
  caseDays,
  firstFrameDayDifference,
  frameDayProblems,
  readFrameDays,
  runFrameDay,
  startTower,
  writeFrameDays,
  type FrameDayCase,
  type FrameDayCheckpoint,
  type FrameDayGolden,
  type FrameDayLeg,
} from "../goldens/frameDays";
import { FRAME_DAYS_UPDATE as UPDATE, writeAfterPassingRun } from "../goldens/updateGate";

/**
 * The frame-day golden on the Rust engine (`src/tests/goldens/frameDays.ts`):
 * a day on every fixture at every speed, played through the port's `advance`
 * as the game's frame loop plays it, must reproduce every pinned checkpoint.
 * It is the proposed evidence for the #945 Dual run row once the TypeScript
 * engine is gone (owner sign-off pending on #945).
 *
 * A moved checkpoint is a simulation change. Regenerate the golden with intent,
 * in the same pull request, saying why:
 * `VC_FRAME_DAYS_UPDATE=1 npx vitest run --project integration conformanceWasmFrameDays`.
 * An update writes only from a run in which every test in this file ran and
 * passed (so a `-t` filter that leaves a test out writes nothing), and it
 * refuses to run in CI. The conformance lock's refresh
 * (`VC_CONFORMANCE_UPDATE=1`) does not write this golden; it checks it, when
 * the engine package is built. While the TypeScript engine exists, its
 * referee check (`frameDaysReferee.integration.test.ts`) must pass on the new
 * file too.
 */

if ((wasmRequired() || UPDATE) && !hasWasmPackage()) throw new Error("the frame-day golden needs the engine package (VC_REQUIRE_WASM=1 or VC_FRAME_DAYS_UPDATE=1), and engine-rs/pkg/ is not built; run npm run wasm:build");

/** A fresh Rust engine; the case loads or founds its own tower over the
 *  placeholder it starts with. The views are hashed in canonical form, as the
 *  conformance lock hashes them, so a change to how the binding prints JSON
 *  alone moves no checkpoint. */
function rustLeg(): FrameDayLeg & { engine: WasmEngine; free(): void } {
  const engine = wasm().Engine.newGame(1, "classic");
  return {
    name: "rust",
    engine,
    port: engine as unknown as EnginePort,
    stateView: () => canonicalJson(JSON.parse(engine.stateView())),
    crowdView: () => canonicalJson(JSON.parse(engine.crowdView())),
    free: () => engine.free(),
  };
}

function run(c: FrameDayCase, afterStart?: (engine: WasmEngine) => void): FrameDayCheckpoint[] {
  const leg = rustLeg();
  try {
    return runFrameDay(leg, c, afterStart && (() => afterStart(leg.engine)));
  } finally {
    leg.free();
  }
}

const fresh: Record<string, FrameDayCheckpoint[]> = {};
writeAfterPassingRun(
  "frame-day golden",
  UPDATE,
  () => FRAME_DAY_CASES.filter((c) => !fresh[c.id]).map((c) => c.id),
  () => writeFrameDays(fresh),
);

describe.skipIf(!hasWasmPackage())("the frame-day golden on the Rust engine", () => {
  const pinned: FrameDayGolden = UPDATE ? { cases: {} } : readFrameDays();

  it("pins every case and nothing else", () => {
    const ids = FRAME_DAY_CASES.map((c) => c.id);
    expect(new Set(ids).size, "case ids are unique").toBe(ids.length);
    // The event check names its fixture, so a refresh refuses when it is gone.
    expect(FRAME_DAY_FIXTURES, "the event day's fixture").toContain(EVENT_DAY_FIXTURE);
    if (!UPDATE) expect(Object.keys(pinned.cases)).toEqual(ids);
  });

  it("starts the canon calendar case as a Modern tower on that calendar, which plays past a quarter's end", () => {
    const c = FRAME_DAY_CASES.find((x) => x.start.kind === "fixture" && x.start.calendar === "canon");
    if (!c) throw new Error("no case starts a fixture on the canon calendar");
    const leg = rustLeg();
    try {
      startTower(leg.port, c.start);
      const save = JSON.parse(leg.engine.stateView()) as { mode?: string; modernCalendar?: string };
      expect([save.mode, save.modernCalendar]).toEqual(["modern", "canon"]);
    } finally {
      leg.free();
    }
    const canon = readCatalog(wasm(), "modern").economy.calendars.find((k) => k.key === "canon");
    expect(canon?.quarterDays).toBeLessThan(caseDays(c));
  });

  for (const c of FRAME_DAY_CASES) {
    it(c.id, () => {
      const got = run(c);
      // Checked before a refresh writes it, too.
      expect(frameDayProblems(c, got)).toEqual([]);
      if (UPDATE) {
        fresh[c.id] = got;
        return;
      }
      expect(firstFrameDayDifference(got, pinned.cases[c.id])).toBeNull();
    }, 120_000);
  }

  it("plays a case the same way twice in one process", () => {
    const c = FRAME_DAY_CASES.find((x) => x.id === "new Classic game at speed 3")!;
    expect(run(c)).toEqual(run(c));
  }, 120_000);

  it("catches a tower changed after the start at the next checkpoint, in the state hash", () => {
    // What the dual run's drifting shadow showed: a change the checkpoints
    // did not see is named at the first one after it, here the one taken
    // after the first frame. It compares with a plain run of the same case,
    // so it runs in an update too.
    const c = FRAME_DAY_CASES.find((x) => x.id === "new Classic game at speed 3")!;
    const plain = run(c);
    const changed = run(c, (engine) => engine.setMoney(1));
    expect(firstFrameDayDifference(changed, plain)).toMatch(new RegExp(`^checkpoint ${FIRST_FRAME_CHECKPOINT} \\(minute \\d+\\): state `));
  }, 120_000);
});
