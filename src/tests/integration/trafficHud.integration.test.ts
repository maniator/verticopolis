import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GameApp } from "../../main";
import { jumpFrame, jumpToTraffic, lineSpan, updateTraffic } from "../../game/trafficHud";
import { newRenderSim, newViewReader } from "../../game/portAccess";
import { TRAFFIC_LABELS, trafficTier, linePressure, type LineWaitTier } from "../../presentation/traffic";
import { floorLabel } from "../../ui/floorLabel";
import type { EnginePort } from "../../simport/enginePort";
import { hasWasmPackage, wasm } from "../conformance/wasmEngine";
import { PortCodes } from "../../simport/portCodes";

vi.mock("../../analytics", () => ({ trackAppAction: vi.fn() }));

/**
 * The traffic chip on the Rust engine's own waiting lines (owner's report,
 * 2026-11-17: "Backed up · 25F" with nobody waiting there, and a tap that lit
 * every elevator on the floor). A grown tower runs through a day; at each
 * sampled minute the chip must name the floor of the engine's longest
 * fed-up line (read here straight off `queueView`'s record), and a tap must
 * center on that line's stretch of its floor, a stretch that holds every
 * person whose trip waits for that elevator there (lines run across the
 * shafts beside their own, so a guess from the nearest shaft misses them in
 * a bank; `src/game/trafficJump.test.ts` and the engine's `landing_tests.rs`
 * pin that case). The chip's reads and hysteresis
 * over canned answers are `src/game/trafficHudPort.test.ts`.
 */

const TOWER = resolve(__dirname, "../perfCompare/towers/large.vctower");
const made: Array<{ free(): void }> = [];
afterEach(() => {
  for (const e of made.splice(0)) e.free();
});

/** The engine's lines as `[shaft, floor, count, tier]`, off the raw record. */
function rawLines(engine: EnginePort): Array<[number, number, number, LineWaitTier]> {
  const q = engine.queueView();
  const rows: Array<[number, number, number, LineWaitTier]> = [];
  for (let i = 0; i < q[0]; i++) rows.push([q[2 + i * 4], q[3 + i * 4], q[4 + i * 4], q[5 + i * 4] as LineWaitTier]);
  return rows;
}

describe.skipIf(!hasWasmPackage())("the traffic chip on the engine", () => {
  it("names the engine's worst line all day, not the floors' remembered waits, and a tap lands on it", () => {
    document.body.innerHTML = `<div id="traffic"><span id="traffic-glyph"></span><span id="traffic-label"></span><span id="traffic-floor"></span></div>`;
    const engine = wasm().Engine.fromVctower(readFileSync(TOWER, "utf8")) as unknown as EnginePort & { free(): void; tick(m: number): void };
    made.push(engine);
    const reader = newViewReader(engine);
    const codes = new PortCodes(engine);
    const sim = newRenderSim(engine, reader);
    const applyView = vi.fn();
    const app = { engine: { sim, viewWidth: 1280, applyView }, enginePort: engine, lastTrafficTier: 0, frameErrors: [] };
    const label = () => document.getElementById("traffic-label")!.textContent;
    const tag = () => document.getElementById("traffic-floor")!.textContent;
    let named = 0;
    let quietButRemembered = 0;
    let checked = 0;
    for (let minute = 0; minute < 24 * 60; minute += 15) {
      engine.tick(15);
      reader.update();
      // Fresh from Smooth each sample, so the tier is the line's own.
      app.lastTrafficTier = 0;
      updateTraffic(app as unknown as GameApp);
      const lines = rawLines(engine);
      const pressure = Math.max(0, ...lines.map(([, , count, tier]) => linePressure({ count, tier })));
      const tier = trafficTier(pressure);
      expect(label(), `minute ${minute}`).toBe(TRAFFIC_LABELS[tier]);
      if (tier === 0) {
        expect(tag(), `minute ${minute}`).toBe("");
        // The old chip read this ratio: past Backed up with nobody in line.
        if (engine.hotspot()[0] > 0.8) quietButRemembered++;
        continue;
      }
      const worst = lines.filter(([, , count, t]) => linePressure({ count, tier: t }) === pressure);
      const floors = worst.map(([, floor]) => (floor >= 1 ? `${floor}F` : floorLabel(floor)));
      expect(floors, `minute ${minute}`).toContain(tag().replace(" · ", ""));
      applyView.mockClear();
      if (!jumpToTraffic(app as unknown as GameApp)) {
        // The projection is the step's start: a line that has boarded since
        // has no stretch left, and the tap does nothing rather than light an
        // empty shaft.
        for (const [s, f] of worst) expect(engine.queueLine(s, f).length, `minute ${minute}: a tap that did nothing had a line to show`).toBe(0);
        expect(applyView).not.toHaveBeenCalled();
        continue;
      }
      const [{ floor, tile }] = applyView.mock.calls[0] as [{ floor: number; tile: number }];
      const [shaft] = worst.find(([, f]) => f === floor + 0.5)!;
      const t = sim.tower.getTransport(shaft)!;
      const span = lineSpan(t, engine.queueLine(shaft, floor + 0.5));
      expect(tile, `minute ${minute}: centered on the line`).toBe(jumpFrame(span, 1280).tile);
      // Everyone in the line stands in the band: each person waiting on that
      // floor whose trip card says they wait for this shaft.
      const riders = sim.crowd.people.filter((p) => p.state === "waiting" && p.floor === floor + 0.5 && codes.slot(engine.personCard(p.id), "personCard", "shaftId") === shaft);
      checked += riders.length;
      for (const p of riders) {
        expect(p.x, `minute ${minute}: rider ${p.id} of the line stands in ${JSON.stringify(span)}`).toBeGreaterThanOrEqual(span.x);
        expect(p.x, `minute ${minute}: rider ${p.id}`).toBeLessThanOrEqual(span.x + span.width);
      }
      named++;
    }
    expect(named, "the day has lines to name").toBeGreaterThan(10);
    expect(checked, "the day has riders to find in their lines").toBeGreaterThan(50);
    expect(quietButRemembered, "the day has quiet hours the old chip called backed up").toBeGreaterThan(0);
  });
});
