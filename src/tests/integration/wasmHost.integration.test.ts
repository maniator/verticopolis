import { describe, expect, it } from "vitest";
import { Simulation } from "../../engine/Simulation";
import type { Person } from "../../engine/crowd/person";
import { canonicalJson } from "../../engine/canonicalJson";
import { stateView } from "../../engine/conformanceView";
import { startWasmHost } from "../../wasmhost/startWasmHost";
import { attachWasmHost } from "../../wasmhost/wasmHost";
import { attachMirror } from "../../dualrun/mirror";
import { decodeFrame } from "../../wasmhost/frameView";
import { hasWasmPackage, wasm, wasmRequired } from "../conformance/wasmEngine";
import { FIXTURES, FrameDriver, loadFixture } from "../dualrun/dualRunHarness";

/**
 * The read-model gate of story-engine-wasm-switch: with the WASM engine
 * ticking and the TypeScript instance refreshed from it, the instance's own
 * state view (what the renderer, the panels and the save see) equals the
 * engine's at every hour of a day, on every fixture, and the crowd the
 * renderer draws matches the engine's people.
 */

if (wasmRequired() && !hasWasmPackage()) throw new Error("VC_REQUIRE_WASM=1 but engine-rs/pkg/ is not built; run npm run wasm:build");

const DAY = 24 * 60;

/** The instance's own view of itself, from its fields (its `serialize` is
 *  the engine's while hosted, so the prototype's is used here). */
function ownStateView(sim: Simulation): string {
  const own = Object.getOwnPropertyDescriptor(sim, "serialize");
  if (own) delete (sim as Partial<Simulation>).serialize;
  try {
    return canonicalJson(stateView(sim));
  } finally {
    if (own) Object.defineProperty(sim, "serialize", own);
  }
}

/** The person fields the frame view carries: position and state, and the
 *  routing the suites read (#878). Both sides are projected through the
 *  same shape, each value as it stands (a flag is true or undefined on both
 *  sides, so a false one fails the compare), plus whether the flags the
 *  TypeScript engine never clears (`staff`, `returning`) are present at
 *  all: the engine's crowd view holds a flag only when it is true. */
type FramePerson = Pick<Person, "id" | "seed" | "state" | "floor" | "x" | "fy" | "wait" | "originFloor" | "originUnitId" | "venueUnitId" | "mealVenueId" | "routine" | "dwellSecondsLeft" | "floors" | "shafts" | "staff" | "countedHotelGuest" | "returning"> & {
  has: { staff: boolean; returning: boolean };
};

function framePerson(p: Person): FramePerson {
  return {
    id: p.id, seed: p.seed, state: p.state, floor: p.floor, x: p.x, fy: p.fy, wait: p.wait, staff: p.staff,
    originFloor: p.originFloor, originUnitId: p.originUnitId, venueUnitId: p.venueUnitId, mealVenueId: p.mealVenueId,
    countedHotelGuest: p.countedHotelGuest, routine: p.routine, returning: p.returning, dwellSecondsLeft: p.dwellSecondsLeft,
    floors: p.floors, shafts: p.shafts,
    has: { staff: "staff" in p, returning: "returning" in p },
  };
}

function peopleOf(sim: Simulation): FramePerson[] {
  return sim.crowd.people.map(framePerson);
}

function enginePeople(json: string): FramePerson[] {
  const view = JSON.parse(json) as { people: Person[] };
  return view.people.map(framePerson);
}

function day(sim: Simulation, speed: number, expectRouted = true): void {
  const host = attachWasmHost(sim, wasm());
  const driver = new FrameDriver(sim, speed);
  let lastHour = -1;
  let lastLogSeq = sim.logSeq;
  let compared = 0;
  let routed = false;
  const from = sim.clock.minutes;
  while (sim.clock.minutes - from < DAY) {
    driver.frame();
    const hour = Math.floor(sim.clock.minutes / 60);
    if (hour !== lastHour) {
      lastHour = hour;
      // The log as the frames appended it, before a merge: the engine's ring
      // entry for entry, and the instance's cursor never moving backwards.
      const ring = (JSON.parse(host.engine.serialize()) as { log: unknown[] }).log;
      expect(sim.log, `hour ${hour} log`).toEqual(ring);
      expect(sim.logSeq, `hour ${hour} logSeq`).toBeGreaterThanOrEqual(lastLogSeq);
      lastLogSeq = sim.logSeq;
      host.syncStructure();
      expect(ownStateView(sim), `hour ${hour}`).toBe(host.engine.stateView());
      expect(peopleOf(sim), `hour ${hour} people`).toStrictEqual(enginePeople(host.engine.crowdView()));
      if (sim.crowd.people.some((p) => p.originUnitId !== undefined || p.venueUnitId !== undefined)) routed = true;
      compared++;
    }
  }
  expect(compared).toBeGreaterThanOrEqual(24);
  // The day's crowd held round-trippers, so the routing fields were compared
  // on people that carry them as well as on commuters that carry none.
  if (expectRouted) expect(routed, "a round-tripper carrying its origin or venue unit").toBe(true);
  expect(host.frames).toBeGreaterThan(0);
  expect(host.merges).toBeGreaterThanOrEqual(24);
  host.detach();
}

describe.skipIf(!hasWasmPackage())("WASM host: the read model follows the engine", () => {
  for (const fixture of FIXTURES) {
    it(`${fixture} for a day at the fastest speed`, () => day(loadFixture(fixture), 3), 120_000);
  }
  it("the meal overlay revision moves at the frame the engine's does, between merges too", () => {
    // The renderer repaints rooms when the counter moves; a read model that
    // took it only at a merge would show a lunch dip up to an hour late.
    const sim = loadFixture(FIXTURES[0]);
    const host = attachWasmHost(sim, wasm());
    const driver = new FrameDriver(sim, 3);
    let engineRev = decodeFrame(host.engine.frameView()).header.mealOverlayRevision;
    let movedBetweenMerges = 0;
    const from = sim.clock.minutes;
    for (let frame = 0; sim.clock.minutes - from < DAY; frame++) {
      if (frame > 200_000) throw new Error(`the clock stalled at minute ${sim.clock.minutes}`);
      const before = { rev: sim.tower.mealOverlayRevision, merges: host.merges };
      driver.frame();
      const now = decodeFrame(host.engine.frameView()).header.mealOverlayRevision;
      const moved = sim.tower.mealOverlayRevision !== before.rev;
      expect(moved, `minute ${sim.clock.minutes}`).toBe(now !== engineRev);
      expect(sim.tower.mealOverlayRevision, "never steps back").toBeGreaterThanOrEqual(before.rev);
      if (moved && host.merges === before.merges) movedBetweenMerges++;
      engineRev = now;
    }
    expect(movedBetweenMerges, "a meal overlay change between merges").toBeGreaterThan(0);
    host.detach();
  }, 120_000);
  it("a new game of each mode", () => {
    day(Simulation.newGame(11, "classic"), 3, false); // an empty lot: nobody to route
    day(Simulation.newGame(12, "modern"), 3, false);
  }, 120_000);

  it("relays the host's edits and answers them as the TypeScript engine does", () => {
    const sim = Simulation.newGame(31, "classic");
    const host = attachWasmHost(sim, wasm());
    sim.money = 1e9;
    for (let x = 170; x < 200; x++) expect(sim.build("lobby", 1, x).ok).toBe(true);
    expect(sim.build("office", 2, 175).ok).toBe(true);
    expect(sim.buildTransport("stairs", 170, 1, 2).ok).toBe(true);
    expect(sim.build("office", 1, 175).ok).toBe(false);
    sim.tower.towerName = "Hosted";
    const office = sim.tower.units.find((u) => u.kind === "office")!;
    expect(sim.tower.setLabel(office.id, "  Corner  ")).toBe(true);
    sim.emit("a note from the host", "info");
    new FrameDriver(sim, 3).run(90);
    // The lines the instance logged for its own commands and the engine's
    // lines for the same commands make one log rather than two.
    expect(sim.log).toEqual((JSON.parse(host.engine.serialize()) as { log: unknown[] }).log);
    host.syncStructure();
    expect(ownStateView(sim)).toBe(host.engine.stateView());
    // The instance's save is the engine's.
    expect(canonicalJson(sim.serialize())).toBe(canonicalJson(JSON.parse(host.engine.serialize())));
    host.detach();
    // Detached, the instance is a plain TypeScript simulation again.
    expect(Object.getOwnPropertyDescriptor(sim, "serialize")).toBeUndefined();
    expect(Object.getOwnPropertyDescriptor(sim, "money")?.value).toBeDefined();
  });

  // The instance runs every command the engine runs, so both buffers fill;
  // the host must hand over the engine's batch and nothing of the instance's.
  // The same edits on an unhosted TypeScript engine are the count to match.
  it("drains each gameplay event once, from the engine, across attach and detach", () => {
    const edits = (sim: Simulation): void => {
      sim.money = 1e9;
      for (let x = 170; x < 200; x++) expect(sim.build("lobby", 1, x).ok).toBe(true);
      for (let x = 170; x < 200; x++) expect(sim.build("floor", 2, x).ok).toBe(true);
      expect(sim.build("office", 2, 180).ok).toBe(true);
      expect(sim.buildTransport("elevatorStandard", 172, 1, 2).ok).toBe(true);
      const shaft = sim.tower.transportAt(1, 172)!;
      expect(sim.setCars(shaft.id, 2)).toBe(true);
      expect(sim.setCars(shaft.id, 2)).toBe(false); // a no-op emits nothing
      const office = sim.tower.unitAt(2, 180)!;
      expect(sim.adjustRent(office.id, 1)).not.toBeNull();
      expect(sim.sellAt(2, 199)).toBe(true);
      sim.tick(120);
    };
    const plain = Simulation.newGame(41, "classic");
    edits(plain);
    const want = plain.drainGameplayEvents();
    const placed = want.filter((e) => e.name === "facility_placed").length;
    expect(placed).toBe(62);
    expect(want.filter((e) => e.name === "tower_founded")).toHaveLength(1);

    const sim = Simulation.newGame(41, "classic");
    const host = attachWasmHost(sim, wasm());
    edits(sim);
    // The founding (before the host attached) and the engine's batch, once.
    expect(sim.drainGameplayEvents()).toEqual(want);
    expect(sim.drainGameplayEvents()).toEqual([]);
    expect(sim.gameplayEventsDropped).toBe(0);
    // Events the engine emitted after the last drain go back to the
    // instance when the host lets go, still once.
    expect(sim.build("office", 2, 190).ok).toBe(true);
    const kept = sim.drainGameplayEvents; // a reference held across the detach
    host.detach();
    expect(Object.getOwnPropertyDescriptor(sim, "drainGameplayEvents")).toBeUndefined();
    expect(kept()).toEqual([{ name: "facility_placed", payload: { kind: "office", floor: 2, count: 1 } }]);
    expect(sim.drainGameplayEvents()).toEqual([]);
  });

  // A trap while a tower is let go is a fault like any other (#874): the
  // detach finishes without throwing, and the tower stays frozen on its
  // newest restore point.
  it("lets go of the instance when the engine can no longer answer at detach", () => {
    const sim = Simulation.newGame(42, "modern");
    const host = attachWasmHost(sim, wasm());
    sim.money = 1e9;
    for (let x = 170; x < 180; x++) expect(sim.build("lobby", 1, x).ok).toBe(true);
    // A trapped engine throws from every call.
    (host.engine as { drainGameplayEvents: () => string }).drainGameplayEvents = () => { throw new Error("unreachable executed"); };
    expect(() => host.detach()).not.toThrow();
    expect(host.fault).toMatchObject({ reason: "other", message: "the Rust engine failed while letting a tower go: unreachable executed" });
    expect(Object.getOwnPropertyDescriptor(sim, "drainGameplayEvents")).toBeUndefined();
    expect(Object.getOwnPropertyDescriptor(sim, "gameplayEventsDropped")).toBeUndefined();
    expect(Object.getOwnPropertyDescriptor(sim, "serialize")).toBeDefined(); // the restore point's
    const minutes = sim.clock.minutes;
    sim.tick(30);
    expect(sim.clock.minutes).toBe(minutes);
    // The founding, emitted before the host attached, is still owed. The ten
    // placements waited for a point that never came, so the fault drops them
    // with their commands: the fallback goes back to the attach save (#874).
    const kept = sim.drainGameplayEvents();
    expect(kept[0]).toEqual({ name: "tower_founded", payload: { mode: "modern" } });
    expect(kept.filter((e) => e.name === "facility_placed")).toHaveLength(0);
    expect(host.restore().sim.tower.units.filter((u) => u.kind === "lobby")).toHaveLength(0);
    expect(sim.gameplayEventsDropped).toBe(0);
    expect(() => host.engine.mode()).toThrow(); // let go: its handle is zeroed (#1113)
  });

  it("counts a batch it cannot read as dropped, while hosted and at detach", () => {
    const sim = Simulation.newGame(47, "classic");
    const host = attachWasmHost(sim, wasm());
    const engine = host.engine as { drainGameplayEvents: () => string };
    const real = engine.drainGameplayEvents.bind(engine);
    const garbled = () => real().slice(0, -1); // the engine's batch, cut short
    sim.money = 1e9;
    sim.drainGameplayEvents(); // the founding
    // Four placements whose batches arrive unreadable are lost, and counted.
    engine.drainGameplayEvents = garbled;
    for (let x = 170; x < 174; x++) expect(sim.build("lobby", 1, x).ok).toBe(true);
    expect(sim.drainGameplayEvents()).toEqual([]);
    expect(sim.gameplayEventsDropped).toBe(4);
    // The next batch reads again.
    engine.drainGameplayEvents = real;
    expect(sim.build("lobby", 1, 174).ok).toBe(true);
    expect(sim.drainGameplayEvents()).toEqual([]); // held until a point covers it (#874)
    sim.serialize();
    expect(sim.drainGameplayEvents()).toEqual([{ name: "facility_placed", payload: { kind: "lobby", floor: 1, count: 1 } }]);
    // At detach the instance keeps the count, two more included.
    engine.drainGameplayEvents = garbled;
    for (let x = 175; x < 177; x++) expect(sim.build("lobby", 1, x).ok).toBe(true);
    host.detach();
    expect(sim.drainGameplayEvents()).toEqual([]);
    expect(sim.gameplayEventsDropped).toBe(6);
  });

  it("keeps an unreadable batch's loss when the engine traps at detach, and drops the held events no point covered", () => {
    const sim = Simulation.newGame(48, "classic");
    const host = attachWasmHost(sim, wasm());
    const engine = host.engine as { drainGameplayEvents: () => string };
    const real = engine.drainGameplayEvents.bind(engine);
    sim.money = 1e9;
    sim.drainGameplayEvents(); // the founding
    engine.drainGameplayEvents = () => real().slice(0, -1);
    for (let x = 170; x < 173; x++) expect(sim.build("lobby", 1, x).ok).toBe(true);
    expect(sim.drainGameplayEvents()).toEqual([]); // three lost to unreadable batches
    engine.drainGameplayEvents = real;
    for (let x = 173; x < 175; x++) expect(sim.build("lobby", 1, x).ok).toBe(true);
    engine.drainGameplayEvents = () => {
      throw new Error("unreachable executed");
    };
    expect(() => host.detach()).not.toThrow();
    expect(host.fault?.reason).toBe("other");
    // The three counted while hosted. The two after them waited for a point
    // that never came, so the fault drops them with their commands (#874).
    expect(sim.drainGameplayEvents().filter((e) => e.name === "facility_placed")).toHaveLength(0);
    expect(sim.gameplayEventsDropped).toBe(3);
  });

  // A drain that traps freezes the host (#874). Nothing is counted as lost:
  // every event a restore point covers is handed back, and those of the
  // commands after it go with them, since the owner's fallback undoes them.
  it("freezes on a drain that traps and hands back every event a point covers", () => {
    const sim = Simulation.newGame(49, "classic");
    const host = attachWasmHost(sim, wasm());
    sim.money = 1e9;
    sim.drainGameplayEvents(); // the founding
    for (let x = 170; x < 173; x++) expect(sim.build("lobby", 1, x).ok).toBe(true);
    sim.tick(1); // a merge: the restore point
    for (let x = 173; x < 175; x++) expect(sim.build("lobby", 1, x).ok).toBe(true);
    (host.engine as { drainGameplayEvents: () => string }).drainGameplayEvents = () => {
      throw new Error("unreachable executed");
    };
    const drained = sim.drainGameplayEvents();
    expect(drained.filter((e) => e.name === "facility_placed")).toHaveLength(3);
    expect(host.fault?.reason).toBe("trap-tick");
    expect(() => host.detach()).not.toThrow();
    expect(sim.drainGameplayEvents()).toEqual([]);
    expect(sim.gameplayEventsDropped).toBe(0);
    // The fallback's tower has the three, without the two built after.
    const fresh = host.restore().sim;
    expect(fresh.tower.units.filter((u) => u.kind === "lobby")).toHaveLength(3);
    expect(() => host.engine.mode()).toThrow(); // let go by the detach (#1113)
  });

  // A paused player builds, then undoes before anything drains: the app swaps
  // in the restored tower and the host follows it. The events the engine
  // still owed reach the restored tower ahead of its own, once; the
  // abandoned instance keeps none.
  it("hands the events still owed to the tower that replaces it", () => {
    const sim = Simulation.newGame(45, "classic");
    sim.money = 1e9;
    for (let x = 170; x < 200; x++) expect(sim.build("lobby", 1, x).ok).toBe(true);
    sim.drainGameplayEvents();
    const app = {
      sim,
      adoptSim(next: Simulation) {
        next.gameplayEvents.inherit(this.sim.gameplayEvents); // as GameApp.adoptSim does
        this.sim = next;
      },
    };
    const handle = startWasmHost(app, wasm(), { info: () => {}, error: () => {} });
    const snapshot = JSON.stringify(sim.serialize());
    for (let x = 170; x < 180; x++) expect(sim.build("floor", 2, x).ok).toBe(true);
    const restored = Simulation.deserialize(JSON.parse(snapshot));
    expect(restored.build("office", 2, 190).ok).toBe(true); // the restored tower's own, after the swap's
    app.adoptSim(restored);
    expect(handle.status).toMatchObject({ starts: 2, hosted: true, errors: [] });
    const events = restored.drainGameplayEvents();
    expect(events).toHaveLength(11);
    expect(events.slice(0, 10).every((e) => e.name === "facility_placed" && e.payload.kind === "floor")).toBe(true);
    expect(events[10]).toEqual({ name: "facility_placed", payload: { kind: "office", floor: 2, count: 1 } });
    expect(sim.drainGameplayEvents()).toEqual([]);
    expect(restored.gameplayEventsDropped).toBe(0);
    handle.stop();
  });

  // A merge copies the fresh deserialization's empty buffer; the host puts
  // the instance's own back, so its mark (a title backdrop's) survives the
  // hour pass.
  it("keeps the instance's own buffer across a merge", () => {
    const sim = Simulation.newGame(46, "classic");
    const buffer = sim.gameplayEvents;
    buffer.discardOnHandOff = true;
    const host = attachWasmHost(sim, wasm());
    sim.money = 1e9;
    expect(sim.build("lobby", 1, 180).ok).toBe(true);
    host.syncStructure();
    expect(host.merges).toBeGreaterThan(0);
    expect(sim.gameplayEvents).toBe(buffer);
    expect(buffer.discardOnHandOff).toBe(true);
    // The merge moved the engine's placement behind the host, as the newest
    // restore point (#874), and dropped the read model's copy of it.
    expect(buffer.length).toBe(0);
    expect(sim.drainGameplayEvents().filter((e) => e.name === "facility_placed")).toHaveLength(1);
    host.detach();
  });

  it("puts back an own drain the instance had before the host", () => {
    const sim = Simulation.newGame(44, "classic");
    const own = () => [];
    Object.defineProperty(sim, "drainGameplayEvents", { value: own, configurable: true, writable: true });
    const host = attachWasmHost(sim, wasm());
    expect(sim.drainGameplayEvents).not.toBe(own);
    host.detach();
    expect(sim.drainGameplayEvents).toBe(own);
  });

  it("leaves the instance's events alone when it refuses to attach", () => {
    const sim = Simulation.newGame(43, "classic");
    const detachMirror = attachMirror(sim, () => {});
    expect(() => attachWasmHost(sim, wasm())).toThrow(/already attached/);
    detachMirror();
    expect(sim.drainGameplayEvents()).toEqual([{ name: "tower_founded", payload: { mode: "classic" } }]);
  });

  it("refuses a tower whose crowd already exists", () => {
    const sim = loadFixture("conformance/fixtures/towerone-star4.vctower");
    sim.tick(60);
    expect(sim.crowd.people.length).toBeGreaterThan(0);
    expect(() => attachWasmHost(sim, wasm())).toThrow(/crowd/);
    expect(Object.getOwnPropertyDescriptor(sim, "money")?.value).toBeDefined();
  });
});
