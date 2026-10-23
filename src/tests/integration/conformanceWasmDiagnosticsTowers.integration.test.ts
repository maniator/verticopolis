import { describe, it, expect } from "vitest";
import { Simulation } from "../../engine/Simulation";
import { GRID } from "../../engine/facilities";
import { rentConfig } from "../../engine/econConfig";
import type { SerializedGame } from "../../engine/serializedGame";
import type { FacilityKind, GameMode, Unit, UnitState } from "../../engine/types";
import { hasWasmPackage, wasm, wasmRequired } from "../conformance/wasmEngine";
import { tsDiagnosticFacts, type DiagnosticFacts } from "../diagnostics/tsDiagnosticFacts";
import { inspectorDisagreements } from "../diagnostics/inspectorAgreement";

/**
 * The diagnostics facts (#1215) on constructed towers, for the branches the
 * conformance corpus never reaches (`conformanceWasmDiagnostics` runs the
 * corpus): a served floor with no route to the lobby, a room off the market,
 * the sky lobby slot that needs clearing or that the unit sits on, a sinking
 * room's slot, no slot at all, the stairs binding with and without an
 * elevator stop and the elevator binding, a nightclub's halo,
 * and unmet demand at zero and partial coverage and on a floor no rider
 * reaches. Each tower is built on the TypeScript engine, saved, and loaded
 * into both engines; every room's facts must agree, the inspector card must
 * show the lines they carry (`inspectorAgreement`), and the case's own
 * section must be there, so a tower that drifts from its recipe fails rather
 * than comparing two empty answers. The last two cases check that the card
 * check catches a wrong fact, and hold the binding's answers for ids that
 * name no unit beside one that does.
 */

if (wasmRequired() && !hasWasmPackage()) throw new Error("VC_REQUIRE_WASM=1 but engine-rs/pkg/ is not built; run npm run wasm:build");

const W = GRID.width;
const C = Math.floor(W / 2);

function expectOk<T extends { ok: boolean; reason?: string }>(r: T): T {
  expect(r.ok, r.reason).toBe(true);
  return r;
}

/** Lay a full story outward from the center; tiles already of `kind` stay. */
function lay(sim: Simulation, kind: "floor" | "lobby", floor: number): void {
  const put = (x: number): void => {
    if (sim.tower.structureKindAt(floor, x) === kind) return;
    expectOk(sim.tower.place(kind, floor, x));
  };
  for (let x = C; x < W; x++) put(x);
  for (let x = C - 1; x >= 0; x--) put(x);
}

function room(sim: Simulation, kind: FacilityKind, floor: number, x: number, state: UnitState = "occupied", satisfaction = 1): Unit {
  const r = expectOk(sim.tower.place(kind, floor, x));
  const u = sim.tower.getUnit(r.unitId!)!;
  u.state = state;
  u.satisfaction = satisfaction;
  if (state !== "empty") u.everOccupied = true;
  return u;
}

/** A tower with the ground lobby and floor slabs on 2..=top. */
function slabs(mode: GameMode, top: number): Simulation {
  const sim = Simulation.newGame(11, mode);
  sim.money = 1e12;
  sim.star = 5;
  lay(sim, "lobby", 1);
  for (let f = 2; f <= top; f++) lay(sim, "floor", f);
  return sim;
}

/** Save the tower, load it into both engines, compare every room's facts,
 *  check them against the card and return the TypeScript ones by unit id. */
function compare(sim: Simulation): Map<number, DiagnosticFacts> {
  const text = JSON.stringify(sim.serialize());
  const ts = Simulation.deserialize(JSON.parse(text) as SerializedGame);
  const handle = wasm().Engine.fromSave(text);
  const out = new Map<number, DiagnosticFacts>();
  try {
    // The card runs beside the facts here, where the corpus runs it apart:
    // nothing moves between reads, so whichever read fills the demand memo
    // first, every read sees the same map.
    for (const u of ts.tower.units) {
      if (u.kind === "floor" || u.kind === "lobby") continue;
      const want = tsDiagnosticFacts(ts, u);
      const text = handle.diagnosticFacts(u.id);
      expect(text, `unit ${u.id}`).toBeDefined();
      expect(JSON.parse(text!) as DiagnosticFacts, `unit ${u.id} (${u.kind} on ${u.floor})`).toEqual(want);
      expect(inspectorDisagreements(ts, u, want), `unit ${u.id} (${u.kind} on ${u.floor})`).toEqual([]);
      out.set(u.id, want);
    }
  } finally {
    handle.free();
  }
  return out;
}

describe.skipIf(!hasWasmPackage())("diagnostics facts on constructed towers", () => {
  it("reads a ground-connected floor no rider can reach", () => {
    const sim = slabs("modern", 4);
    // Floor 5 is split by a gap at C-10..C+10, and floors 6..8 stand on its
    // right half. One elevator climbs 1..5 on the left, another 5..8 on the
    // right: floor 7 is ground-connected floor by floor, but no rider can
    // walk the gap between the two shafts.
    for (let x = 0; x < C - 10; x++) expectOk(sim.tower.place("floor", 5, x));
    for (const f of [5, 6, 7, 8]) for (let x = C + 10; x < W; x++) expectOk(sim.tower.place("floor", f, x));
    expectOk(sim.buildTransport("elevatorStandard", 20, 1, 5));
    expectOk(sim.buildTransport("elevatorStandard", W - 30, 5, 8));
    const stranded = room(sim, "office", 7, C + 30);
    expect(compare(sim).get(stranded.id)?.access).toBe("noRoute");
  });

  it("reads a room off the market", () => {
    const sim = slabs("classic", 3);
    expectOk(sim.buildTransport("elevatorStandard", C, 1, 3));
    const off = room(sim, "office", 2, C + 6, "empty");
    off.noRate = true;
    expect(compare(sim).get(off.id)?.noRate).toBe("offMarket");
  });

  it("names the slot to clear, and the unit sitting on it", () => {
    const sim = slabs("modern", 16);
    expectOk(sim.buildTransport("elevatorStandard", C, 1, 16));
    sim.tower.setCars(sim.tower.transports[0]!.id, 8);
    const below = room(sim, "office", 12, 10);
    const on = room(sim, "office", 15, 10);
    const f = compare(sim);
    expect(f.get(below.id)?.lobby?.slot).toEqual({ floor: 15, onSlot: false, needsSupport: false, clearFirst: true });
    expect(f.get(on.id)?.lobby?.slot).toEqual({ floor: 15, onSlot: true, needsSupport: false, clearFirst: false });
  });

  it("names a sinking room's slot, to build on or to clear", () => {
    // Classic sinks past 11 floors from a lobby: floor 13 sits 12 from the
    // ground, with the floor 15 slot built and free, then built and holding a
    // room.
    const sim = slabs("classic", 16);
    expectOk(sim.buildTransport("elevatorStandard", C, 1, 16));
    sim.tower.setCars(sim.tower.transports[0]!.id, 8);
    const sinking = room(sim, "office", 13, 10);
    expect(compare(sim).get(sinking.id)?.lobby).toEqual({
      distance: 12,
      sinking: true,
      slot: { floor: 15, onSlot: false, needsSupport: false, clearFirst: false },
    });
    room(sim, "office", 15, W - 20);
    expect(compare(sim).get(sinking.id)?.lobby?.slot).toEqual({ floor: 15, onSlot: false, needsSupport: false, clearFirst: true });
  });

  it("reads unmet demand on a floor past the stair climb anyone will make", () => {
    // Classic riders take at most four flights of stairs: floor 7 is served by
    // a six-flight chain but reachable by no one, so its office reads zero
    // coverage with an unreachable floor, and the card leaves the gripe to the
    // access line.
    const sim = slabs("classic", 7);
    for (let f = 1; f < 7; f++) expectOk(sim.buildTransport("stairs", C, f, f + 1));
    room(sim, "fastFood", 2, C + 6);
    const high = room(sim, "office", 7, C + 6, "occupied", 0.2);
    const f = compare(sim).get(high.id);
    expect(f?.access).toBe("noRoute");
    expect(f?.gripe).toEqual({ cause: "unmetDemand", coverage: 0, floorReachable: false });
  });

  /** Offices on `floors` at 0.2 satisfaction, clear of the shafts at `xs`. */
  function offices(sim: Simulation, floors: number[], xs: number[]): Unit[] {
    const out: Unit[] = [];
    for (const f of floors) {
      for (let x = 2; x + 9 < W; x += 10) {
        if (xs.some((sx) => x + 10 > sx - 2 && x < sx + 12)) continue;
        out.push(room(sim, "office", f, x, "occupied", 0.2));
      }
    }
    return out;
  }

  it("finds no slot for a room past a lobby on the last one", () => {
    const sim = slabs("modern", 99);
    lay(sim, "lobby", 90);
    expectOk(sim.buildTransport("elevatorExpress", C, 1, 99));
    sim.tower.clearStops(sim.tower.transports[0]!.id);
    for (const f of [1, 90]) sim.tower.setStop(sim.tower.transports[0]!.id, f, true);
    expectOk(sim.buildTransport("elevatorStandard", C + 30, 90, 99));
    const top = room(sim, "office", 99, 10);
    expect(compare(sim).get(top.id)?.lobby).toEqual({ distance: 9, sinking: false, slot: null });
  });

  it("names each congestion binding and whether an elevator stops there", () => {
    // A stair chain 1-2-3 carries floor 3's crowd past a one-car elevator on
    // 1..2: the stairs bind on both floors, with an elevator stop on 2 only.
    const chain = slabs("modern", 3);
    expectOk(chain.buildTransport("stairs", C, 1, 2));
    expectOk(chain.buildTransport("stairs", C, 2, 3));
    expectOk(chain.buildTransport("elevatorStandard", C + 30, 1, 2));
    chain.tower.setCars(chain.tower.transports[chain.tower.transports.length - 1]!.id, 1);
    const walkers = offices(chain, [2, 3], [C, C + 30]);
    chain.clock.minutes = 8 * 60 + 30; // the morning rush
    const f = compare(chain);
    const on = (floor: number) => f.get(walkers.find((u) => u.floor === floor)!.id)?.gripe;
    expect(on(2)).toEqual({ cause: "congestion", binding: "stairs", elevatorHere: true });
    expect(on(3)).toEqual({ cause: "congestion", binding: "stairs", elevatorHere: false });
    // A one-car elevator alone.
    const lift = slabs("modern", 2);
    expectOk(lift.buildTransport("elevatorStandard", C, 1, 2));
    lift.tower.setCars(lift.tower.transports[0]!.id, 1);
    const riders = offices(lift, [2], [C]);
    lift.clock.minutes = 8 * 60 + 30;
    expect(compare(lift).get(riders[0]!.id)?.gripe).toEqual({ cause: "congestion", binding: "elevator" });
  });

  it("names a nightclub's halo for a home above it", () => {
    const sim = slabs("modern", 3);
    expectOk(sim.buildTransport("elevatorStandard", C, 1, 3));
    sim.tower.setCars(sim.tower.transports[0]!.id, 8);
    const home = room(sim, "condo", 2, C + 6, "occupied", 0.2);
    home.residents = 3;
    room(sim, "nightclub", 3, C - 60);
    expect(compare(sim).get(home.id)?.gripe).toEqual({ cause: "noise", adjacent: false, club: true });
  });

  it("reads a lease amenity the gate holds back, and a notice with no deadline", () => {
    const sim = slabs("modern", 3);
    expectOk(sim.buildTransport("elevatorStandard", C, 1, 3));
    sim.tower.setCars(sim.tower.transports[0]!.id, 8);
    // A clinic is no unmet-demand origin, so the gate reads no coverage.
    const clinic = room(sim, "clinic", 2, C + 6, "empty");
    clinic.rent = rentConfig("clinic")!.max;
    const leaving = room(sim, "office", 3, C + 6, "vacating", 0.1);
    leaving.vacateReason = "rent";
    leaving.vacateAt = undefined;
    const f = compare(sim);
    expect(f.get(clinic.id)?.wontLease?.gripe?.cause).toBe("rent");
    expect(f.get(leaving.id)?.notice?.minutesLeft).toBe(0);
  });

  it("reads unmet demand at zero coverage, for a tenant and an open spot, and at partial coverage", () => {
    const sim = slabs("modern", 5);
    for (let sx = 10; sx < W - 10; sx += 40) expectOk(sim.buildTransport("elevatorStandard", sx, 1, 3));
    // Floor 5's shop is built but no shaft stops there: nobody reaches it.
    const dry = room(sim, "office", 2, 12, "occupied", 0.2);
    // The won't-lease gate reads its own coverage, for a spot on the market.
    const spot = room(sim, "office", 3, 52, "empty");
    room(sim, "fastFood", 5, 12);
    let f = compare(sim);
    const zero = { cause: "unmetDemand", coverage: 0, floorReachable: true };
    expect(f.get(dry.id)?.gripe).toEqual(zero);
    expect(f.get(spot.id)?.wontLease?.gripe).toEqual(zero);
    // A reachable shop the whole floor's offices outgrow.
    room(sim, "fastFood", 3, 12);
    for (let x = 22; x + 9 < W; x += 10) room(sim, "office", 2, x);
    f = compare(sim);
    const cov = f.get(dry.id)?.gripe?.coverage;
    expect(cov).toBeGreaterThan(0);
    expect(cov).toBeLessThan(1);
  });

  it("the card check sees a fact the card does not show", () => {
    const sim = slabs("modern", 16);
    expectOk(sim.buildTransport("elevatorStandard", C, 1, 16));
    const clinic = room(sim, "clinic", 2, C + 6, "empty");
    clinic.rent = rentConfig("clinic")!.max;
    const leaving = room(sim, "office", 3, C + 6, "vacating", 0.1);
    leaving.vacateReason = "rent";
    const far = room(sim, "office", 12, 10);
    const gouged = room(sim, "office", 4, C + 6, "occupied", 0.2);
    gouged.rent = rentConfig("office")!.max;
    const wrong = (u: Unit, edit: (f: DiagnosticFacts) => DiagnosticFacts): string[] =>
      inspectorDisagreements(sim, u, edit(structuredClone(tsDiagnosticFacts(sim, u))));
    for (const u of [clinic, leaving, far, gouged]) expect(wrong(u, (f) => f), `unit ${u.id}`).toEqual([]);
    expect(tsDiagnosticFacts(sim, gouged).gripe?.cause).toBe("rent");
    expect(wrong(clinic, (f) => ({ ...f, access: "cutOff" }))).not.toEqual([]);
    expect(wrong(clinic, (f) => ({ ...f, wontLease: undefined }))).not.toEqual([]);
    expect(wrong(clinic, (f) => ({ ...f, wontLease: { ...f.wontLease!, carry: f.wontLease!.carry + 1 } }))).not.toEqual([]);
    expect(wrong(clinic, (f) => ({ ...f, wontLease: { carry: f.wontLease!.carry } }))).not.toEqual([]);
    expect(wrong(leaving, (f) => ({ ...f, notice: undefined }))).not.toEqual([]);
    expect(wrong(leaving, (f) => ({ ...f, notice: { ...f.notice!, reason: "noise" } }))).not.toEqual([]);
    expect(wrong(leaving, (f) => ({ ...f, noRate: "occupied" }))).not.toEqual([]);
    expect(wrong(leaving, (f) => ({ ...f, notice: { ...f.notice!, minutesLeft: 120 } }))).not.toEqual([]);
    expect(wrong(leaving, (f) => ({ ...f, notice: { ...f.notice!, satisfaction: 0.5 } }))).not.toEqual([]);
    expect(wrong(far, (f) => ({ ...f, lobby: { ...f.lobby!, slot: null } }))).not.toEqual([]);
    expect(wrong(far, (f) => ({ ...f, lobby: { ...f.lobby!, sinking: !f.lobby!.sinking } }))).not.toEqual([]);
    expect(wrong(far, (f) => ({ ...f, lobby: { ...f.lobby!, distance: f.lobby!.distance + 1 } }))).not.toEqual([]);
    for (const flag of ["onSlot", "needsSupport", "clearFirst"] as const) {
      expect(wrong(far, (f) => ({ ...f, lobby: { ...f.lobby!, slot: { ...f.lobby!.slot!, [flag]: true } } })), flag).not.toEqual([]);
    }
    expect(wrong(gouged, (f) => ({ ...f, gripe: { cause: "congestion", binding: "elevator" } }))).not.toEqual([]);
    expect(wrong(far, (f) => ({ ...f, farWalk: f.farWalk ? undefined : true }))).not.toEqual([]);
    expect(wrong(far, (f) => ({ ...f, gripe: { cause: "noise", adjacent: true, club: false } }))).not.toEqual([]);
  });

  it("answers nothing for an id that names no unit, or a malformed one", () => {
    const sim = slabs("modern", 2);
    expectOk(sim.buildTransport("elevatorStandard", C, 1, 2));
    const office = room(sim, "office", 2, C + 6);
    const shaft = sim.tower.transports[0]!.id;
    const handle = wasm().Engine.fromSave(JSON.stringify(sim.serialize()));
    try {
      // The control: the same handle answers for a real unit.
      expect(JSON.parse(handle.diagnosticFacts(office.id)!)).toMatchObject({ id: office.id, kind: "office", mode: "modern" });
      // A transport's id, ids no unit has, fractions, non-finite numbers and
      // ids past `Number.MAX_SAFE_INTEGER`, which could round onto another.
      const bad = [shaft, 0, -1, office.id + 0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];
      bad.push(2 ** 32 + office.id, 9_999_999, Number.MAX_SAFE_INTEGER, 2 ** 53, 2 ** 53 + office.id * 2);
      for (const id of bad) expect(handle.diagnosticFacts(id), String(id)).toBeUndefined();
      // A string, a boolean, null or undefined crosses as a non-number and is
      // refused too.
      for (const odd of [String(office.id), true, false, null, undefined]) {
        expect(handle.diagnosticFacts(odd as unknown as number), String(odd)).toBeUndefined();
      }
    } finally {
      handle.free();
    }
  });
});
