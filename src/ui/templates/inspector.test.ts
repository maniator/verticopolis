import { describe, it, expect } from "vitest";
import { Simulation } from "../../engine/Simulation";
import { GRID } from "../../engine/facilities";
import type { Transport, Unit } from "../../engine/types";
import { unitInspectorTemplate, transportInspectorTemplate, buildRefusalTemplate } from "./inspector";
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
 */

// ---- Fixtures ---------------------------------------------------------------

/** A built tower carrying one unit of the requested kind on full-width floors,
 *  every placement asserted so a broken fixture can't pass silently. */
function simWith(kind: Parameters<Simulation["tower"]["place"]>[0], floor = 2): { sim: Simulation; unit: Unit } {
  const sim = new Simulation();
  for (let x = 0; x < GRID.width; x++) expect(sim.tower.place("lobby", 1, x).ok).toBe(true);
  const floors = floor >= 1 ? [2] : [0];
  for (const fl of floors) for (let x = 0; x < GRID.width; x++) expect(sim.tower.place("floor", fl, x).ok).toBe(true);
  const r = sim.tower.place(kind, floor, 40);
  expect(r.ok).toBe(true);
  const unit = sim.tower.units.find((u) => u.id === r.unitId)!;
  unit.state = "occupied";
  return { sim, unit };
}

function withLift(kind: "elevatorStandard" | "stairs"): { sim: Simulation; lift: Transport } {
  const { sim } = simWith("office");
  expect(sim.tower.placeTransport(kind, 10, 1, 2).ok).toBe(true);
  const lift = sim.tower.transports[sim.tower.transports.length - 1];
  return { sim, lift };
}

// ---- Tests ------------------------------------------------------------------

describe("unit inspector card branches", () => {
  it("occupied office: catalog title, floor line, occupants, satisfaction", () => {
    const { sim, unit } = simWith("office");
    unit.satisfaction = 0.73;
    const frag = renderToFragment(unitInspectorTemplate(sim, unit));
    expect(frag.querySelector("h4.win-title")!.textContent).toBe("Office");
    expect(frag.textContent).toContain("Floor 2");
    expect(frag.textContent).toContain("Status: occupied");
    expect(frag.textContent).toMatch(/Occupants: \d+\/\d+/);
    expect(frag.textContent).toContain("Satisfaction: 73%");
  });

  it("hotel lifecycle states read in plain language (dirty / asleep / infested)", () => {
    const dirty = simWith("hotelSingle");
    dirty.unit.state = "dirty";
    expect(renderToFragment(unitInspectorTemplate(dirty.sim, dirty.unit)).textContent).toContain(
      "Status: dirty (awaiting housekeeping)",
    );
    const asleep = simWith("hotelSingle");
    asleep.unit.state = "asleep";
    expect(renderToFragment(unitInspectorTemplate(asleep.sim, asleep.unit)).textContent).toContain(
      "Status: occupied (guest asleep)",
    );
    const infested = simWith("hotelSingle");
    infested.unit.state = "infested";
    expect(renderToFragment(unitInspectorTemplate(infested.sim, infested.unit)).textContent).toContain(
      "Status: cockroach infested",
    );
  });

  it("rename subheading: shown for a real rename, suppressed when it matches the title", () => {
    const renamed = simWith("office");
    renamed.unit.label = "Acme Corp";
    const fragR = renderToFragment(unitInspectorTemplate(renamed.sim, renamed.unit));
    expect(fragR.textContent).toContain("Acme Corp");
    const plain = simWith("office");
    plain.unit.label = "Office"; // matches the catalog name
    expect(renderToFragment(unitInspectorTemplate(plain.sim, plain.unit)).querySelector("br")).toBeNull();
    // The comment's own scenario: a shop renamed to exactly its subtype shown
    // in the title must not render the name twice (the second condition of
    // labelIsExtra is the load-bearing one here).
    const shop = simWith("shop");
    shop.unit.subtype = "Chinese Cafe";
    shop.unit.label = "Chinese Cafe";
    const fragS = renderToFragment(unitInspectorTemplate(shop.sim, shop.unit));
    expect(fragS.querySelector("h4")!.textContent).toBe("Chinese Cafe");
    expect(fragS.querySelector("br")).toBeNull(); // subheading suppressed
  });

  it("on-notice statuses: tenant leaving vs household relocating", () => {
    const leaving = simWith("office");
    leaving.unit.state = "vacating";
    leaving.unit.vacateReason = "rent";
    const fragL = renderToFragment(unitInspectorTemplate(leaving.sim, leaving.unit));
    expect(fragL.textContent).toContain("on notice (tenant leaving)");
    const moving = simWith("condo");
    moving.unit.state = "vacating";
    moving.unit.vacateReason = "relocation";
    const fragM = renderToFragment(unitInspectorTemplate(moving.sim, moving.unit));
    expect(fragM.textContent).toContain("on notice (household relocating)");
  });

  it("commercial venue: subtype title, live customers, and the closed marker", () => {
    const { sim, unit } = simWith("shop");
    unit.subtype = "Chinese Cafe";
    unit.customersIn = 5;
    // The sim boots at 07:00; a shop (10:00 to 21:00) is closed then and open at noon.
    const frag = renderToFragment(unitInspectorTemplate(sim, unit));
    expect(frag.querySelector("h4")!.textContent).toBe("Chinese Cafe");
    expect(frag.textContent).toContain("Customers: 5 (closed)");
    sim.clock.minutes = 12 * 60;
    const openFrag = renderToFragment(unitInspectorTemplate(sim, unit));
    expect(openFrag.textContent).toContain("Customers: 5");
    expect(openFrag.textContent).not.toContain("(closed)");
  });

  it("commercial edge arms: an untracked customer count reads 0, and a vacant venue is never 'closed'", () => {
    // customersIn undefined → the ?? 0 fallback; still at the 07:00 boot
    // clock, so the closed marker also applies (tenanted).
    const fresh = simWith("shop");
    fresh.unit.customersIn = undefined;
    const frag = renderToFragment(unitInspectorTemplate(fresh.sim, fresh.unit));
    expect(frag.textContent).toContain("Customers: 0 (closed)");
    // A non-tenanted venue outside business hours: the Status row tells the
    // story, so the customers line carries no "(closed)".
    const vacant = simWith("shop");
    vacant.unit.state = "empty";
    vacant.unit.customersIn = 0;
    const vFrag = renderToFragment(unitInspectorTemplate(vacant.sim, vacant.unit));
    expect(vFrag.textContent).toContain("Customers: 0");
    expect(vFrag.textContent).not.toContain("(closed)");
  });

  it("basement facility reads a B floor tag and a zero-population kind has no census row", () => {
    const { sim, unit } = simWith("parking", 0);
    const frag = renderToFragment(unitInspectorTemplate(sim, unit));
    expect(frag.textContent).toContain("B1");
    expect(frag.textContent).not.toContain("Occupants");
  });

  it("renders a hostile label as literal text, injecting no element, and ships no ✕ of its own", () => {
    const { sim, unit } = simWith("office");
    unit.label = `<img src=x onerror="alert(1)">`;
    const frag = renderToFragment(unitInspectorTemplate(sim, unit));
    expect(frag.querySelector("img")).toBeNull();
    expect(frag.textContent).toContain(unit.label);
    // The mobile ✕ belongs to showInspector (the shared titleBarClose recipe),
    // never to the template, or the card would grow a second one per render.
    expect(frag.querySelector("h4 button")).toBeNull();
  });
});

describe("transport inspector card branches", () => {
  it("standard elevator (cars row) and stairs (no cars row)", () => {
    const el = withLift("elevatorStandard");
    const frag = renderToFragment(transportInspectorTemplate(el.sim, el.lift));
    expect(frag.textContent).toContain(`Cars: ${el.lift.cars}`);
    const st = withLift("stairs");
    expect(renderToFragment(transportInspectorTemplate(st.sim, st.lift)).textContent).not.toContain("Cars:");
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
