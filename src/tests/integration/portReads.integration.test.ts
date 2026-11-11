import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { newRenderSim, newViewReader } from "../../game/portAccess";
import type { HeatmapMode } from "../../shared/engineTypes";
import { calendarOf, clockOf, type ClockView } from "../../simport/headerClock";
import { PortCodes, outcome } from "../../simport/portCodes";
import { PortEvents } from "../../simport/portEvents";
import { draftTower } from "../portKit/drafts";
import { FIXTURES } from "../portKit/mockPort";
import { engineFromSave, must, newEngine, noEngine, smallTower } from "../portKit/rustEngine";

/**
 * The port's units on the Rust engine: the layout fixture the unit tests
 * (`src/simport/`) build their mock ports from, held to the engine's answer,
 * and the engine behavior those tests used to check through it (events, a
 * refusal's reason, the header's clock, the renderer's reads through play).
 * `VC_UPDATE_PORT_FIXTURES=1` rewrites a fixture the engine has moved past.
 */

const UPDATE = process.env.VC_UPDATE_PORT_FIXTURES === "1";

describe.skipIf(noEngine)("the port's fixtures", () => {
  it("holds the engine's view layout", () => {
    const path = resolve(FIXTURES, "viewLayout.json");
    const fresh = JSON.parse(newEngine(1).viewLayout()) as unknown;
    if (UPDATE) writeFileSync(path, `${JSON.stringify(fresh, null, 2)}\n`);
    expect(JSON.parse(readFileSync(path, "utf8")), "run with VC_UPDATE_PORT_FIXTURES=1 to rewrite it").toEqual(fresh);
  });
});

describe.skipIf(noEngine)("PortEvents on the engine", () => {
  it("drains the founding once, and drops the backdrop's at a swap", () => {
    const events = new PortEvents(newEngine(1));
    expect(events.drainGameplayEvents().map((e) => e.name)).toEqual(["tower_founded"]);
    expect(events.drainGameplayEvents()).toEqual([]);
    const afterSwap = (backdrop: boolean) => {
      const engine = newEngine(1);
      const source = new PortEvents(engine);
      source.setBackdrop(backdrop);
      expect(engine.loadSave(newEngine(2).serialize())[0]).toBe(1);
      expect(source.gameplayEvents.discardOnHandOff).toBe(false);
      return source.drainGameplayEvents().map((e) => e.name);
    };
    expect(afterSwap(false)).toEqual(["tower_founded"]);
    expect(afterSwap(true)).toEqual([]);
  });
});

describe.skipIf(noEngine)("PortCodes on the engine", () => {
  it("paints with the layout's codes and reads a refusal's reason", () => {
    const d = draftTower(5, "modern");
    d.money = 1e8;
    const e = engineFromSave(d.saveText());
    const c = new PortCodes(e);
    const rec = e.paintTiles(c.kind("lobby"), 1, Float64Array.of(160, 161, 162));
    expect(outcome(e, rec)).toEqual({ ok: true, delta: rec[1] });
    expect(rec[1]).toBeLessThan(0);
    expect(c.slot(rec, "paintTiles", "placed")).toBe(3);
    const refused = outcome(e, e.buildAt(c.kind("office"), 40, 160));
    expect(refused.ok).toBe(false);
    expect(refused.reason).toBe(e.lastReason());
    expect(typeof refused.reason).toBe("string");
    expect(outcome(e, e.buildAt(NaN, 1, 160)).ok).toBe(false);
  });
});

const readings = (c: ClockView) => [c.minutes, c.day, c.dayOfWeek, c.isWeekend, c.quarter, c.year, c.format(), c.formatRetroDate()];

// The founding minute, an evening, a weekend day, a quarter boundary on the
// canon calendar, past a canon year and past a real one.
const MINUTES = [420, 1020, 1440 * 5 + 600, 1440 * 30 + 1, 1440 * 93, 1440 * 365 + 7, 1440 * 400 + 1439];

// prettier-ignore
const CANON = [
  [420, 0, 0, false, 0, 0, "WD1 07:00", "1st WD/1Q/1st Year"],
  [1020, 0, 0, false, 0, 0, "WD1 17:00", "1st WD/1Q/1st Year"],
  [7800, 5, 2, true, 1, 0, "WE1 10:00", "1st WE/2Q/1st Year"],
  [43201, 30, 0, false, 2, 2, "WD1 00:01", "1st WD/3Q/3rd Year"],
  [133920, 93, 0, false, 3, 7, "WD1 00:00", "1st WD/4Q/8th Year"],
  [525607, 365, 2, true, 1, 30, "WE1 00:07", "1st WE/2Q/31st Year"],
  [577439, 400, 1, false, 1, 33, "WD2 23:59", "2nd WD/2Q/34th Year"],
];

// prettier-ignore
const REAL_WORLD = [
  [420, 0, 0, false, 0, 0, "Mon 07:00", "1st WD/1Q/1st Year"],
  [1020, 0, 0, false, 0, 0, "Mon 17:00", "1st WD/1Q/1st Year"],
  [7800, 5, 5, true, 0, 0, "Sat 10:00", "1st WE/1Q/1st Year"],
  [43201, 30, 2, false, 0, 0, "Wed 00:01", "3rd WD/1Q/1st Year"],
  [133920, 93, 2, false, 1, 0, "Wed 00:00", "3rd WD/2Q/1st Year"],
  [525607, 365, 1, false, 0, 1, "Tue 00:07", "2nd WD/1Q/2nd Year"],
  [577439, 400, 1, false, 0, 1, "Tue 23:59", "2nd WD/1Q/2nd Year"],
];

const TOWERS = [
  ["classic", "classic", undefined, CANON, { weekDays: 3, weekendDays: 1 }],
  ["modern on the canon calendar", "modern", "canon", CANON, { weekDays: 3, weekendDays: 1 }],
  ["modern on the real-world calendar", "modern", "realWorld", REAL_WORLD, { weekDays: 7, weekendDays: 2 }],
] as const;

describe.skipIf(noEngine)("the header's clock on the engine", () => {
  for (const [name, mode, calendar, expected, days] of TOWERS) {
    it(`${name}: the engine dates each minute, and reports its week`, () => {
      const save = newEngine(1, mode, calendar).serialize();
      MINUTES.forEach((minutes, i) => {
        const moved = JSON.stringify({ ...(JSON.parse(save) as Record<string, unknown>), minutes });
        expect(readings(clockOf(newViewReader(engineFromSave(moved)).header)), `at minute ${minutes}`).toEqual(expected[i]);
      });
      expect(calendarOf(newViewReader(newEngine(1, mode, calendar)).header)).toMatchObject(days);
    });
  }
});

const MODES: HeatmapMode[] = ["congestion", "occupancy", "satisfaction", "cleanliness"];
const SPOTS = [[1, 170], [2, 170], [3, 200], [4, 170]] as const;

function renderTower() {
  const d = smallTower((t) => {
    for (const x of [170, 180, 200]) must(t.build("office", 2, x), `office at ${x}`);
    must(t.build("hotelSingle", 3, 170), "hotel room");
    must(t.build("fastFood", 3, 200), "fast food");
    must(t.buildTransport("elevatorStandard", 162, 1, 3), "elevator");
    must(t.buildTransport("stairs", 275, 1, 2), "stairs");
  });
  const engine = engineFromSave(d.saveText());
  const reader = newViewReader(engine);
  return { engine, reader, r: newRenderSim(engine, reader) };
}

describe.skipIf(noEngine)("PortRenderSim on the engine", () => {
  it("reads the founded tower, then follows the frame through play", () => {
    const { engine, reader, r } = renderTower();
    expect([r.mode, r.rng.initialSeed, r.view, r.weather, r.population]).toEqual(["modern", 5, null, "clear", 0]);
    expect([r.santaFxSeq, r.vipFxSeq, r.explosionFx.seq, r.thiefFx.seq, r.treasureFx.seq]).toEqual([0, 0, 0, 0, 0]);
    expect([r.congestion(), r.peakCongestion(), r.recyclingFill()]).toEqual([0, 0, 0]);
    expect([...r.tower.functionalParkingSet()]).toEqual([]);
    expect([0, 2, 30].map((spots) => r.parkingUsage(spots))).toEqual([0, 0, 0]);
    // Floor 4 has nothing built, so nothing on it is reachable.
    expect(SPOTS.map(([floor, x]) => r.positionReachable(floor, x))).toEqual([true, true, true, false]);
    for (let i = 0; i < 8; i++) {
      engine.tick(75);
      reader.update();
      const h = reader.header;
      expect([r.population, r.clock.minutes], `step ${i}`).toEqual([h.population, h.minutes]);
      expect([r.clock.hour, r.clock.minute], `step ${i}`).toEqual([Math.floor((h.minutes % 1440) / 60), Math.floor(h.minutes % 60)]);
      expect(r.crowd.people.map((p) => p.id)).toEqual(reader.crowd.people.map((p) => p.id));
      expect(r.peakCongestion()).toBeGreaterThanOrEqual(r.congestion());
      for (const m of MODES) expect(Array.isArray(r.floorHeatmap(m)), m).toBe(true);
    }
    // Ten hours on, tenants have moved in and the lobby has a crowd.
    expect(r.population).toBeGreaterThan(0);
    expect(r.congestion()).toBeGreaterThan(0);
    expect(r.floorHeatmap("occupancy").length).toBeGreaterThan(0);
  });

  it("keeps the queue projection until the clock or the tower moves", () => {
    const { engine, reader, r } = renderTower();
    engine.tick(600);
    reader.update();
    const q = r.crowd.queueView(r.tower);
    expect(r.crowd.queueView(r.tower)).toBe(q);
    engine.tick(1);
    reader.update();
    expect(r.crowd.queueView(r.tower)).not.toBe(q);
  });
});
