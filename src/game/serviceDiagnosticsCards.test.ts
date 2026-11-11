import { describe, expect, it, vi } from "vitest";
import { html } from "lit-html";
import type { ServiceDiagnosticFacts } from "../simport/enginePort";
import type { ViewReader } from "../simport/viewReader";
import { LAYOUT, code, mockPort, record } from "../tests/portKit/mockPort";
import { renderToFragment } from "../ui/testing/litTestUtils";
import { unitEditorTemplate } from "../ui/templates/editor";
import { unitInspectorTemplate } from "../ui/templates/inspector";
import { createCardKit } from "./cardKit";

/**
 * The service sections on a unit's card, through the card kit over a mock
 * port: the engine's service facts reach the editor and the inspector, the
 * kit reads them once until it is told the tower moved, and a unit with no
 * service facts adds no service lines. The wording of each section is
 * `portServiceDiagnostics.test.ts`; the facts on the Rust engine (an inert
 * unit's sections switched off included) are
 * `portServiceDiagnostics.integration.test.ts`.
 */

const ID = 40;

const NONE: ServiceDiagnosticFacts = {
  hotel: { rating: "notApplicable", condition: "other", infestDays: null, recovery: null },
  parking: { status: "notApplicable", shortage: null, have: null, total: null, offices: null, suites: null },
  retail: { active: false, today: null, barWidth: null, tier: "notApplicable", localDemandPct: null, advice: "none", profitYest: null, rainy: null },
  commercial: { lobbyFar: null },
  housekeeping: {
    status: "notApplicable", crews: null, maids: null, rooms: null, maidsPerUnit: null, roomsPerMaid: null,
    cleaned: null, leftover: null, infested: null, outOfReach: null, hasInfested: null, hasOutOfReach: null, recovery: null,
  },
};

const DIRTY_HOTEL: ServiceDiagnosticFacts = { ...NONE, hotel: { rating: "excluded", condition: "dirty", infestDays: 3, recovery: false } };
const INFESTED_HOTEL: ServiceDiagnosticFacts = { ...NONE, hotel: { rating: "excluded", condition: "infested", infestDays: null, recovery: true } };
const HOUSEKEEPING: ServiceDiagnosticFacts = {
  ...NONE,
  housekeeping: { ...NONE.housekeeping, status: "adequate", crews: 1, maids: 6, rooms: 10, maidsPerUnit: 6, roomsPerMaid: 2, cleaned: 10, leftover: 0, infested: 0, outOfReach: 0, hasInfested: false, hasOutOfReach: false, recovery: false },
};
const SHOP: ServiceDiagnosticFacts = { ...NONE, retail: { active: true, today: 3, barWidth: 1, tier: "low", localDemandPct: null, advice: "none", profitYest: 100, rainy: false } };

/** A kit whose port answers one occupied unit of `kind` with `facts`. */
function kitFor(kind: string, facts: ServiceDiagnosticFacts | undefined) {
  const port = mockPort({
    unitCard: () => record("unitCard", { id: ID, kindCode: code("kinds", kind), floor: 2, x: 170, width: 9, stateCode: code("unitStates", "occupied"), rent: NaN, price: 0, vacateReason: NaN, filmPolicy: NaN, blockbuster: NaN, served: 1, reachable: 1, floorHasLobby: 1 }),
    unitLabel: () => undefined,
    unitSubtype: () => undefined,
    unitFacts: () => record("unitFacts", { id: ID, access: (LAYOUT as unknown as { accessLines: string[] }).accessLines.indexOf("reachable") }),
    serviceDiagnostics: () => facts,
    generation: () => 1,
  });
  const header = { revision: 1, minutes: 600, minuteOfDay: 600, population: 100, star: 4, mode: "classic" };
  const reader = { header, tower: { revision: 1 } } as unknown as ViewReader;
  const kit = createCardKit({ enginePort: port, reader });
  const copy = (fresh = true) => renderToFragment(html`${kit.diagnostics.unit(ID, fresh)}`).textContent ?? "";
  return { port, kit, header, copy };
}

describe("service sections on a unit's card", () => {
  it("shows a dirty hotel's warnings in the editor and the inspector, and an infested one's", () => {
    const { kit, copy } = kitFor("hotelSingle", DIRTY_HOTEL);
    const lines = kit.diagnostics.unit(ID, true);
    const unit = kit.cards.unit(ID)!;
    const mobile = renderToFragment(unitEditorTemplate(unit, kit.catalog(), 12, true, lines));
    const desktop = renderToFragment(unitInspectorTemplate(unit, kit.catalog(), 12, lines));
    for (const target of [mobile.textContent, desktop.textContent]) {
      expect(target).toContain("Counts toward stars: no");
      expect(target).toContain("Left dirty for 3 days");
    }
    expect(copy()).toContain("Left dirty for 3 days");
    const infested = kitFor("hotelSingle", INFESTED_HOTEL).copy();
    expect(infested).toContain("Cockroach infested");
    expect(infested).toContain("Call an exterminator");
  });

  it("reads the engine's facts once until it is told the tower moved, and never repeats a line", () => {
    const { port, kit, header, copy } = kitFor("housekeeping", HOUSEKEEPING);
    const text = copy();
    expect(text.match(/Fields 6 maids/g)).toHaveLength(1);
    expect(port.serviceDiagnostics).toHaveBeenCalledExactlyOnceWith(ID);
    for (let i = 0; i < 8; i++) expect(copy(false)).toBe(text);
    expect(port.serviceDiagnostics, "the kit kept the lines it read").toHaveBeenCalledOnce();
    kit.diagnostics.invalidate();
    expect(copy(false)).toBe(text);
    expect(port.serviceDiagnostics).toHaveBeenCalledTimes(2);
    header.revision = 2;
    copy(false);
    expect(port.serviceDiagnostics, "a new revision reads again").toHaveBeenCalledTimes(3);
    copy(true);
    expect(port.serviceDiagnostics, "a fresh read always asks").toHaveBeenCalledTimes(4);
  });

  it("keeps a shop's patronage to one line through the cache and a refresh", () => {
    const { kit, copy } = kitFor("shop", SHOP);
    const first = copy();
    expect(first.split("Today's patronage:")).toHaveLength(2);
    expect(first.split("Very few customers.")).toHaveLength(2);
    for (let i = 0; i < 8; i++) expect(copy(false)).toBe(first);
    kit.diagnostics.invalidate();
    expect(copy().split("Today's patronage:")).toHaveLength(2);
  });

  it("adds no service lines for a unit the engine gives no service facts", () => {
    const office = kitFor("office", NONE).copy();
    expect(office).not.toMatch(/Ramp access:|Counts toward stars:|maids/);
    expect(kitFor("office", undefined).copy(), "the tenant lines alone").toBe(office);
  });

  it("asks for the unit it shows", () => {
    const { port, copy } = kitFor("hotelSingle", DIRTY_HOTEL);
    copy();
    expect(vi.mocked(port.unitCard).mock.calls[0]).toEqual([ID]);
    expect(port.unitFacts).toHaveBeenCalledWith(ID);
  });
});
