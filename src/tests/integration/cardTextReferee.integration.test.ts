import { describe, expect, it } from "vitest";
import { Simulation } from "../../engine/Simulation";
import { TsEngine } from "../../engine/port/tsEngine";
import { FACILITIES } from "../../engine/facilities";
import { rentConfig } from "../../engine/econConfig";
import type { FacilityKind, GameMode, UnitState } from "../../engine/types";
import { facilityDiagnostics, transportDiagnostics } from "../diagnostics/facilityDiagnostics";
import { swapDone } from "../../game/portLifecycle";
import { lobbyDistanceFixture, retailServiceFixture, serviceDiagnosticsFixture } from "../fixtures/serviceDiagnostics.fixture";
import { layTile, placeUnit } from "../fixtures/towerFixtures";
import { buildWinningTower } from "../fixtures/winningTower";
import {
  CARD_TEXT_CASES,
  CARD_TEXT_MODES,
  CARD_TEXT_STATES,
  expectRealLines,
  packCardTextSave,
  playCardTextCase,
  readCardTextFile,
  readCardTextGolden,
  readCardTextSave,
  textOf,
  writeCardTextGolden,
  writeCardTextSave,
  type CardTextGolden,
  type CardTextMode,
} from "../goldens/cardText";
import { CARD_TEXT_WRITER, writeAfterPassingRun } from "../goldens/updateGate";

/**
 * The TypeScript referee for the card-text golden (`src/tests/goldens/cardText.ts`):
 * it builds each sweep case on the TypeScript engine, as the sweep did before
 * the golden, and holds the golden to it: the committed tower holds the save
 * the case builds, packed byte for byte, and the committed lines are the
 * lines the TypeScript reference card (`facilityDiagnostics.ts`) prints, room
 * by room, in card order. With the sweep (`cardTextParity.integration.test.ts`),
 * which holds the Rust card to the same lines, the two cards agree through the
 * golden.
 *
 * `VC_CARD_TEXT_UPDATE=typescript npx vitest run --project integration cardTextReferee`
 * writes the towers and the lines from here, once every test in this file ran
 * and passed (the
 * sweep skips in that run). This file goes with `src/engine/`; the proposal on
 * #945 (owner sign-off pending) is that the golden alone then carries the
 * canary.
 */

function winning(mode: GameMode): Simulation {
  const sim = Simulation.newGame(5, mode);
  buildWinningTower(sim, { officeTop: 12 });
  return sim;
}

/** A tower with every tenant made unhappy and each priced one charged its
 *  kind's top rent, so the "Main gripe" line has a cause to name (an
 *  over-market rent is the first cause an office, a rental or a lease amenity
 *  feels once it can reach the lobby and its elevators are not crowded). */
function unhappy(sim: Simulation): Simulation {
  for (const u of sim.tower.units) {
    if (u.state !== "occupied" && u.state !== "asleep") continue;
    u.satisfaction = 0.2;
    const rent = rentConfig(u.kind);
    if (rent) u.rent = rent.max;
  }
  return sim;
}

/** The same tower moved on to the first rainy day at the same hour. The save
 *  carries the clock, and each engine derives the day's weather from it on
 *  load; the built tower is given the same weather. */
function rainy(sim: Simulation): Simulation {
  const MINUTES_PER_DAY = 1440;
  const LAST_DAY = sim.clock.day + 400;
  let day = sim.clock.day;
  while (Simulation.weatherFor(day) !== "rain") {
    if (++day > LAST_DAY) throw new Error("no rainy day in 400 days");
  }
  sim.clock.minutes += (day - sim.clock.day) * MINUTES_PER_DAY;
  sim.weather = "rain";
  return sim;
}

/** One of every room kind the lot accepts, each on its own stretch of a tall
 *  slab tower, all put in `state`. Kinds that need special ground (basement,
 *  rooftop, transport) are skipped when the tower refuses them. */
function everyKind(mode: GameMode, state: UnitState): Simulation {
  const sim = Simulation.newGame(9, mode);
  sim.money = 1e12;
  sim.star = 5;
  const W = 250;
  const slab = (kind: "lobby" | "floor", f: number, x: number) => {
    const r = sim.tower.place(kind, f, x);
    if (!r.ok) throw new Error(`${kind} at floor ${f}, x ${x}: ${r.reason}`);
  };
  for (let x = 0; x < W; x++) slab("lobby", 1, x);
  for (let f = 2; f <= 40; f++) for (let x = 0; x < W; x++) slab("floor", f, x);
  const kinds = (Object.keys(FACILITIES) as FacilityKind[]).filter((k) => !FACILITIES[k].transport && k !== "floor" && k !== "lobby");
  let floor = 3;
  let x = 2;
  const skipped: FacilityKind[] = [];
  for (const k of kinds) {
    const width = FACILITIES[k].width;
    if (x + width > W) { x = 2; floor += 4; }
    if (floor > 38) throw new Error(`no room left for ${k}; widen the fixture`);
    const r = sim.tower.place(k, floor, x);
    if (r.ok) x += width + 1;
    else skipped.push(k);
  }
  // Only kinds that need ground the slab tower lacks may be refused: the
  // basement kinds, and the wedding hall (it sits in a fixed 100-104 floor
  // band no slab tower here reaches).
  const unexpected = skipped.filter((k) => !FACILITIES[k].basement && k !== "weddingHall");
  if (unexpected.length > 0) throw new Error(`refused placements: ${unexpected.join(", ")}`);
  for (const u of sim.tower.units) {
    if (u.kind === "floor" || u.kind === "lobby") continue;
    u.state = state;
    u.satisfaction = 0.25;
    if (state !== "empty" && state !== "construction") u.everOccupied = true;
    if (state === "vacating") { u.vacateReason = "rent"; u.vacateAt = sim.clock.minutes + 600; }
    u.patronageToday = 12;
    u.patronageYest = 30;
    u.profitYest = 400;
  }
  return sim;
}

/** Every passenger and service transport over a tower of occupied offices,
 *  so the shafts carry riders once the case plays its morning
 *  (`CARD_TEXT_PLAY_MINUTES`). */
function everyTransport(mode: GameMode): Simulation {
  const sim = Simulation.newGame(4, mode);
  sim.money = 1e12;
  sim.star = 5;
  const place = (kind: "lobby" | "floor" | "office", f: number, x: number) => {
    const r = sim.tower.place(kind, f, x);
    if (!r.ok) throw new Error(`${kind} at floor ${f}, x ${x}: ${r.reason}`);
  };
  for (let x = 0; x < 200; x++) place("lobby", 1, x);
  for (let f = 2; f <= 30; f++) for (let x = 0; x < 200; x++) place("floor", f, x);
  let x = 4;
  for (const [kind, top] of [
    ["elevatorStandard", 20], ["elevatorService", 12], ["elevatorExpress", 28], ["stairs", 2], ["escalator", 2],
  ] as const) {
    const r = sim.tower.placeTransport(kind, x, 1, top);
    if (!r.ok) throw new Error(`${kind}: ${r.reason}`);
    x += FACILITIES[kind].width + 2;
  }
  const OFFICE = FACILITIES.office.width;
  for (let f = 2; f <= 20; f++) for (let ox = 60; ox + OFFICE <= 200; ox += OFFICE) place("office", f, ox);
  for (const u of sim.tower.units) {
    if (u.kind !== "office") continue;
    u.state = "occupied";
    u.everOccupied = true;
    u.satisfaction = 1;
  }
  return sim;
}

const floors = (from: number, to: number): number[] => Array.from({ length: to - from + 1 }, (_, i) => from + i);

/** Each fixture below claims its rooms' floors are served; a floor no
 *  passenger shaft reaches would print a different card. */
function expectServed(sim: Simulation, want: readonly number[], what: string): void {
  const served = sim.tower.servedFloors();
  const missing = want.filter((f) => !served.has(f));
  if (missing.length > 0) throw new Error(`${what}: floor ${missing.join(", ")} is not served`);
}

/** One single-car lift serving fifteen floors of occupied offices: after a
 *  day and a half of rides (`CARD_TEXT_PLAY_MINUTES`) its average load passes
 *  the near-capacity line. */
function crowdedLift(mode: GameMode): Simulation {
  const sim = Simulation.newGame(11, mode);
  sim.money = 1e9;
  sim.star = 5;
  for (let x = 150; x < 240; x++) {
    layTile(sim, "lobby", 1, x);
    for (let f = 2; f <= 16; f++) layTile(sim, "floor", f, x);
  }
  const shaft = sim.tower.placeTransport("elevatorStandard", 165, 1, 16);
  if (!shaft.ok || shaft.transportId === undefined) throw new Error(`lift: ${shaft.reason}`);
  if (!sim.tower.setCars(shaft.transportId, 1)) throw new Error("lift: could not set one car");
  expectServed(sim, floors(2, 16), "crowded lift");
  for (let f = 2; f <= 16; f++) {
    for (let x = 150; x < 240; x += FACILITIES.office.width) placeUnit(sim, "office", f, x).state = "occupied";
  }
  return sim;
}

/** A recycling center on notice in a served basement. Only a hand-edited
 *  save can hold that state, since play gives notice to lease tenants alone;
 *  the every-kind cases leave basement kinds out. */
function recyclingOnNotice(mode: GameMode): Simulation {
  const sim = Simulation.newGame(9, mode);
  sim.money = 1e12;
  sim.star = 5;
  for (let x = 100; x < 300; x++) {
    layTile(sim, "lobby", 1, x);
    for (const f of [0, -1, -2]) layTile(sim, "floor", f, x);
  }
  const lift = sim.tower.placeTransport("elevatorStandard", 102, -2, 1);
  if (!lift.ok) throw new Error(`basement lift: ${lift.reason}`);
  expectServed(sim, [0, -1, -2], "recycling center on notice");
  const center = placeUnit(sim, "recycling", -1, 150);
  Object.assign(center, { state: "vacating", everOccupied: true, satisfaction: 0.25, vacateReason: "rent", vacateAt: sim.clock.minutes + 600 });
  return sim;
}

/** One recycling center under 24 floors of occupied offices (2,592 people,
 *  more than one center's 2,500), so the card gives the over-capacity verdict. */
function recyclingOverCapacity(mode: GameMode): Simulation {
  const sim = Simulation.newGame(13, mode);
  sim.money = 1e12;
  sim.star = 5;
  for (let x = 100; x < 280; x++) {
    layTile(sim, "lobby", 1, x);
    for (const f of [0, -1]) layTile(sim, "floor", f, x);
    for (let f = 2; f <= 25; f++) layTile(sim, "floor", f, x);
  }
  const lift = sim.tower.placeTransport("elevatorStandard", 102, -1, 25);
  if (!lift.ok) throw new Error(`lift: ${lift.reason}`);
  expectServed(sim, [0, -1, ...floors(2, 25)], "recycling over capacity");
  placeUnit(sim, "recycling", -1, 150);
  for (let f = 2; f <= 25; f++) {
    for (let x = 110; x + FACILITIES.office.width <= 280; x += FACILITIES.office.width) placeUnit(sim, "office", f, x).state = "occupied";
  }
  return sim;
}

const BUILDERS: ReadonlyMap<string, (mode: GameMode) => Simulation> = new Map<string, (mode: GameMode) => Simulation>([
  ["service rooms", (m) => serviceDiagnosticsFixture(m).sim],
  ["service rooms, unhappy", (m) => unhappy(serviceDiagnosticsFixture(m).sim)],
  ["retail venues", (m) => retailServiceFixture(m).sim],
  ["retail venues, rainy day", (m) => rainy(retailServiceFixture(m).sim)],
  ["lobby distance", (m) => lobbyDistanceFixture(m).sim],
  ["lobby distance, unhappy", (m) => unhappy(lobbyDistanceFixture(m).sim)],
  ...CARD_TEXT_STATES.map((st) => [`every kind, ${st}`, (m: GameMode) => everyKind(m, st)] as const),
  ["every transport", everyTransport],
  ["crowded lift", crowdedLift],
  ["recycling center on notice", recyclingOnNotice],
  ["recycling over capacity", recyclingOverCapacity],
  ["winning tower", winning],
  ["winning tower, unhappy", (m) => unhappy(winning(m))],
]);

/** What the reference card prints for every room and shaft of `sim`. A shaft
 *  the engine has not measured yet read "Avg load: 0% full" on the TypeScript
 *  card; the Rust card prints no load line until the engine has a measurement,
 *  a deliberate, harmless difference, so the golden leaves that line out for a
 *  shaft with no measurement. A measured empty shaft reads 0% on both. */
function referenceLines(sim: Simulation, mode: CardTextMode, name: string): CardTextGolden {
  const units = sim.tower.units
    .filter((u) => u.kind !== "floor" && u.kind !== "lobby")
    .map((u) => ({ id: u.id, kind: u.kind, floor: u.floor, lines: textOf(facilityDiagnostics(sim, u)) }));
  const transports = sim.tower.transports
    .filter((t) => FACILITIES[t.kind])
    .map((t) => ({ id: t.id, kind: t.kind, lines: textOf(transportDiagnostics(sim, t)).filter((l) => sim.elevatorUtil.has(t.id) || l !== "Avg load: 0% full") }));
  return { case: name, mode, units, transports };
}

const WRITING = CARD_TEXT_WRITER === "typescript";

const fresh: { mode: CardTextMode; name: string; save: string; lines: CardTextGolden }[] = [];
writeAfterPassingRun(
  "card-text golden",
  WRITING,
  () => CARD_TEXT_MODES.flatMap((m) => CARD_TEXT_CASES.filter((n) => !fresh.some((f) => f.mode === m && f.name === n)).map((n) => `${m}: ${n}`)),
  () => {
    for (const f of fresh) {
      writeCardTextSave(f.mode, f.name, f.save);
      writeCardTextGolden(f.lines);
    }
  },
);

// A run in which the sweep writes the lines skips this check; run it on the
// new lines afterwards, without the switch.
describe.skipIf(CARD_TEXT_WRITER === "rust")("the card-text golden on the TypeScript reference card", () => {
  it("builds every case the golden pins", () => {
    expect([...BUILDERS.keys()]).toEqual(CARD_TEXT_CASES);
  });

  for (const mode of CARD_TEXT_MODES) {
    for (const name of CARD_TEXT_CASES) {
      it(`${mode}: ${name}`, () => {
        const save = JSON.stringify(BUILDERS.get(name)!(mode).serialize());
        // The reference card reads the tower as the sweep's Rust card does:
        // loaded from the save, then played for the case's minutes.
        const engine = TsEngine.newGame(1, "classic");
        swapDone(engine, engine.loadSave(save));
        playCardTextCase(name, (minutes) => engine.tick(minutes));
        const want = referenceLines(engine.sim, mode, name);
        // Checked before a refresh writes them, too.
        expectRealLines(want);
        if (WRITING) {
          fresh.push({ mode, name, save, lines: want });
          return;
        }
        expect(readCardTextSave(mode, name) === save, `${mode}: ${name}: the committed tower is not the one the case builds`).toBe(true);
        // The same save, packed. When only this check fails, the case still
        // builds the committed save and the packer's output moved: an fflate
        // upgrade, or a change to how the tower file is packed.
        expect(
          readCardTextFile(mode, name) === packCardTextSave(save),
          `${mode}: ${name}: the committed tower holds this save, packed differently (an fflate upgrade or a packing change moves it)`,
        ).toBe(true);
        expect(readCardTextGolden(mode, name)).toStrictEqual(want);
      });
    }
  }
});
