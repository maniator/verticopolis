import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { WasmEngine } from "../../dualrun/binding";
import type { SerializedGame } from "../../shared/serializedGame";
import { catalogFor } from "../catalogFixture";
import { REPO_ROOT } from "../conformance/scenario";
import { hasWasmPackage, wasm } from "../conformance/wasmEngine";
import { FIXTURES } from "../conformance/fixtureSim";

/**
 * The log's prose on the Rust engine. The conformance view drops log text (it
 * pins each entry's minute and kind), so a line the engine words or formats
 * wrongly (a dollar amount without its thousands separators, a flattened
 * plural) would reach a player unnoticed. Each fixture opens the way the game
 * opens a file, runs a day, then the clock jumps to just before the next
 * quarter and the next maintenance period and runs across them, so the rent,
 * maintenance and checkout lines with their large amounts are written.
 */

const MINUTES_PER_DAY = 1440;
const MINUTES_PER_HOUR = 60;

const engineSave = (engine: WasmEngine) => JSON.parse(engine.serialize()) as SerializedGame & { log: { text: string }[] };

function run(engine: WasmEngine, hours: number): void {
  for (let h = 0; h < hours; h++) engine.tick(MINUTES_PER_HOUR);
}

/** Move the clock, raw, to an hour before the next multiple of `period` days
 *  that lies at least an hour ahead. */
function jumpBefore(engine: WasmEngine, period: number): void {
  const minutes = engineSave(engine).minutes;
  let day = (Math.floor(minutes / MINUTES_PER_DAY / period) + 1) * period;
  while (day * MINUTES_PER_DAY - MINUTES_PER_HOUR <= minutes) day += period;
  engine.advanceClock(day * MINUTES_PER_DAY - MINUTES_PER_HOUR - minutes);
}

/** The calendar the save runs: a Modern tower's own choice, else its mode's
 *  default (the first the catalog lists). */
function calendarOf(save: SerializedGame) {
  const calendars = catalogFor(save.mode ?? "classic").economy.calendars;
  return calendars.find((c) => c.key === save.modernCalendar) ?? calendars[0];
}

/** One fixture's run; returns every line the engine wrote. */
function linesOf(fixture: string): string[] {
  const engine = wasm().Engine.fromVctower(readFileSync(resolve(REPO_ROOT, fixture), "utf8"));
  try {
    run(engine, 24);
    const calendar = calendarOf(engineSave(engine));
    jumpBefore(engine, calendar.quarterDays);
    run(engine, 48);
    jumpBefore(engine, calendar.maintenancePeriodDays);
    run(engine, 48);
    return engineSave(engine).log.map((e) => e.text);
  } finally {
    engine.free();
  }
}

/** A dollar amount as the log writes it: whole dollars, grouped in threes. */
const GROUPED_DOLLARS = /^\$\d{1,3}(,\d{3})*$/;
/** A counted noun the log pluralizes by its count. */
const COUNTED = /(\d[\d,]*) (office|condo|clinic|club|rental|hotel room)(s?)\b(?!\()/g;

/** The money lines whose wording and amount format are at stake: each line
 *  that opens with `prefix` must read exactly as `pattern`. */
const MONEY_LINES = [
  { prefix: "Quarterly office rent collected:", pattern: /^Quarterly office rent collected: \$[\d,]+ \(\d[\d,]* offices?\)\.$/ },
  { prefix: "Monthly maintenance paid:", pattern: /^Monthly maintenance paid: \$[\d,]+\.$/ },
  { prefix: "Maintenance paid:", pattern: /^Maintenance paid: \$[\d,]+\.$/ },
  { prefix: "Hotel guests checked out:", pattern: /^Hotel guests checked out: \$[\d,]+ earned overnight\.$/ },
] as const;

describe.skipIf(!hasWasmPackage())("log text on the Rust engine", () => {
  it("every fixture across a day, a quarter and a maintenance period", () => {
    const lines = FIXTURES.flatMap(linesOf);
    for (const line of lines) {
      for (const [amount] of line.matchAll(/\$[\d,]*\d/g)) expect(amount, line).toMatch(GROUPED_DOLLARS);
      for (const [, count, , plural] of line.matchAll(COUNTED)) {
        expect(plural === "", `${line}: the noun agrees with ${count}`).toBe(count === "1");
      }
    }
    // The runs wrote the lines whose formatting is at stake: a grouped dollar
    // amount, the quarterly rent, the maintenance bill and the hotel checkout,
    // each worded and formatted as a player reads it.
    expect(lines.some((t) => /\$\d{1,3}(,\d{3})+/.test(t)), "a grouped dollar amount").toBe(true);
    for (const { prefix, pattern } of MONEY_LINES) {
      const written = lines.filter((t) => t.startsWith(prefix));
      expect(written.length, `a "${prefix}" line`).toBeGreaterThan(0);
      for (const line of written) expect(line).toMatch(pattern);
    }
  }, 300_000);
});
