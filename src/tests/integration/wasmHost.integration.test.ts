import { describe, expect, it } from "vitest";
import { Simulation } from "../../engine/Simulation";
import type { Person } from "../../engine/crowd/person";
import { canonicalJson } from "../../engine/canonicalJson";
import { stateView } from "../../engine/conformanceView";
import { attachWasmHost } from "../../wasmhost/wasmHost";
import { attachMirror } from "../../dualrun/mirror";
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
 *  same shape, with the optional flags read as false when absent. */
type FramePerson = Pick<Person, "id" | "seed" | "state" | "floor" | "x" | "fy" | "wait" | "originFloor" | "originUnitId" | "venueUnitId" | "mealVenueId" | "routine" | "dwellSecondsLeft" | "floors" | "shafts"> & {
  staff: boolean;
  countedHotelGuest: boolean;
  returning: boolean;
};

function framePerson(p: Person): FramePerson {
  return {
    id: p.id, seed: p.seed, state: p.state, floor: p.floor, x: p.x, fy: p.fy, wait: p.wait, staff: p.staff ?? false,
    originFloor: p.originFloor, originUnitId: p.originUnitId, venueUnitId: p.venueUnitId, mealVenueId: p.mealVenueId,
    countedHotelGuest: p.countedHotelGuest ?? false, routine: p.routine, returning: p.returning ?? false, dwellSecondsLeft: p.dwellSecondsLeft,
    floors: p.floors, shafts: p.shafts,
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
      expect(peopleOf(sim), `hour ${hour} people`).toEqual(enginePeople(host.engine.crowdView()));
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
      expect(sim.tower.setCars(shaft.id, 2)).toBe(true);
      expect(sim.tower.setCars(shaft.id, 2)).toBe(false); // a no-op emits nothing
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

  it("lets go of the instance when the engine can no longer answer at detach", () => {
    const sim = Simulation.newGame(42, "modern");
    const host = attachWasmHost(sim, wasm());
    sim.money = 1e9;
    for (let x = 170; x < 180; x++) expect(sim.build("lobby", 1, x).ok).toBe(true);
    // A trapped engine throws from every call.
    (host.engine as { drainGameplayEvents: () => string }).drainGameplayEvents = () => { throw new Error("unreachable executed"); };
    expect(() => host.detach()).toThrow(/unreachable/);
    expect(Object.getOwnPropertyDescriptor(sim, "drainGameplayEvents")).toBeUndefined();
    expect(Object.getOwnPropertyDescriptor(sim, "gameplayEventsDropped")).toBeUndefined();
    expect(Object.getOwnPropertyDescriptor(sim, "serialize")).toBeUndefined();
    // The founding, emitted before the host attached, is still owed; the read
    // model's duplicate placements are not.
    expect(sim.drainGameplayEvents()).toEqual([{ name: "tower_founded", payload: { mode: "modern" } }]);
    expect(sim.gameplayEventsDropped).toBe(0);
    expect(() => host.engine.mode()).toThrow(); // freed
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
    const sim = loadFixture("src/tests/fixtures/towerone-star4.vctower");
    sim.tick(60);
    expect(sim.crowd.people.length).toBeGreaterThan(0);
    expect(() => attachWasmHost(sim, wasm())).toThrow(/crowd/);
    expect(Object.getOwnPropertyDescriptor(sim, "money")?.value).toBeDefined();
  });
});
