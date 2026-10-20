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
 * rings, yesterday's housekeeping result the stats screen reads, and the
 * crowd's per-origin commute-stress averages (#514). The save
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
    const seen: Seen = { weekday: false, weekend: false, housekeeping: false, commute: false };
    for (const fixture of FIXTURES) run(fixture, seen);
    // Real values were compared, never only empty stores.
    expect(seen).toEqual({ weekday: true, weekend: true, housekeeping: true, commute: true });
  }, 300_000);

  it("the hosted read model shows the engine's telemetry after each hour, in the objects a reader holds", () => {
    const sim = loadFixture(FIXTURES[0]);
    const host = attachWasmHost(sim, wasm());
    try {
      const driver = new FrameDriver(sim, 3);
      // The rings a schedule dialog holds while it is open: the first shaft's,
      // taken once and read again after every later hour.
      let held: { id: number; hourly: object; origins: object } | null = null;
      let heldCommute: ReadonlyMap<number, number> | undefined;
      for (let h = 0; h < 12; h++) {
        driver.run(60);
        host.syncStructure();
        const doc = engineTelemetry(host.engine.elevatorTelemetry());
        expect(telemetryDocument(sim), `hour ${h}`).toEqual(doc);
        expect(sim.economy.housekeepingReport(), `hour ${h} housekeeping`).toEqual(JSON.parse(host.engine.housekeepingReport() ?? "null"));
        expect(commuteRows(sim), `hour ${h} commute stress`).toEqual(JSON.parse(host.engine.commuteStress()));
        // The map a reader holds is the live one, filled in place.
        heldCommute ??= sim.crowd.commuteStressByFloor;
        expect(sim.crowd.commuteStressByFloor, `hour ${h}: the held commute map is the live one`).toBe(heldCommute);
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

  it("the hosted read model follows the engine's commute stress between merges and keeps the latest rows through detach", () => {
    const sim = loadFixture(FIXTURES[0]);
    const host = attachWasmHost(sim, wasm(), { sync: "frame" });
    const engineRows = () => (JSON.parse(host.engine.commuteStress()) as [number, number][]).sort((a, b) => a[0] - b[0]);
    try {
      const driver = new FrameDriver(sim, 3);
      let revision = host.engine.commuteStressRevision();
      let moved = 0;
      let betweenMerges = 0;
      for (let frame = 0; frame < 3000 && betweenMerges < 3; frame++) {
        const merges = host.merges;
        driver.frame();
        host.flush();
        const now = host.engine.commuteStressRevision();
        if (now !== revision) {
          moved++;
          if (host.merges === merges) betweenMerges++;
          revision = now;
        }
        // Whatever the frame did, the rows a reader holds are the engine's.
        expect(commuteRows(sim), `frame ${frame}`).toEqual(engineRows());
      }
      expect(moved, "trips completed and moved the revision").toBeGreaterThan(0);
      expect(betweenMerges, "rows changed on a frame that brought no full merge").toBeGreaterThan(0);

      // Reading the rows and the revision changes nothing the save or the
      // conformance hash carries.
      const save = host.engine.serialize();
      const digest = host.engine.stateDigest();
      host.engine.commuteStress();
      host.engine.commuteStressRevision();
      expect(host.engine.serialize()).toBe(save);
      expect(host.engine.stateDigest()).toBe(digest);

      // Steps outside a frame flush leave the engine's rows ahead of the read
      // model's; detach hands the latest over.
      let pending = false;
      for (let i = 0; i < 2000 && !pending; i++) {
        sim.tick(1);
        pending = JSON.stringify(commuteRows(sim)) !== JSON.stringify(engineRows());
      }
      expect(pending, "a step completed a trip the read model has not adopted").toBe(true);
      const latest = engineRows();
      host.detach();
      expect(commuteRows(sim)).toEqual(latest);
    } finally {
      host.detach();
    }
  }, 120_000);

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
        expect([...e2.loopMemos()]).toEqual([fresh.lastHour, fresh.lastDay, fresh.lastMonth, fresh.lastQuarter]);
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
