import { describe, expect, it } from "vitest";
import { Simulation } from "../../engine/Simulation";
import { loadCommand } from "../../dualrun/mirror";
import { ShadowEngine } from "../../dualrun/shadow";
import { attachWasmHost } from "../../wasmhost/wasmHost";
import { telemetryDocument, type TelemetryDocument } from "../../wasmhost/telemetry";
import { decodeFrame } from "../../wasmhost/frameView";
import { canonicalJson } from "../../engine/canonicalJson";
import { stateView } from "../../engine/conformanceView";
import { hasWasmPackage, wasm, wasmRequired } from "../conformance/wasmEngine";
import { FIXTURES, FrameDriver, loadFixture } from "../dualrun/dualRunHarness";
import type { WasmEngine } from "../../dualrun/binding";

/**
 * The hourly elevator telemetry on both engines (#868): the demand curves the
 * schedule dialog reads, the utilization average and the boarding-origin
 * rings, and yesterday's housekeeping result the stats screen reads. The save
 * never carries them, so the conformance view leaves them out; this suite
 * compares them directly, hour by hour, and checks that the WASM host's read
 * model shows the engine's.
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
}

/** Tick both engines an hour at a time, comparing after each hour. */
function compareHours(sim: Simulation, engine: WasmEngine, hours: number, seen: Seen, label: string): void {
  for (let h = 0; h < hours; h++) {
    sim.tick(60);
    engine.tick(60);
    const doc = telemetryDocument(sim);
    expect(engineTelemetry(engine.elevatorTelemetry()), `${label} hour ${h}`).toEqual(doc);
    const hk = sim.economy.housekeepingReport();
    expect(JSON.parse(engine.housekeepingReport() ?? "null"), `${label} hour ${h} housekeeping`).toEqual(hk);
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
  const shadow = new ShadowEngine(wasm());
  shadow.apply(loadCommand(sim, 0));
  const engine = shadow.handle();
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
    shadow.free();
  }
}

describe.skipIf(!hasWasmPackage())("elevator telemetry on both engines", () => {
  it("every fixture, hour by hour, through a weekday and a weekend", () => {
    const seen: Seen = { weekday: false, weekend: false, housekeeping: false };
    for (const fixture of FIXTURES) run(fixture, seen);
    // Real values were compared, never only empty stores.
    expect(seen).toEqual({ weekday: true, weekend: true, housekeeping: true });
  }, 300_000);

  it("the hosted read model shows the engine's telemetry after each hour, in the objects a reader holds", () => {
    const sim = loadFixture(FIXTURES[0]);
    const host = attachWasmHost(sim, wasm());
    try {
      const driver = new FrameDriver(sim, 3);
      // The rings a schedule dialog holds while it is open: the first shaft's,
      // taken once and read again after every later hour.
      let held: { id: number; hourly: object; origins: object } | null = null;
      for (let h = 0; h < 12; h++) {
        driver.run(60);
        host.syncStructure();
        const doc = engineTelemetry(host.engine.elevatorTelemetry());
        expect(telemetryDocument(sim), `hour ${h}`).toEqual(doc);
        expect(sim.economy.housekeepingReport(), `hour ${h} housekeeping`).toEqual(JSON.parse(host.engine.housekeepingReport() ?? "null"));
        if (!held && doc.hourly.length > 0) {
          const id = doc.hourly[0][0];
          held = { id, hourly: sim.elevatorHourlyLoad(id)!, origins: sim.elevatorOriginLoad(id)! };
        } else if (held) {
          // Same objects, and (by the document comparison above) the engine's values.
          expect(sim.elevatorHourlyLoad(held.id), `hour ${h}: the held curve is the live one`).toBe(held.hourly);
          expect(sim.elevatorOriginLoad(held.id), `hour ${h}: the held origins are the live ones`).toBe(held.origins);
        }
      }
      expect(held, "a shaft was sampled").not.toBeNull();
    } finally {
      host.detach();
    }
  }, 60_000);

  it("seeds the telemetry and the loop memos, and moves the clock without a pass", () => {
    const sim = loadFixture(FIXTURES[0]);
    const shadow = new ShadowEngine(wasm());
    shadow.apply(loadCommand(sim, 0));
    const engine = shadow.handle();
    try {
      const doc: TelemetryDocument = {
        util: [[7, 0.5]],
        hourly: [[7, { weekday: Array.from({ length: 24 }, (_, h) => h / 24), weekend: new Array<number>(24).fill(0.1) }]],
        origins: [[7, { weekday: Array.from({ length: 24 }, (_, h) => (h === 8 ? [[1, 3]] : [])), weekend: Array.from({ length: 24 }, () => []) }]],
      };
      engine.seedElevatorTelemetry(JSON.stringify(doc));
      expect(engineTelemetry(engine.elevatorTelemetry())).toEqual(doc);
      expect(() => engine.seedElevatorTelemetry('{"util":[[1.5,1]]}')).toThrow();
      expect(engineTelemetry(engine.elevatorTelemetry())).toEqual(doc);

      // A raw clock move runs nothing: the hour count holds until the next tick.
      const before = decodeFrame(engine.frameView()).header;
      engine.advanceClock(150);
      const after = decodeFrame(engine.frameView()).header;
      expect(after.minutes).toBe(before.minutes + 150);
      expect({ ...after, minutes: before.minutes }).toEqual(before);
      expect(() => engine.advanceClock(-1)).toThrow();
      expect(() => engine.advanceClock(Number.NaN)).toThrow();

      // A fresh tower built in place owes its first hour pass; seeded memos
      // keep it owed on the engine, where a load would have marked it done.
      const fresh = Simulation.newGame(5, "classic");
      const twin = Simulation.deserialize(fresh.serialize());
      const owed = new ShadowEngine(wasm());
      owed.apply(loadCommand(twin, 0));
      const e2 = owed.handle();
      try {
        e2.seedLoopMemos(fresh.lastHour, fresh.lastDay, fresh.lastMonth, fresh.lastQuarter);
        expect(() => e2.seedLoopMemos(0.5, 0, 0, 0)).toThrow();
        fresh.tick(1);
        e2.tick(1);
        expect(fresh.onHourRuns).toBe(1);
        expect(e2.stateView()).toBe(canonicalJson(stateView(fresh)));
      } finally {
        owed.free();
      }
    } finally {
      shadow.free();
    }
  });
});
