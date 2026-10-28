import { describe, it, expect } from "vitest";
import { Simulation } from "../../engine/Simulation";
import { GRID } from "../../engine/facilities";
import { rentConfig } from "../../engine/econConfig";
import type { SerializedGame } from "../../engine/serializedGame";
import type { FacilityKind, GameMode, Unit, UnitState } from "../../engine/types";
import { hasWasmPackage, reloadWasmHandle, wasm, wasmRequired } from "../conformance/wasmEngine";
import { tsDiagnosticFacts, type DiagnosticFacts, type GripeFacts } from "../diagnostics/tsDiagnosticFacts";
import { inspectorDisagreements } from "../diagnostics/inspectorAgreement";

/**
 * The diagnostics facts (#1215) on constructed towers, for the branches the
 * conformance corpus never reaches (`conformanceWasmDiagnostics` runs the
 * corpus): a served floor with no route to the lobby, a room off the market,
 * the sky lobby slot that needs clearing or that the unit sits on, a sinking
 * room's slot, a slot one story above the top and one two stories above it,
 * no slot at all, the stairs binding with and without an elevator stop and
 * the elevator binding, a nightclub's halo, unmet demand outranking the
 * noise a home hears first, an open spot off the market beside one the gate
 * holds back, an unsold condo's hold tax rounded up, and unmet demand at
 * zero and partial coverage and on a floor no rider reaches. Each tower is
 * built on the TypeScript engine, saved, and loaded into both engines;
 * every room's facts must agree, the inspector card must show the lines they
 * carry (`inspectorAgreement`), and the case's own section must be there, so
 * a tower that drifts from its recipe fails rather than comparing two empty
 * answers. The cases that pin a section's fields
 * also edit each field the card branches on and check that the card check
 * catches the edit. The last three cases hold the demand memo's lag within
 * the hour on both engines, check that the card check catches a wrong
 * section, and hold the binding's answers for ids that name no unit beside
 * one that does.
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

/** The card check on `u`'s TypeScript facts after `edit`. */
function cardMisses(sim: Simulation, u: Unit, edit: (f: DiagnosticFacts) => DiagnosticFacts): string[] {
  return inspectorDisagreements(sim, u, edit(structuredClone(tsDiagnosticFacts(sim, u))));
}

type Edit = (f: DiagnosticFacts) => DiagnosticFacts;

/** The card agrees with `u`'s facts as they are and catches each edit. */
function expectCardCatches(sim: Simulation, u: Unit, edits: Record<string, Edit>): void {
  expect(cardMisses(sim, u, (f) => f), `unit ${u.id} unedited`).toEqual([]);
  for (const [what, edit] of Object.entries(edits)) expect(cardMisses(sim, u, edit), `unit ${u.id}: ${what}`).not.toEqual([]);
}

/** An edit of the main gripe's fields. */
const gripe = (g: Partial<GripeFacts>): Edit => (f) => ({ ...f, gripe: { ...f.gripe!, ...g } });

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

  it("builds the slot one story above the top without support, and asks for support one story higher", () => {
    // The floor 15 slot sits one story above a 14-floor tower, which a lobby
    // can stand on, and two above a 13-floor one, which needs a floor first.
    for (const [top, needsSupport] of [[13, true], [14, false]] as const) {
      const sim = slabs("modern", top);
      expectOk(sim.buildTransport("elevatorStandard", C, 1, top));
      sim.tower.setCars(sim.tower.transports[0]!.id, 8);
      const office = room(sim, "office", top, 10);
      expect(compare(sim).get(office.id)?.lobby?.slot, `top ${top}`).toEqual({ floor: 15, onSlot: false, needsSupport, clearFirst: false });
      expectCardCatches(sim, office, {
        "support flipped": (f) => ({ ...f, lobby: { ...f.lobby!, slot: { ...f.lobby!.slot!, needsSupport: !needsSupport } } }),
      });
    }
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
    for (const floor of [2, 3]) {
      expectCardCatches(chain, walkers.find((u) => u.floor === floor)!, {
        walkways: gripe({ binding: "walkways" }),
        escalator: gripe({ binding: "escalator" }),
        elevator: gripe({ binding: "elevator" }),
        none: gripe({ binding: "none" }),
        "elevatorHere flipped": gripe({ elevatorHere: floor === 3 }),
      });
    }
    // A one-car elevator alone.
    const lift = slabs("modern", 2);
    expectOk(lift.buildTransport("elevatorStandard", C, 1, 2));
    lift.tower.setCars(lift.tower.transports[0]!.id, 1);
    const riders = offices(lift, [2], [C]);
    lift.clock.minutes = 8 * 60 + 30;
    expect(compare(lift).get(riders[0]!.id)?.gripe).toEqual({ cause: "congestion", binding: "elevator" });
    expectCardCatches(lift, riders[0]!, { stairs: gripe({ binding: "stairs" }), none: gripe({ binding: "none" }) });
  });

  it("names a nightclub's halo for a home above it", () => {
    const sim = slabs("modern", 3);
    expectOk(sim.buildTransport("elevatorStandard", C, 1, 3));
    sim.tower.setCars(sim.tower.transports[0]!.id, 8);
    const home = room(sim, "condo", 2, C + 6, "occupied", 0.2);
    home.residents = 3;
    room(sim, "nightclub", 3, C - 60);
    expect(compare(sim).get(home.id)?.gripe).toEqual({ cause: "noise", adjacent: false, club: true });
    expectCardCatches(sim, home, { "no club": gripe({ club: false }), adjacent: gripe({ adjacent: true }) });
  });

  /** A Modern tower whose one shop no rider reaches: elevators on 1..3 and a
   *  fast food on floor 5, where no shaft stops, so every tenant and open
   *  spot on 2 and 3 reads zero retail coverage. */
  function shopOutOfReach(): Simulation {
    const sim = slabs("modern", 5);
    for (let sx = 10; sx < W - 10; sx += 40) expectOk(sim.buildTransport("elevatorStandard", sx, 1, 3));
    room(sim, "fastFood", 5, 12);
    return sim;
  }

  const zeroCoverage: GripeFacts = { cause: "unmetDemand", coverage: 0, floorReachable: true };

  it("ranks unmet demand above the noise a home hears first", () => {
    // The office next door makes the condo noisy, so the ladder stops at noise
    // until the coverage is read; at zero coverage unmet demand erodes faster
    // than a condo's noise and takes the tier (#548).
    const sim = shopOutOfReach();
    room(sim, "office", 2, 12);
    const home = room(sim, "condo", 2, 22, "occupied", 0.2);
    home.residents = 3;
    expect(sim.noiseAfflicted(home)).toBe(true);
    expect(compare(sim).get(home.id)?.gripe).toEqual(zeroCoverage);
    expectCardCatches(sim, home, { "noise first": (f) => ({ ...f, gripe: { cause: "noise", adjacent: true, club: false } }) });
  });

  it("holds back no open spot that is off the market", () => {
    // Two open condos side by side, 12 floors from the Classic ground lobby,
    // where a fresh household would sink and leave. No Rate is a Classic
    // state (Modern loads drop it), and the spot set to it is off the market,
    // so the gate never reads it. The spots are condos because a condo's
    // price never enters its satisfaction; an office at No Rate pays no rent,
    // and that lift keeps it.
    const sim = slabs("classic", 16);
    expectOk(sim.buildTransport("elevatorStandard", C, 1, 16));
    sim.tower.setCars(sim.tower.transports[0]!.id, 8);
    const open = room(sim, "condo", 13, C + 6, "empty");
    const off = room(sim, "condo", 13, C + 26, "empty");
    off.noRate = true;
    const f = compare(sim);
    expect(f.get(open.id)?.wontLease).toEqual({ gripe: { cause: "lobbyFar" }, carry: 0 });
    expect(f.get(off.id)?.noRate).toBe("offMarket");
    expect(f.get(off.id)?.wontLease).toBeUndefined();
    expectCardCatches(sim, off, { "held back": (g) => ({ ...g, wontLease: f.get(open.id)!.wontLease }) });
  });

  it("rounds an unsold condo's hold tax up", () => {
    // 1.5% of 123,457 is 1,851.855: the carry is the 700 overhead plus 1,852.
    const sim = shopOutOfReach();
    const condo = room(sim, "condo", 3, 22, "empty");
    condo.rent = 123_457;
    expect(compare(sim).get(condo.id)?.wontLease).toEqual({ gripe: zeroCoverage, carry: 2_552 });
    expectCardCatches(sim, condo, { "rounded down": (f) => ({ ...f, wontLease: { ...f.wontLease!, carry: 2_551 } }) });
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
    expectCardCatches(sim, dry, { "floor unreachable": gripe({ floorReachable: false }), "partial coverage": gripe({ coverage: 0.3 }) });
    // A reachable shop the whole floor's offices outgrow.
    room(sim, "fastFood", 3, 12);
    for (let x = 22; x + 9 < W; x += 10) room(sim, "office", 2, x);
    f = compare(sim);
    const cov = f.get(dry.id)?.gripe?.coverage;
    expect(cov).toBeGreaterThan(0);
    expect(cov).toBeLessThan(1);
    expectCardCatches(sim, dry, { "zero coverage": gripe({ coverage: 0 }) });
  });

  it("holds the demand memo's lag within the hour on both engines", () => {
    // Two shops finish building inside one game hour, which changes the
    // demand map with no revision bump. Each engine's memo fills at the first
    // read that needs coverage: a rent gripe before either opens needs none
    // and leaves it empty, a read between the two fills it with one shop
    // open, and a read after the second still sees one shop until the hour
    // turns. A fresh load sees both.
    const sim = slabs("modern", 3);
    for (let sx = 10; sx < W - 10; sx += 40) expectOk(sim.buildTransport("elevatorStandard", sx, 1, 3));
    sim.tick(65 - (sim.clock.minutes % 60)); // five minutes into an hour
    const dry = room(sim, "office", 2, 12, "occupied", 0.2);
    const gouged = room(sim, "office", 2, 22, "occupied", 0.2);
    gouged.rent = rentConfig("office")!.max;
    for (let x = 32; x + 9 < W; x += 10) room(sim, "office", 2, x);
    for (const [x, minutes] of [[12, 10], [32, 30]] as const) {
      const shop = room(sim, "fastFood", 3, x, "empty");
      shop.state = "construction";
      shop.completeAt = sim.clock.minutes + minutes;
      sim.constructing.add(shop.id);
    }
    const text = JSON.stringify(sim.serialize());
    const ts = Simulation.deserialize(JSON.parse(text) as SerializedGame);
    const handle = wasm().Engine.fromSave(text);
    const hour = Math.floor(ts.clock.minutes / 60);
    const revision = ts.tower.revision;
    const read = (id: number): DiagnosticFacts => {
      const want = tsDiagnosticFacts(ts, ts.tower.getUnit(id)!);
      expect(JSON.parse(handle.diagnosticFacts(id)!) as DiagnosticFacts, `unit ${id} at ${ts.clock.minutes}`).toEqual(want);
      return want;
    };
    try {
      expect(read(gouged.id).gripe?.cause).toBe("rent");
      ts.tick(20);
      handle.tick(20);
      const between = read(dry.id).gripe;
      expect(between?.cause).toBe("unmetDemand");
      // One shop open: a memo filled at the first read would hold zero.
      expect(between?.coverage).toBeGreaterThan(0);
      ts.tick(20);
      handle.tick(20);
      expect(read(dry.id).gripe).toEqual(between);
      expect([Math.floor(ts.clock.minutes / 60), ts.tower.revision]).toEqual([hour, revision]);
      expect(ts.tower.units.filter((u) => u.kind === "fastFood").map((u) => u.state)).toEqual(["empty", "empty"]);
      // A fresh load reads both shops, on both engines.
      const again = Simulation.deserialize(JSON.parse(JSON.stringify(ts.serialize())) as SerializedGame);
      const fresh = tsDiagnosticFacts(again, again.tower.getUnit(dry.id)!);
      expect(fresh.gripe).not.toEqual(between);
      const reloaded = reloadWasmHandle(handle);
      try {
        expect(JSON.parse(reloaded.diagnosticFacts(dry.id)!) as DiagnosticFacts).toEqual(fresh);
      } finally {
        reloaded.free();
      }
    } finally {
      handle.free();
    }
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
    const wrong = (u: Unit, edit: Edit): string[] => cardMisses(sim, u, edit);
    for (const u of [clinic, leaving, far, gouged]) expect(wrong(u, (f) => f), `unit ${u.id}`).toEqual([]);
    expect(tsDiagnosticFacts(sim, gouged).gripe?.cause).toBe("rent");
    expect(wrong(clinic, (f) => ({ ...f, access: "cutOff" }))).not.toEqual([]);
    expect(wrong(clinic, (f) => ({ ...f, access: "noRoute" }))).not.toEqual([]);
    expect(wrong(clinic, (f) => ({ ...f, noRate: "offMarket" }))).not.toEqual([]);
    expect(wrong(clinic, (f) => ({ ...f, wontLease: undefined }))).not.toEqual([]);
    expect(wrong(clinic, (f) => ({ ...f, wontLease: { ...f.wontLease!, carry: f.wontLease!.carry + 1 } }))).not.toEqual([]);
    expect(wrong(clinic, (f) => ({ ...f, wontLease: { carry: f.wontLease!.carry } }))).not.toEqual([]);
    expect(wrong(leaving, (f) => ({ ...f, notice: undefined }))).not.toEqual([]);
    expect(wrong(leaving, (f) => ({ ...f, notice: { ...f.notice!, reason: "noise" } }))).not.toEqual([]);
    expect(wrong(leaving, (f) => ({ ...f, noRate: "occupied" }))).not.toEqual([]);
    expect(wrong(leaving, (f) => ({ ...f, notice: { ...f.notice!, minutesLeft: 120 } }))).not.toEqual([]);
    expect(wrong(leaving, (f) => ({ ...f, notice: { ...f.notice!, satisfaction: 0.5 } }))).not.toEqual([]);
    expect(wrong(leaving, (f) => ({ ...f, notice: { ...f.notice!, keepAt: f.notice!.keepAt + 0.1 } }))).not.toEqual([]);
    expect(wrong(far, (f) => ({ ...f, lobby: { ...f.lobby!, slot: null } }))).not.toEqual([]);
    expect(wrong(far, (f) => ({ ...f, lobby: { ...f.lobby!, sinking: !f.lobby!.sinking } }))).not.toEqual([]);
    expect(wrong(far, (f) => ({ ...f, lobby: { ...f.lobby!, distance: f.lobby!.distance + 1 } }))).not.toEqual([]);
    for (const flag of ["onSlot", "needsSupport", "clearFirst"] as const) {
      expect(wrong(far, (f) => ({ ...f, lobby: { ...f.lobby!, slot: { ...f.lobby!.slot!, [flag]: true } } })), flag).not.toEqual([]);
    }
    expect(wrong(gouged, (f) => ({ ...f, gripe: { cause: "congestion", binding: "elevator" } }))).not.toEqual([]);
    expect(wrong(gouged, (f) => ({ ...f, gripe: undefined }))).not.toEqual([]);
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
      // A transport's id, ids no unit has (negative zero among them),
      // fractions, non-finite numbers, and ids at or past the edge of the safe
      // integers, where a double could round onto another id.
      const bad = [shaft, 0, -0, -1, office.id + 0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];
      bad.push(2 ** 32 + office.id, 9_999_999, Number.MAX_SAFE_INTEGER, 2 ** 53, -(2 ** 53), 2 ** 53 + office.id * 2);
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
