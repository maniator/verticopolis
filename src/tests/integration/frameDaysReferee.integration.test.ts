import { describe, expect, it } from "vitest";
import { crowdView, stateView } from "../../engine/conformanceView";
import { TsEngine } from "../../engine/port/tsEngine";
import { canonicalJson } from "../conformance/canonical";
import { FRAME_DAY_CASES, firstFrameDayDifference, readFrameDays, runFrameDay, type FrameDayLeg } from "../goldens/frameDays";
import { FRAME_DAYS_UPDATE } from "../goldens/updateGate";

/**
 * The TypeScript referee's check of the frame-day golden
 * (`src/tests/goldens/frameDays.ts`): the same cases, played through
 * `TsEngine`'s `advance` (the web host's owed-minute math over the engine's
 * fixed step), must reproduce every checkpoint the Rust engine pinned. With
 * `conformanceWasmFrameDays.integration.test.ts` this is the dual run's day
 * gate: both engines equal the golden at every hour, so they equal each other.
 *
 * It stays while the TypeScript engine does and is deleted with `src/engine/`.
 * The proposal on #945 (owner sign-off pending) is that the golden alone then
 * carries the Dual run row.
 */

function tsLeg(): FrameDayLeg {
  const engine = TsEngine.newGame(1, "classic");
  return {
    name: "typescript",
    port: engine,
    stateView: () => canonicalJson(stateView(engine.sim)),
    crowdView: () => canonicalJson(crowdView(engine.sim)),
  };
}

// An update run rewrites the golden from the Rust engine; run this check on
// the new file afterwards, without the switch.
describe.skipIf(FRAME_DAYS_UPDATE)("the frame-day golden on the TypeScript referee", () => {
  const pinned = readFrameDays();
  for (const c of FRAME_DAY_CASES) {
    it(c.id, () => {
      expect(firstFrameDayDifference(runFrameDay(tsLeg(), c), pinned.cases[c.id])).toBeNull();
    }, 120_000);
  }
});
