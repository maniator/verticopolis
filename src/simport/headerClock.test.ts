import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { Simulation } from "../engine/Simulation";
import type { SerializedGame } from "../engine/serializedGame";
import { decodeVctower } from "../storage/vctowerContainer";
import { calendarOf, clockOf, rulesOf, type ClockView } from "./headerClock";
import { facilityFloors } from "../engine/facilities";
import { TsEngine } from "../engine/port/tsEngine";
import { ViewReader } from "./viewReader";

/** The header the panels read for `sim`, through the port and the reader. */
const headerOf = (sim: Simulation) => new ViewReader(new TsEngine(sim), facilityFloors).header;

/**
 * A panel's clock and rule set, derived from the header alone, read the same
 * as the `Simulation`'s own on every mode and calendar a save can found.
 */
describe("headerClock", () => {
  const towers = [
    ["classic", () => Simulation.newGame(1, "classic")],
    ["modern on the canon calendar", () => Simulation.newGame(1, "modern", "canon")],
    ["modern on the real-world calendar", () => Simulation.newGame(1, "modern", "realWorld")],
  ] as const;

  const readings = (c: ClockView) => [
    c.minutes,
    c.minuteOfDay,
    c.hour,
    c.minute,
    c.day,
    c.dayOfWeek,
    c.isWeekend,
    c.quarter,
    c.dayName,
    c.year,
    c.format(),
    c.formatRetroDate(),
  ];

  // The founding minute, the next one, an evening, a weekend day, a quarter
  // boundary on the canon calendar, past a canon year and past a real one.
  const MINUTES = [420, 421, 1020, 1440 * 5 + 600, 1440 * 30 + 1, 1440 * 93, 1440 * 365 + 7, 1440 * 400 + 1439];

  for (const [name, found] of towers) {
    it(`${name}: the header's clock reads as the engine's, minute by minute`, () => {
      const sim = found();
      const engine = new TsEngine(sim);
      const reader = new ViewReader(engine, facilityFloors);
      // The tower ticks once so the clock is the running one, then moves to
      // each minute directly: the readings are pure functions of the minute.
      engine.tick(1);
      for (const m of MINUTES) {
        sim.clock.minutes = m;
        reader.update();
        expect(readings(clockOf(reader.header)), `at minute ${m}`).toEqual(readings(sim.clock));
      }
    });

    it(`${name}: the header's rule set is the engine's`, () => {
      const sim = found();
      expect(rulesOf(headerOf(sim))).toBe(sim.rules);
    });

    it(`${name}: the header's calendar is the engine's`, () => {
      const sim = found();
      expect(calendarOf(headerOf(sim))).toBe(sim.clock.calendar);
    });
  }

  it("reads a loaded save's clock as the engine does, on every conformance save", () => {
    const dir = resolve(__dirname, "../../conformance/fixtures");
    const saves = readdirSync(dir).filter((f) => f.endsWith(".vctower"));
    expect(saves.length).toBeGreaterThan(0);
    for (const f of saves) {
      const sim = Simulation.deserialize(decodeVctower(readFileSync(resolve(dir, f), "utf8"), f) as SerializedGame);
      const header = headerOf(sim);
      expect(readings(clockOf(header)), f).toEqual(readings(sim.clock));
      expect(rulesOf(header), f).toBe(sim.rules);
    }
  });

  it("reads minute zero as midnight of the first day", () => {
    // The Clock constructor reads 0 as a new tower and starts it at 07:00.
    const c = clockOf({ minutes: 0, mode: "modern", modernCalendar: "realWorld" });
    expect([c.minutes, c.minuteOfDay, c.hour, c.minute, c.day]).toEqual([0, 0, 0, 0, 0]);
    const nextDay = clockOf({ minutes: 1440, mode: "modern", modernCalendar: "realWorld" });
    expect([c.dayOfWeek, c.format(), nextDay.dayOfWeek, nextDay.format()]).toEqual([0, "Mon 00:00", 1, "Tue 00:00"]);
  });
});
