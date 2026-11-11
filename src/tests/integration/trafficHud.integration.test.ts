import { describe, expect, it } from "vitest";
import type { GameApp } from "../../main";
import { updateTraffic } from "../../game/trafficHud";
import { TRAFFIC_LABELS, trafficTier } from "../../presentation/traffic";
import { PortCodes } from "../../simport/portCodes";
import type { EnginePort } from "../../simport/enginePort";
import { LOT_WIDTH, lay, mustBuild } from "../portKit/draftFixtures";
import { draftTower } from "../portKit/drafts";
import { noEngine } from "../portKit/rustEngine";

/**
 * The traffic chip drawing the Rust engine's own hotspot answer. The chip's
 * reads and hysteresis over canned answers are `src/game/trafficHudPort.test.ts`.
 */

describe.skipIf(noEngine)("the traffic chip on the engine", () => {
  it("draws the engine's hotspot: a weak lobby bank under a full office stack backs up at the lobby", () => {
    document.body.innerHTML = `<div id="traffic"><span id="traffic-glyph"></span><span id="traffic-label"></span><span id="traffic-floor"></span></div>`;
    const draft = draftTower(7);
    draft.money = 1e12;
    lay(draft, "lobby", 1);
    for (let f = 2; f <= 10; f++) lay(draft, "floor", f);
    mustBuild(draft, "elevatorStandard", LOT_WIDTH - 6, 1, 10);
    for (let f = 2; f <= 10; f++) {
      for (let x = 0; x + 9 <= LOT_WIDTH - 8; x += 9) {
        const r = draft.tower.place("office", f, x);
        expect(r.ok, `office at ${f},${x}`).toBe(true);
        draft.tower.getUnit(r.unitId!)!.state = "occupied";
      }
    }
    draft.tick(1);
    const engine = draft.port as unknown as EnginePort;
    const [ratio, hotFloor] = engine.hotspot();
    expect(hotFloor, "the lobby is the hotspot").toBe(1);
    expect(trafficTier(ratio), "past the hysteresis margin").toBeGreaterThanOrEqual(2);
    const app = { enginePort: engine, portCodes: new PortCodes(engine), lastTrafficTier: 0, frameErrors: [] };
    updateTraffic(app as unknown as GameApp);
    expect(app.lastTrafficTier).toBe(trafficTier(ratio));
    const shown = [document.getElementById("traffic-label")!.textContent, document.getElementById("traffic-floor")!.textContent, app.frameErrors];
    expect(shown).toEqual([TRAFFIC_LABELS[app.lastTrafficTier], " · 1F", []]);
  });
});
