import { describe, expect, it } from "vitest";
import { catalogOn } from "../../catalog/towerCatalog";
import { newViewReader } from "../../game/portAccess";
import type { EnginePort } from "../../simport/enginePort";
import type { CalendarKind } from "../../shared/engineTypes";
import { Cards } from "../../simport/cards";
import { catalogCalendar, rentPerCollection } from "../../ui/catalogPricing";
import { MID, layTile, mustBuild, newSeededDraft, placeUnit } from "../portKit/draftFixtures";
import { engineFromSave, noEngine } from "../portKit/rustEngine";

/**
 * What the room card says an office pays each quarter against what the Rust
 * engine collects (#2107). A Modern tower on the short 1994 calendar scales a
 * quarterly rent to its three-day quarter, so the card's figure must be the
 * engine's collection, not the rate. The unit tests
 * (`src/ui/catalogPricing.test.ts`, `src/ui/templates/editor.test.ts`) check
 * the arithmetic and the wording alone.
 */

const MINUTES_PER_DAY = 1440;
const MINUTES_PER_HOUR = 60;
const RENT_LINE = /^Quarterly office rent collected: \$([\d,]+) \((\d+) offices?\)\.$/;
const RENTAL_LINE = /^Monthly rent collected: \$([\d,]+) \((\d+) rentals?\)\.$/;

type Save = { minutes: number; units: Record<string, unknown>[]; log: { text: string }[] };
/** The tooling build's raw clock move, which the test engine carries and the
 *  game's port does not declare (as `wasmHostLogText.integration.test.ts`
 *  uses it). */
type ClockedEngine = EnginePort & { advanceClock(minutes: number): void };
const saveOf = (engine: EnginePort): Save => JSON.parse(engine.serialize()) as Save;

/** A tower of `mode` on `calendar` with one room of `kind` on floor 2 that
 *  already has its tenant, served by a standard elevator from the lobby. */
function towerWithTenant(mode: "classic" | "modern", calendar: CalendarKind, kind: "office" | "rentalStudio" = "office"): { engine: ClockedEngine; id: number } {
  // The seed is one whose run across the quarter draws no fire in the office
  // (seed 7 does, and a burning office pays nothing).
  const draft = newSeededDraft(42, mode, calendar);
  draft.money = 1e9;
  draft.star = 3;
  // Floor 2 over the 40-tile starter lobby (MID - 20 to MID + 19).
  for (let x = MID - 20; x < MID + 20; x++) layTile(draft, "floor", 2, x);
  const id = placeUnit(draft, kind, 2, MID + 4).id;
  mustBuild(draft, "elevatorStandard", MID - 6, 1, 2);
  const save = JSON.parse(draft.saveText()) as Save;
  for (const u of save.units) {
    if (u.id === id) Object.assign(u, { state: "occupied", everOccupied: true, occupants: 6 });
  }
  return { engine: engineFromSave(JSON.stringify(save)) as ClockedEngine, id };
}

/** Run the clock across the next end of a `periodDays` period and return the
 *  amount and count of the one log line `line` matches. */
function nextCollection(engine: ClockedEngine, periodDays: number, line: RegExp = RENT_LINE): { amount: number; count: number } {
  const minutes = saveOf(engine).minutes;
  let day = (Math.floor(minutes / MINUTES_PER_DAY / periodDays) + 1) * periodDays;
  while (day * MINUTES_PER_DAY - MINUTES_PER_HOUR <= minutes) day += periodDays;
  engine.advanceClock(day * MINUTES_PER_DAY - MINUTES_PER_HOUR - minutes);
  const seen = saveOf(engine).log.length;
  for (let h = 0; h < 3; h++) engine.tick(MINUTES_PER_HOUR);
  const lines = saveOf(engine).log.slice(seen).map((e) => line.exec(e.text)).filter((m) => m !== null);
  expect(lines, "one rent line at the period's end").toHaveLength(1);
  return { amount: Number(lines[0][1].replace(/,/g, "")), count: Number(lines[0][2]) };
}

describe.skipIf(noEngine)("the room card's quarterly rent against the engine's collection (#2107)", () => {
  const cases: { mode: "classic" | "modern"; calendar: CalendarKind; scaled: boolean }[] = [
    { mode: "modern", calendar: "canon", scaled: true },
    { mode: "modern", calendar: "realWorld", scaled: false },
    { mode: "classic", calendar: "canon", scaled: false },
  ];
  for (const { mode, calendar, scaled } of cases) {
    it(`${mode} on the ${calendar} calendar collects what the card shows`, () => {
      const { engine, id: office } = towerWithTenant(mode, calendar);
      const catalog = catalogOn(engine, mode);
      const cal = catalogCalendar(catalog, calendar);
      const price = new Cards(engine, newViewReader(engine)).unit(office)!.price;
      const shown = rentPerCollection("quarterly", price, cal);
      const collected = nextCollection(engine, cal.quarterDays);
      expect(collected.count).toBe(1);
      expect(collected.amount).toBe(shown);
      // The short calendar is the case the report met: the rate is not what lands.
      if (scaled) expect(collected.amount).toBeLessThan(price);
      else expect(collected.amount).toBe(price);
    });
  }

  it("a Modern rental on the short calendar collects the monthly rent the card shows", () => {
    const { engine, id: rental } = towerWithTenant("modern", "canon", "rentalStudio");
    const cal = catalogCalendar(catalogOn(engine, "modern"), "canon");
    const price = new Cards(engine, newViewReader(engine)).unit(rental)!.price;
    const collected = nextCollection(engine, cal.maintenancePeriodDays, RENTAL_LINE);
    expect(collected.count).toBe(1);
    expect(collected.amount).toBe(rentPerCollection("maintenancePeriod", price, cal));
    expect(collected.amount).toBeLessThan(price);
  });
});
