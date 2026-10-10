import { describe, expect, it } from "vitest";
import { Simulation } from "../../engine/Simulation";
import type { Person } from "../../engine/crowd/person";
import { canonicalJson } from "../../engine/canonicalJson";
import { stateView } from "../../engine/conformanceView";
import { attachWasmHost } from "../../wasmhost/wasmHost";
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

  it("charges and refunds the priced editor commands inside the engine (#914)", () => {
    const sim = Simulation.newGame(32, "classic");
    const host = attachWasmHost(sim, wasm());
    sim.money = 1e9;
    for (let x = 170; x < 200; x++) expect(sim.build("lobby", 1, x).ok).toBe(true);
    for (let f = 2; f <= 3; f++) for (let x = 170; x < 200; x++) expect(sim.build("floor", f, x).ok).toBe(true);
    expect(sim.build("office", 2, 175).ok).toBe(true);
    expect(sim.buildTransport("elevatorStandard", 190, 1, 2).ok).toBe(true);
    const t = sim.tower.transportAt(1, 190)!;
    const office = sim.tower.unitAt(2, 175)!;
    // No money write reaches the engine from here on: each command moves it.
    const setMoney = host.engine.setMoney.bind(host.engine);
    let writes = 0;
    host.engine.setMoney = (amount: number) => { writes++; setMoney(amount); };
    const before = host.engine.money();
    expect(sim.addCar(t.id).ok).toBe(true);
    expect(host.engine.money()).toBe(before - 40_000);
    expect(sim.money).toBe(before - 40_000);
    expect(sim.removeCar(t.id).ok).toBe(true);
    expect(host.engine.money()).toBe(before - 20_000);
    expect(sim.extendTransport(t.id, "up", 3).ok).toBe(true);
    expect(host.engine.money()).toBe(before - 25_000);
    expect(sim.sell(office.id).ok).toBe(true);
    expect(sim.sell(t.id).ok).toBe(true);
    expect(writes).toBe(0);
    expect(host.engine.money()).toBe(sim.money);
    host.syncStructure();
    expect(ownStateView(sim)).toBe(host.engine.stateView());
    // A refused add answers the same on both engines and moves nothing.
    expect(sim.buildTransport("elevatorStandard", 196, 1, 2).ok).toBe(true);
    const second = sim.tower.transportAt(1, 196)!;
    sim.money = 39_999;
    expect(sim.addCar(second.id)).toEqual({ ok: false, reason: "Not enough money.", delta: 0 });
    expect(host.engine.money()).toBe(39_999);
    expect((JSON.parse(host.engine.transportAt(1, 196)!) as { cars: number }).cars).toBe(1);
    host.detach();
  });

  it("refuses a tower whose crowd already exists", () => {
    const sim = loadFixture("src/tests/fixtures/towerone-star4.vctower");
    sim.tick(60);
    expect(sim.crowd.people.length).toBeGreaterThan(0);
    expect(() => attachWasmHost(sim, wasm())).toThrow(/crowd/);
    expect(Object.getOwnPropertyDescriptor(sim, "money")?.value).toBeDefined();
  });
});
