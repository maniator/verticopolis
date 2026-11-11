import { describe, it, expect } from "vitest";
import type { TemplateResult } from "lit-html";
import type { TransportDetail, UnitDetail } from "../../simport/panels";
import type { FacilityKind } from "../../shared/types";
import { catalogFor } from "../../tests/catalogFixture";
import { transportDetail, unitDetail } from "../../tests/fixtures/detailCards";
import { buildRefusalTemplate, transportInspectorTemplate, unitInspectorTemplate } from "./inspector";
import { renderToFragment } from "../testing/litTestUtils";

/**
 * The hover inspector card bodies (E6-S2). Package: every branch of the card
 * (rename subheading shown/suppressed, basement floor text, on-notice
 * statuses, customers open/closed vs occupants, subtype title, elevator cars
 * row, refusal tooltip), the hostile-input hardening, and the templates'
 * contract that the ✕ is NOT theirs (showInspector appends it from the
 * shared titleBarClose recipe; wiring pinned by the integration tests). The
 * templates were proven structurally equivalent to the inline strings they
 * replaced by transitional guards against verbatim replicas of the deleted
 * code (removed in the final sweep; see git history for the replica oracle).
 * The cards are hand-built (`detailCards.ts`); the cards the engine answers
 * are decoded in `cards.test.ts` and `portReader.integration.test.ts`.
 */

// ---- Fixtures ---------------------------------------------------------------

/** The 07:00 a new tower opens at: a shop (10:00 to 21:00) is closed. */
const MORNING = 7;

const unit = (kind: FacilityKind, over: Partial<UnitDetail> = {}) => unitDetail("classic", kind, over);

function unitInspector(u: UnitDetail, hour = MORNING): TemplateResult {
  return unitInspectorTemplate(u, catalogFor("classic"), hour, []);
}

function transportInspector(t: TransportDetail): TemplateResult {
  return transportInspectorTemplate(t, catalogFor("classic"), []);
}

// ---- Tests ------------------------------------------------------------------

describe("unit inspector card branches", () => {
  it("occupied office: catalog title, floor line, occupants, satisfaction", () => {
    const frag = renderToFragment(unitInspector(unit("office", { satisfaction: 0.73, occupants: 4 })));
    expect(frag.querySelector("h4.win-title")!.textContent).toBe("Office");
    expect(frag.textContent).toContain("Floor 2");
    expect(frag.textContent).toContain("Status: occupied");
    expect(frag.textContent).toMatch(/Occupants: \d+\/\d+/);
    expect(frag.textContent).toContain("Satisfaction: 73%");
  });

  it("hotel lifecycle states read in plain language (dirty / asleep / infested)", () => {
    expect(renderToFragment(unitInspector(unit("hotelSingle", { state: "dirty" }))).textContent).toContain(
      "Status: dirty (awaiting housekeeping)",
    );
    expect(renderToFragment(unitInspector(unit("hotelSingle", { state: "asleep" }))).textContent).toContain(
      "Status: occupied (guest asleep)",
    );
    expect(renderToFragment(unitInspector(unit("hotelSingle", { state: "infested" }))).textContent).toContain(
      "Status: cockroach infested",
    );
  });

  it("rename subheading: shown for a real rename, suppressed when it matches the title", () => {
    const fragR = renderToFragment(unitInspector(unit("office", { label: "Acme Corp" })));
    expect(fragR.textContent).toContain("Acme Corp");
    // A label that matches the catalog name
    expect(renderToFragment(unitInspector(unit("office", { label: "Office" }))).querySelector("br")).toBeNull();
    // The comment's own scenario: a shop renamed to exactly its subtype shown
    // in the title must not render the name twice (the second condition of
    // labelIsExtra is the load-bearing one here).
    const fragS = renderToFragment(unitInspector(unit("shop", { subtype: "Chinese Cafe", label: "Chinese Cafe" })));
    expect(fragS.querySelector("h4")!.textContent).toBe("Chinese Cafe");
    expect(fragS.querySelector("br")).toBeNull(); // subheading suppressed
  });

  it("on-notice statuses: tenant leaving vs household relocating", () => {
    const fragL = renderToFragment(unitInspector(unit("office", { state: "vacating", vacateReason: "rent" })));
    expect(fragL.textContent).toContain("on notice (tenant leaving)");
    const fragM = renderToFragment(unitInspector(unit("condo", { state: "vacating", vacateReason: "relocation" })));
    expect(fragM.textContent).toContain("on notice (household relocating)");
  });

  it("commercial venue: subtype title, live customers, and the closed marker", () => {
    const shop = unit("shop", { subtype: "Chinese Cafe", customersIn: 5 });
    // A shop (10:00 to 21:00) is closed at 07:00 and open at noon.
    const frag = renderToFragment(unitInspector(shop));
    expect(frag.querySelector("h4")!.textContent).toBe("Chinese Cafe");
    expect(frag.textContent).toContain("Customers: 5 (closed)");
    const openFrag = renderToFragment(unitInspector(shop, 12));
    expect(openFrag.textContent).toContain("Customers: 5");
    expect(openFrag.textContent).not.toContain("(closed)");
  });

  it("commercial edge arms: an untracked customer count reads 0, and a vacant venue is never 'closed'", () => {
    // An untracked count → the ?? 0 fallback; at 07:00 the closed marker
    // also applies (tenanted).
    const frag = renderToFragment(unitInspector(unit("shop", { customersIn: null })));
    expect(frag.textContent).toContain("Customers: 0 (closed)");
    // A non-tenanted venue outside business hours: the Status row tells the
    // story, so the customers line carries no "(closed)".
    const vFrag = renderToFragment(unitInspector(unit("shop", { state: "empty", customersIn: 0 })));
    expect(vFrag.textContent).toContain("Customers: 0");
    expect(vFrag.textContent).not.toContain("(closed)");
  });

  it("basement facility reads a B floor tag and a zero-population kind has no census row", () => {
    const frag = renderToFragment(unitInspector(unit("parking", { floor: 0 })));
    expect(frag.textContent).toContain("B1");
    expect(frag.textContent).not.toContain("Occupants");
  });

  it("renders a hostile label as literal text, injecting no element, and ships no ✕ of its own", () => {
    const hostile = `<img src=x onerror="alert(1)">`;
    const frag = renderToFragment(unitInspector(unit("office", { label: hostile })));
    expect(frag.querySelector("img")).toBeNull();
    expect(frag.textContent).toContain(hostile);
    // The mobile ✕ belongs to showInspector (the shared titleBarClose recipe),
    // never to the template, or the card would grow a second one per render.
    expect(frag.querySelector("h4 button")).toBeNull();
  });
});

describe("transport inspector card branches", () => {
  it("standard elevator (cars row) and stairs (no cars row)", () => {
    const frag = renderToFragment(transportInspector(transportDetail("elevatorStandard", 2, { cars: 3 })));
    expect(frag.textContent).toContain("Cars: 3");
    expect(renderToFragment(transportInspector(transportDetail("stairs"))).textContent).not.toContain("Cars:");
  });
});

describe("build-refusal tooltip", () => {
  it("wraps the reason in the win-title grammar and escapes a hostile reason", () => {
    const frag = renderToFragment(buildRefusalTemplate("Needs a lobby below."));
    expect(frag.querySelector("h4.win-title")!.textContent).toBe("Can't build here");
    expect(frag.querySelector("div.preview-refuse")!.textContent).toBe("Needs a lobby below.");
    const hostile = `<img src=x onerror="alert(1)">`;
    const hostileFrag = renderToFragment(buildRefusalTemplate(hostile));
    expect(hostileFrag.querySelector("img")).toBeNull();
    expect(hostileFrag.querySelector(".preview-refuse")!.textContent).toBe(hostile);
  });
});
