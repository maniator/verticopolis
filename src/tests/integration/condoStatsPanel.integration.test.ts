import { describe, it, expect } from "vitest";
import { catalogFacility } from "../../catalog/catalogTypes";
import { statsBodyOf } from "../../ui/templates/stats.fixture";
import { renderToFragment } from "../../ui/testing/litTestUtils";
import { portOf, unitEditor } from "../../game/cardKit.fixture";
import { PortCodes } from "../../simport/portCodes";
import { groupDigits } from "../../ui/format";
import { catalogFor } from "../catalogFixture";
import { LOT_WIDTH, lay, mustBuild } from "../portKit/draftFixtures";
import { draftTower, type Draft } from "../portKit/drafts";
import { noEngine } from "../portKit/rustEngine";

/**
 * The stats dialog's Households readout and the sold-condo editor price,
 * driven by real move-ins over ticked time on the Rust engine (split from
 * `condoModes.integration.test.ts` when that suite reached the file-size
 * ceiling; the condo rule-set tests stay there).
 */

const C = Math.floor(LOT_WIDTH / 2);

/** A unit's record as the engine holds it now. */
interface CondoRecord {
  id: number;
  state: string;
  satisfaction: number;
  everOccupied?: boolean;
  residents?: number;
}

/** A served, sale-ready condo on a fresh tower (same idiom as condoModes);
 *  answers its id. */
function servedCondo(sim: Draft): number {
  sim.money = 1e9;
  sim.star = 1; // no random fire/bomb events to perturb the run
  lay(sim, "lobby", 1);
  lay(sim, "floor", 2);
  mustBuild(sim, "elevatorStandard", C, 1, 2);
  const r = sim.tower.place("condo", 2, C + 4);
  expect(r.ok).toBe(true);
  const condo = unit(sim, r.unitId!);
  condo.state = "empty"; // skip the construction phase
  condo.satisfaction = 1;
  return r.unitId!;
}

const unit = (sim: Draft, id: number): CondoRecord => sim.tower.getUnit(id) as unknown as CondoRecord;

/** The tower's population, from the engine's stats strip. */
function population(sim: Draft): number {
  const port = portOf(sim);
  return new PortCodes(port).slot(port.statsStrip(), "statsStrip", "population");
}

/** Tick hours until a predicate holds (or we give up), so RNG-driven move-ins
 *  and evictions can resolve without hard-coding a tick count. */
function tickUntil(sim: Draft, pred: () => boolean, maxHours = 24 * 40): boolean {
  for (let i = 0; i < maxHours && !pred(); i++) sim.tick(60);
  return pred();
}

describe.skipIf(noEngine)("Not-present households never ghost the readout (gutted/empty)", () => {
  it("excludes a gutted sold condo from both population and the Households section", async () => {
    const sim = draftTower(3, "modern");
    const id = servedCondo(sim);
    expect(tickUntil(sim, () => unit(sim, id).everOccupied === true)).toBe(true);
    expect(population(sim)).toBe(unit(sim, id).residents);
    expect(renderToFragment(statsBodyOf(sim)).textContent).toContain("People housed");
    // A fire guts the only sold condo: it stops being present.
    unit(sim, id).state = "gutted";
    // Population drops it (isPresent false) …
    expect(population(sim)).toBe(0);
    // … and the Households readout drops it too — no ghost family, back to the
    // empty-state placeholder rather than a stale "People housed".
    expect(renderToFragment(statsBodyOf(sim)).textContent).toContain("No households yet");
  });
});

describe.skipIf(noEngine)("Stats panel — Households section (Modern only)", () => {
  it("shows a Households section on a Modern tower, and not on a Classic one", async () => {
    const modern = draftTower(3, "modern");
    const mc = servedCondo(modern);
    expect(tickUntil(modern, () => unit(modern, mc).everOccupied === true)).toBe(true);
    const modernText = renderToFragment(statsBodyOf(modern)).textContent!;
    expect(modernText).toContain("Households");
    expect(modernText).toMatch(/Avg household/);

    const classic = draftTower(3, "classic");
    const cc = servedCondo(classic);
    expect(tickUntil(classic, () => unit(classic, cc).everOccupied === true)).toBe(true);
    expect(renderToFragment(statsBodyOf(classic)).textContent).not.toContain("Households");
  });

  it("shows a sold Modern condo's editor price as the household-scaled amount (what buy-back reclaims)", async () => {
    const sim = draftTower(7, "modern");
    const id = servedCondo(sim);
    expect(tickUntil(sim, () => unit(sim, id).everOccupied === true)).toBe(true);
    // A sold condo keeps the catalog's sale price, scaled by its household over 3.
    const sale = catalogFacility(catalogFor("modern"), "condo").rent!.default;
    const expected = Math.round((sale * unit(sim, id).residents!) / 3);
    expect(renderToFragment(unitEditor(sim, { id })).querySelector('[data-field="rent"]')!.textContent).toBe(`$${groupDigits(expected)}`);
  });

  it("keeps 'People housed' equal to the census even when a sold condo lacks residents", async () => {
    // A corrupt/hand-edited Modern save: a present, sold condo with no household.
    // The census (residentCount) falls back to the classic 3, so the readout must
    // too — otherwise People housed would undercount total population.
    const sim = draftTower(3, "modern");
    const a = servedCondo(sim);
    expect(tickUntil(sim, () => unit(sim, a).everOccupied === true)).toBe(true); // a real household (2–5)
    const b = sim.tower.place("condo", 2, C + 24);
    expect(b.ok).toBe(true);
    const bare = unit(sim, b.unitId!);
    bare.state = "occupied";
    bare.everOccupied = true;
    bare.residents = undefined; // sold but no household on the record
    const pop = population(sim);
    expect(pop).toBe(unit(sim, a).residents! + 3); // census counts the bare condo as 3
    const cell = [...renderToFragment(statsBodyOf(sim)).querySelectorAll("span.k")].find((el) => el.textContent === "People housed")!.nextElementSibling!;
    // Locale-proof digit-strip parse (toLocaleString's separator varies).
    expect(Number(cell.textContent!.replace(/\D/g, ""))).toBe(pop); // agrees with the census
  });
});
