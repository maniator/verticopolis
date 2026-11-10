import { describe, expect, it } from "vitest";
import type { Simulation } from "../../engine/Simulation";
import type { WasmEngine } from "../../dualrun/binding";
import { telemetryDocument, type TelemetryDocument } from "../../wasmhost/telemetry";
import { hasWasmPackage, wasm, wasmRequired } from "../conformance/wasmEngine";
import { FIXTURES, loadFixture } from "../conformance/fixtureSim";

/**
 * The hourly elevator telemetry on both engines (#868): the demand curves the
 * schedule dialog reads, the utilization average and the boarding-origin
 * rings, yesterday's housekeeping result the stats screen reads, and the
 * crowd's per-origin commute-stress averages (#514). The save never carries
 * them, so neither the conformance view nor the frame-day golden holds them;
 * this suite starts the Rust engine from the TypeScript save itself
 * (`Engine.fromSave`) and compares them directly, hour by hour.
 */

if (wasmRequired() && !hasWasmPackage()) throw new Error("VC_REQUIRE_WASM=1 but engine-rs/pkg/ is not built; run npm run wasm:build");

const engineTelemetry = (json: string) => JSON.parse(json) as TelemetryDocument;

/** Whether any shaft recorded load on `ring`, so a comparison of empty
 *  stores never passes for one of real curves. */
const warmed = (doc: TelemetryDocument, ring: "weekday" | "weekend") => doc.hourly.some(([, r]) => r[ring].some((v) => v > 0));

interface Seen {
  weekday: boolean;
  weekend: boolean;
  housekeeping: boolean;
  commute: boolean;
}

/** The instance's commute-stress averages in the engine's row order. */
const commuteRows = (sim: Simulation) => [...sim.crowd.commuteStressByFloor.entries()].sort((a, b) => a[0] - b[0]);

/** Tick both engines an hour at a time, comparing after each hour. */
function compareHours(sim: Simulation, engine: WasmEngine, hours: number, seen: Seen, label: string): void {
  for (let h = 0; h < hours; h++) {
    sim.tick(60);
    engine.tick(60);
    const doc = telemetryDocument(sim);
    expect(engineTelemetry(engine.elevatorTelemetry()), `${label} hour ${h}`).toEqual(doc);
    const hk = sim.economy.housekeepingReport();
    expect(JSON.parse(engine.housekeepingReport() ?? "null"), `${label} hour ${h} housekeeping`).toEqual(hk);
    const commute = commuteRows(sim);
    expect(JSON.parse(engine.commuteStress()), `${label} hour ${h} commute stress`).toEqual(commute);
    seen.commute ||= commute.length > 0;
    seen.weekday ||= warmed(doc, "weekday");
    seen.weekend ||= warmed(doc, "weekend");
    seen.housekeeping ||= hk !== null && (hk.cleaned > 0 || hk.leftover > 0);
  }
}

/** Two days from the fixture's own clock, then both clocks moved (raw, as
 *  `clock.advance` does) to the start of the next weekend and a day there, so
 *  the weekend rings and the weekday-to-weekend origin attribution are
 *  compared too. */
function run(fixture: string, seen: Seen): void {
  const sim = loadFixture(fixture);
  const engine = wasm().Engine.fromSave(JSON.stringify(sim.serialize()));
  try {
    compareHours(sim, engine, 48, seen, fixture);
    const cal = sim.clock.calendar;
    let day = sim.clock.day + 1;
    while (day % cal.weekDays !== cal.weekDays - cal.weekendDays || day * 1440 - 60 <= sim.clock.minutes) day++;
    const delta = day * 1440 - 60 - sim.clock.minutes;
    expect(delta, `${fixture} reaches the weekend ahead`).toBeGreaterThan(0);
    sim.clock.advance(delta);
    engine.advanceClock(delta);
    compareHours(sim, engine, 26, seen, `${fixture} weekend`);
  } finally {
    engine.free();
  }
}

describe.skipIf(!hasWasmPackage())("elevator telemetry on both engines", () => {
  it("every fixture, hour by hour, through a weekday and a weekend", () => {
    const seen: Seen = { weekday: false, weekend: false, housekeeping: false, commute: false };
    for (const fixture of FIXTURES) run(fixture, seen);
    // Real values were compared, never only empty stores.
    expect(seen).toEqual({ weekday: true, weekend: true, housekeeping: true, commute: true });
  }, 300_000);
});
