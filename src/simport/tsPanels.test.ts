import { describe, expect, it } from "vitest";
import { Simulation } from "../engine/Simulation";
import { MILESTONES } from "../engine/milestones";
import { cumulativeStarGates } from "../engine/sim/star";
import { MID, lay, mustBuild, newSeededGame, placeUnit } from "../tests/fixtures/towerFixtures";
import { ONBOARD_STEPS } from "../ui/Onboarding";
import {
  tsFloorHeatmap,
  tsHousekeepingCoverage,
  tsOnboardingFacts,
  tsPeakCongestionHotspot,
  tsStatsReport,
  tsTowerStats,
  tsTransportDetail,
  tsUnitDetail,
} from "./tsPanels";
import { createTsSim } from "./tsSim";

/**
 * The TypeScript adapter's panel answers against the `Simulation` functions
 * the panels called before the port: each field mapped as the Rust getter
 * answers it (undefined to null, star gates and milestones by id), and every
 * answer plain JSON, with each answer's keys as the Rust getter writes them.
 * The cross-engine comparison is the getters' differential, which 6b's held
 * wrapper commit brings and points at this module.
 */

const json = (v: unknown): unknown => JSON.parse(JSON.stringify(v));

/** Plain JSON, as a parsed engine answer is: a strict equal tells an
 *  undefined field and a class instance apart from the parsed copy. */
function expectJson(v: unknown, what?: string): void {
  expect(json(v), what).toStrictEqual(v);
}

/** The keys of each answer and of each object inside it, as the Rust getters
 *  write them (copied from `engine-rs/src/panels/*.rs` at 6b's merge,
 *  b80bc03; the getters' differential compares the values). The types alone
 *  would let an extra engine field ride along unnoticed. */
const KEYS = {
  towerStats: "basements condos dirty elevators fires floors hotelRooms money occupiedHotel occupiedOffices offices parkingSpaces population restaurants shops soldCondos star transports vacant vacantNoRate",
  statsReport: "elevators exterminationDueDay functionalParking hotelsCountTowardRating households housekeeping housekeepingReport income milestones nextStar nextStarThreshold parkingDemand ratingPopulation recycling stats strandedFloors vipFavorable vipVisits",
  housekeeping: "crews dailyCapacity dirty infested maids outOfReach rooms",
  unitDetail: "blockbuster customersIn everOccupied filmPolicy floor floorHasLobby id kind label noRate occupants price reachable rent residents satisfaction served state subtype vacateReason width x",
  transportDetail: "bottom capacity cars hourly id kind origins stops top utilization width x",
  parkingDemand: "officePop offices suites total",
  recycling: "capacity demandMet",
  housekeepingReport: "cleaned leftover",
  nextStar: "allMet gates isTower popHave popMet popNeed star",
  gate: "id met",
  milestones: "achieved list total",
  milestone: "done id",
  income: "averages hasData",
  households: "households mix residents",
  elevator: "bottom capacity cars id kind top utilization",
  heatCell: "floor maxX minX severity",
  hotspot: "floor ratio",
  onboarding: "connect floor lobby office play",
  stop: "endpoint floor lobby served",
  week: "weekday weekend",
};
const keysOf = (v: object): string => Object.keys(v).sort().join(" ");

/** Every object and array inside an answer, the answer itself included. */
function objectsIn(v: unknown, into = new Set<object>()): Set<object> {
  if (v !== null && typeof v === "object") {
    into.add(v);
    for (const child of Object.values(v)) objectsIn(child, into);
  }
  return into;
}

/** A Classic tower with a lobby, floors 2 to 9, an elevator to floor 2, and a
 *  stair chain from there to floor 8: floor 8 is served but six flights past
 *  the elevator, beyond Classic's walk budget, so its occupied office is
 *  stranded, and floor 9 has no connection at all. Floor 2 holds an occupied
 *  office, a cinema and an infested hotel room. */
function classicTower(): Simulation {
  const sim = newSeededGame(11, "classic");
  sim.money = 1e9;
  lay(sim, "lobby", 1);
  for (let f = 2; f <= 9; f++) lay(sim, "floor", f);
  mustBuild(sim, "elevatorStandard", MID, 1, 2);
  for (let f = 2; f < 8; f++) mustBuild(sim, "stairs", MID + 60, f, f + 1);
  const office = placeUnit(sim, "office", 2, MID + 6);
  office.state = "occupied";
  placeUnit(sim, "office", 8, MID + 6).state = "occupied";
  placeUnit(sim, "office", 9, MID + 6);
  placeUnit(sim, "cinema", 2, MID - 30);
  placeUnit(sim, "hotelSingle", 2, MID + 20).state = "infested";
  sim.achievedMilestones.add(MILESTONES[0].id);
  return sim;
}

/** A Modern tower with condos and a rental apartment holding households of
 *  different sizes, one condo off the market. */
function modernTower(): Simulation {
  const sim = newSeededGame(12, "modern");
  sim.money = 1e9;
  lay(sim, "lobby", 1);
  lay(sim, "floor", 2);
  mustBuild(sim, "elevatorStandard", MID, 1, 2);
  const occupy = (kind: "condo" | "rentalApartment", x: number, size: number) => {
    const u = placeUnit(sim, kind, 2, x);
    u.state = "occupied";
    u.everOccupied = true;
    u.residents = size;
    return u;
  };
  occupy("condo", MID + 6, 4);
  occupy("condo", MID + 26, 2);
  occupy("rentalApartment", MID - 30, 4);
  placeUnit(sim, "condo", 2, MID - 50).noRate = true;
  return sim;
}

describe("tsPanels answers", () => {
  for (const [name, make] of [
    ["classic", classicTower],
    ["modern", modernTower],
  ] as const) {
    it(`${name}: the stats report reads the functions the stats screen called`, () => {
      const sim = make();
      for (let i = 0; i < 24 * 60; i++) sim.tick(1);
      const r = tsStatsReport(sim);
      expectJson(r);
      expect(keysOf(r)).toBe(KEYS.statsReport);
      expect(keysOf(r.stats)).toBe(KEYS.towerStats);
      expect(keysOf(r.housekeeping)).toBe(KEYS.housekeeping);
      expect(keysOf(r.parkingDemand)).toBe(KEYS.parkingDemand);
      expect(keysOf(r.recycling)).toBe(KEYS.recycling);
      expect(keysOf(r.housekeepingReport!)).toBe(KEYS.housekeepingReport);
      expect(keysOf(r.nextStar!)).toBe(KEYS.nextStar);
      expect(keysOf(r.milestones)).toBe(KEYS.milestones);
      for (const m of r.milestones.list) expect(keysOf(m)).toBe(KEYS.milestone);
      expect(keysOf(r.income)).toBe(KEYS.income);
      expect(keysOf(r.households)).toBe(KEYS.households);
      expect(r.elevators.length).toBeGreaterThan(0);
      for (const e of r.elevators) expect(keysOf(e)).toBe(KEYS.elevator);
      expect(r.stats).toEqual(sim.stats());
      expect(tsTowerStats(sim)).toEqual(sim.stats());
      expect(r.ratingPopulation).toBe(sim.ratingPopulation());
      expect(r.functionalParking).toBe(sim.tower.functionalParkingSet().size);
      expect(r.housekeeping).toEqual(sim.housekeepingCoverage());
      expect(tsHousekeepingCoverage(sim)).toEqual(sim.housekeepingCoverage());
      expect(r.housekeepingReport).toEqual(sim.economy.housekeepingReport());
      expect(r.recycling).toEqual({ capacity: sim.recyclingCapacity(), demandMet: sim.recyclingDemandMet() });
      expect(r.strandedFloors).toEqual(sim.strandedFloors());
      expect(r.nextStarThreshold).toBe(sim.nextStarThreshold);
      expect(r.income).toEqual(sim.incomeBreakdown());
      expect(r.elevators).toEqual(sim.elevatorStats());
      expect(r.exterminationDueDay).toBe(sim.exterminationDueDay ?? null);
      expect(r.milestones.list.map((m) => m.id)).toEqual(MILESTONES.map((m) => m.id));
      expect(r.milestones.list.map((m) => m.done)).toEqual(sim.milestoneProgress().list.map((m) => m.done));
      expect(r.milestones.achieved).toBe(sim.milestoneProgress().achieved);
      const next = sim.nextStarRequirements()!;
      expect(r.nextStar).toEqual({ ...next, gates: next.gates.map((g) => ({ id: g.id, met: g.met })) });
    });
  }

  it("counts households in residence by size: condos and rental apartments, off-market and empty homes left out", () => {
    const r = tsStatsReport(modernTower());
    expect(r.households).toEqual({ households: 3, residents: 10, mix: [[2, 1], [4, 2]] });
    expect(tsStatsReport(classicTower()).households).toEqual({ households: 0, residents: 0, mix: [] });
  });

  it("names the stranded floor, and counts the infested room the fixture leaves", () => {
    const r = tsStatsReport(classicTower());
    expect(r.strandedFloors).toEqual([8]);
    expect(r.housekeeping.infested).toBe(1);
  });

  it("answers null for the TOWER rung's next star and threshold, and an unbooked exterminator", () => {
    const sim = classicTower();
    sim.star = 6;
    expect(tsStatsReport(sim).nextStar).toBeNull();
    expect(tsStatsReport(sim).nextStarThreshold).toBeNull();
    expect(tsStatsReport(sim).exterminationDueDay).toBeNull();
    sim.exterminationDueDay = 9;
    expect(tsStatsReport(sim).exterminationDueDay).toBe(9);
  });

  it("names each star gate by the id the Rust getter answers", () => {
    const sim = classicTower();
    expect(cumulativeStarGates(sim, 5).map((g) => g.id)).toEqual(["security", "medical", "recycling", "suites", "vip", "metro"]);
    sim.star = 5;
    expect(tsStatsReport(sim).nextStar!.gates.map((g) => g.id)).toEqual(["weddingHall", "metro"]);
  });

  it("answers each rung's gates as the engine meets them, met and unmet alike", () => {
    const sim = classicTower();
    placeUnit(sim, "security", 3, MID + 6).state = "occupied";
    const metAt: Record<number, boolean[]> = {};
    for (const star of [1, 2, 3, 4, 5]) {
      sim.star = star;
      const next = sim.nextStarRequirements()!;
      const answer = tsStatsReport(sim).nextStar!;
      expect(answer, `${star} stars`).toEqual({ ...next, gates: next.gates.map((g) => ({ id: g.id, met: g.met })) });
      for (const g of answer.gates) expect(keysOf(g)).toBe(KEYS.gate);
      metAt[star] = answer.gates.map((g) => g.met);
    }
    // The security office meets the three-star gate; the four-star rung's
    // medical center is missing.
    expect([metAt[2], metAt[3].slice(0, 2)]).toEqual([[true], [true, false]]);
  });

  it("builds a new answer on every call, so a caller may keep one", () => {
    const sim = classicTower();
    for (let i = 0; i < 24 * 60; i++) sim.tick(1);
    const unit = sim.tower.units.find((u) => u.kind === "office")!;
    const shaft = sim.tower.transports.find((t) => t.kind === "elevatorStandard")!;
    const answers: Array<[string, () => unknown]> = [
      ["towerStats", () => tsTowerStats(sim)],
      ["statsReport", () => tsStatsReport(sim)],
      ["housekeepingCoverage", () => tsHousekeepingCoverage(sim)],
      ["unitDetail", () => tsUnitDetail(sim, unit.id)],
      ["transportDetail", () => tsTransportDetail(sim, shaft.id)],
      ["floorHeatmap", () => tsFloorHeatmap(sim, "cleanliness")],
      ["peakCongestionHotspot", () => tsPeakCongestionHotspot(sim)],
      ["onboardingFacts", () => tsOnboardingFacts(sim)],
    ];
    for (const [name, answer] of answers) {
      const first = objectsIn(answer());
      const shared = [...objectsIn(answer())].filter((o) => first.has(o));
      expect(shared, name).toEqual([]);
    }
  });

  it("builds the unit card from the unit and the engine's derived flags, null where the field is absent", () => {
    const sim = classicTower();
    for (const u of sim.tower.units.filter((q) => q.kind !== "floor" && q.kind !== "lobby")) {
      const card = tsUnitDetail(sim, u.id)!;
      expectJson(card, `unit ${u.id}`);
      expect(keysOf(card)).toBe(KEYS.unitDetail);
      expect(card).toMatchObject({ id: u.id, kind: u.kind, floor: u.floor, state: u.state, label: u.label, satisfaction: u.satisfaction });
      expect(card.served).toBe(sim.tower.isFloorServed(u.floor));
      expect(card.reachable).toBe(sim.floorReachable(u.floor));
      expect(card.floorHasLobby).toBe(sim.tower.floorHasLobby(u.floor));
      expect(card.blockbuster).toBe(u.kind === "cinema" ? sim.isShowingBlockbuster(u.id) : null);
      expect(card.subtype).toBe(u.subtype ?? null);
      expect(card.residents).toBe(u.residents ?? null);
    }
    const stranded = sim.tower.units.find((u) => u.kind === "office" && u.floor === 8)!;
    expect(tsUnitDetail(sim, stranded.id)).toMatchObject({ served: true, reachable: false });
    const unconnected = sim.tower.units.find((u) => u.kind === "office" && u.floor === 9)!;
    expect(tsUnitDetail(sim, unconnected.id)).toMatchObject({ served: false, reachable: false });
    expect(tsUnitDetail(sim, 0)).toBeNull();
  });

  it("prices an off-market unit at zero and a household's condo at its set price", () => {
    const sim = modernTower();
    const offMarket = sim.tower.units.find((u) => u.kind === "condo" && u.noRate)!;
    expect(tsUnitDetail(sim, offMarket.id)).toMatchObject({ noRate: true, price: 0, rent: null, everOccupied: false });
    const sold = sim.tower.units.find((u) => u.kind === "condo" && u.residents === 4)!;
    sold.rent = 123_000;
    expect(tsUnitDetail(sim, sold.id)).toMatchObject({ price: 123_000, rent: 123_000, residents: 4, everOccupied: true });
  });

  it("builds the shaft card with capacity, telemetry and the stop list, top first", () => {
    const sim = classicTower();
    for (let i = 0; i < 24 * 60; i++) sim.tick(1);
    const t = sim.tower.transports[0];
    const card = tsTransportDetail(sim, t.id)!;
    expectJson(card);
    expect(keysOf(card)).toBe(KEYS.transportDetail);
    expect(card.hourly).not.toBeNull();
    expect(card.origins!.weekday.some((slot) => slot.length > 0)).toBe(true);
    expect(card.capacity).toBe(sim.transportCapacity(t));
    expect(card.utilization).toBe(sim.elevatorUtilization(t.id) ?? null);
    expect(card.hourly).toEqual(sim.elevatorHourlyLoad(t.id) ?? null);
    const origins = sim.elevatorOriginLoad(t.id)!;
    expect(card.origins!.weekday).toEqual(origins.weekday.map((m) => [...m.entries()]));
    expect(card.stops).toEqual([
      { floor: 2, served: sim.tower.stopsAt(t, 2), lobby: false, endpoint: true },
      { floor: 1, served: sim.tower.stopsAt(t, 1), lobby: true, endpoint: true },
    ]);
    for (const stop of card.stops) expect(keysOf(stop)).toBe(KEYS.stop);
    expect([keysOf(card.hourly!), keysOf(card.origins!)]).toEqual([KEYS.week, KEYS.week]);
    expect(tsTransportDetail(sim, -1)).toBeNull();
    const stairs = sim.tower.transports.find((q) => q.kind === "stairs")!;
    expect(tsTransportDetail(sim, stairs.id)).toMatchObject({ kind: "stairs", stops: [] });
  });

  it("reads the overlays and the hotspot from the engine functions", () => {
    const sim = classicTower();
    for (let i = 0; i < 9 * 60; i++) sim.tick(1);
    for (const mode of ["congestion", "occupancy", "satisfaction", "cleanliness"] as const) {
      const cells = tsFloorHeatmap(sim, mode);
      expectJson(cells, mode);
      expect(cells).toEqual(sim.floorHeatmap(mode));
      expect(cells.length, mode).toBeGreaterThan(0);
      for (const cell of cells) expect(keysOf(cell), mode).toBe(cell.tint === undefined ? KEYS.heatCell : `${KEYS.heatCell} tint`);
    }
    // The infested room carries the overlay's tint, the one optional field.
    expect(tsFloorHeatmap(sim, "cleanliness").some((c) => c.tint === "infested")).toBe(true);
    const hotspot = tsPeakCongestionHotspot(sim);
    expectJson(hotspot);
    expect(keysOf(hotspot)).toBe(KEYS.hotspot);
    expect(hotspot).toEqual(sim.peakCongestionHotspot());
  });

  it("states the onboarding facts the Getting Started steps check, at every step", () => {
    const sim = Simulation.newGame(5, "classic");
    const agree = () => {
      const facts = tsOnboardingFacts(sim);
      for (const step of ONBOARD_STEPS) expect(facts[step.id as keyof typeof facts], step.id).toBe(step.done(sim));
    };
    agree();
    for (let x = MID - 10; x < MID + 10; x++) sim.tower.place("lobby", 1, x);
    agree();
    for (let x = MID - 10; x < MID + 10; x++) sim.tower.place("floor", 2, x);
    agree();
    const office = placeUnit(sim, "office", 2, MID);
    agree();
    sim.money = 1e9;
    mustBuild(sim, "elevatorStandard", MID - 8, 1, 2);
    agree();
    office.state = "occupied";
    agree();
    expect(tsOnboardingFacts(sim)).toEqual({ lobby: true, floor: true, office: true, connect: true, play: true });
    expect(keysOf(tsOnboardingFacts(sim))).toBe(KEYS.onboarding);
  });

  it("states the onboarding facts as the steps do off the usual order", () => {
    const sim = Simulation.newGame(6, "classic");
    const agree = (what: string) => {
      const facts = tsOnboardingFacts(sim);
      for (const step of ONBOARD_STEPS) expect(facts[step.id as keyof typeof facts], `${what}: ${step.id}`).toBe(step.done(sim));
    };
    for (let x = MID - 10; x < MID + 10; x++) sim.tower.place("lobby", 1, x);
    // A basement story is a floor tile below the lobby: no "floor" step yet.
    for (let x = MID - 10; x < MID + 10; x++) expect(sim.tower.place("floor", 0, x).ok, `basement floor at ${x}`).toBe(true);
    agree("a basement only");
    expect(tsOnboardingFacts(sim).floor).toBe(false);
    // An occupied office with no lobby connection: played, never connected.
    for (let x = MID - 10; x < MID + 10; x++) sim.tower.place("floor", 2, x);
    placeUnit(sim, "office", 2, MID).state = "occupied";
    agree("an unconnected tenant");
    expect(tsOnboardingFacts(sim)).toMatchObject({ connect: false, play: true });
  });
});

describe("TsSim's header", () => {
  it("carries the founding mode and calendar as the save stores them", () => {
    const classic = Simulation.newGame(1, "classic", "canon");
    expect(createTsSim(() => classic).view.header).toMatchObject({ mode: "classic", modernCalendar: classic.modernCalendar });
    expect(classic.modernCalendar).toBe("realWorld"); // Classic clamps it; its clock still runs canon
    const modern = Simulation.newGame(1, "modern", "canon");
    expect(createTsSim(() => modern).view.header).toMatchObject({ mode: "modern", modernCalendar: "canon" });
  });
});
