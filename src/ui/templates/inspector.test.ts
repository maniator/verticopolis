import { describe, it, expect } from "vitest";
import { Simulation } from "../../engine/Simulation";
import { FACILITIES, GRID, isCommercialKind, isElevatorKind, isOpenAt, residentCount } from "../../engine/facilities";
import { isTenanted } from "../../engine/types";
import type { Transport, Unit } from "../../engine/types";
import { escapeHtml } from "../escape";
import { floorTag } from "../format";
import { facilityDiagnostics, transportDiagnostics } from "../../game/facilityDiagnostics";
import { unitInspectorTemplate, transportInspectorTemplate, buildRefusalTemplate } from "./inspector";
import { renderToFragment, assertDomEquivalent } from "../testing/litTestUtils";

/**
 * The hover inspector card bodies (E6-S2). Unlike the editor's, the legacy
 * strings were built INLINE in `InspectorController.inspectPicked` and
 * `GameApp.updateBuildRefusal`, so there is no retained production oracle;
 * the transitional guards below compare against verbatim REPLICAS of that
 * deleted string code, kept only here. Package: the replicas' equivalence
 * across every branch (rename subheading shown/suppressed, basement floor
 * text, on-notice statuses, customers open/closed vs occupants, subtype
 * title, elevator cars row, refusal tooltip), the hostile-input hardening,
 * and the templates' contract that the ✕ is NOT theirs (showInspector
 * appends it from the shared titleBarClose recipe; wiring pinned by the
 * integration tests).
 */

// ---- Verbatim replicas of the legacy string builders (the oracle) ----------

function legacyUnitCard(sim: Simulation, u: Unit): string {
  const f = FACILITIES[u.kind];
  const diagnostics = facilityDiagnostics(sim, u);
  const isRelocation = u.state === "vacating" && u.vacateReason === "relocation";
  const statusText =
    u.state === "vacating"
      ? isRelocation
        ? "on notice (household relocating)"
        : "on notice (tenant leaving)"
      : u.state;
  const title = u.subtype ?? f.name;
  const labelIsExtra = u.label !== f.name && u.label !== title;
  return (
    `<h4 class="win-title">${escapeHtml(title)}</h4>` +
    `<div>${labelIsExtra ? escapeHtml(u.label) + "<br>" : ""}${u.floor >= 1 ? "Floor " + u.floor : "B" + (1 - u.floor)}</div>` +
    `<div>Status: ${statusText}</div>` +
    (isCommercialKind(u.kind) && f.population > 0
      ? `<div>Customers: ${u.customersIn ?? 0}${isTenanted(u) && !isOpenAt(u.kind, sim.clock.hour) ? " (closed)" : ""}</div>`
      : f.population
        ? `<div>Occupants: ${u.occupants}/${residentCount(u)}</div>`
        : "") +
    diagnostics +
    `<div>Satisfaction: ${Math.round(u.satisfaction * 100)}%</div>`
  );
}

function legacyTransportCard(sim: Simulation, t: Transport): string {
  const f = FACILITIES[t.kind];
  return (
    `<h4 class="win-title">${f.name}</h4><div>Serves floors ${floorTag(t.bottom)}–${floorTag(t.top)}</div>` +
    (isElevatorKind(t.kind) ? `<div>Cars: ${t.cars}</div>` : "") +
    transportDiagnostics(sim, t)
  );
}

const legacyRefusal = (reason: string): string =>
  `<h4 class="win-title">Can't build here</h4><div class="preview-refuse">${escapeHtml(reason)}</div>`;

// ---- Fixtures ---------------------------------------------------------------

/** A built tower carrying one unit of the requested kind on full-width floors,
 *  every placement asserted so the equivalence can't pass on a broken fixture. */
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

const equivalent = (legacy: string, lit: Parameters<typeof assertDomEquivalent>[1]): void =>
  expect(() => assertDomEquivalent(legacy, lit)).not.toThrow();

// ---- Tests ------------------------------------------------------------------

describe("unit inspector card matches the legacy inline builder", () => {
  it("occupied office: catalog title, floor line, occupants, satisfaction", () => {
    const { sim, unit } = simWith("office");
    unit.satisfaction = 0.73;
    equivalent(legacyUnitCard(sim, unit), unitInspectorTemplate(sim, unit));
  });

  it("rename subheading: shown for a real rename, suppressed when it matches the title", () => {
    const renamed = simWith("office");
    renamed.unit.label = "Acme Corp";
    const fragR = renderToFragment(unitInspectorTemplate(renamed.sim, renamed.unit));
    expect(fragR.textContent).toContain("Acme Corp");
    equivalent(legacyUnitCard(renamed.sim, renamed.unit), unitInspectorTemplate(renamed.sim, renamed.unit));
    const plain = simWith("office");
    plain.unit.label = FACILITIES.office.name; // matches the catalog name
    equivalent(legacyUnitCard(plain.sim, plain.unit), unitInspectorTemplate(plain.sim, plain.unit));
  });

  it("on-notice statuses: tenant leaving vs household relocating", () => {
    const leaving = simWith("office");
    leaving.unit.state = "vacating";
    leaving.unit.vacateReason = "rent";
    const fragL = renderToFragment(unitInspectorTemplate(leaving.sim, leaving.unit));
    expect(fragL.textContent).toContain("on notice (tenant leaving)");
    equivalent(legacyUnitCard(leaving.sim, leaving.unit), unitInspectorTemplate(leaving.sim, leaving.unit));
    const moving = simWith("condo");
    moving.unit.state = "vacating";
    moving.unit.vacateReason = "relocation";
    const fragM = renderToFragment(unitInspectorTemplate(moving.sim, moving.unit));
    expect(fragM.textContent).toContain("on notice (household relocating)");
    equivalent(legacyUnitCard(moving.sim, moving.unit), unitInspectorTemplate(moving.sim, moving.unit));
  });

  it("commercial venue: subtype title, live customers, and the closed marker", () => {
    const { sim, unit } = simWith("shop");
    unit.subtype = "Chinese Cafe";
    unit.customersIn = 5;
    // The sim boots at 07:00; a shop (10:00 to 21:00) is closed then and open at noon.
    const frag = renderToFragment(unitInspectorTemplate(sim, unit));
    expect(frag.querySelector("h4")!.textContent).toBe("Chinese Cafe");
    expect(frag.textContent).toContain("Customers: 5 (closed)");
    equivalent(legacyUnitCard(sim, unit), unitInspectorTemplate(sim, unit));
    sim.clock.minutes = 12 * 60;
    const openFrag = renderToFragment(unitInspectorTemplate(sim, unit));
    expect(openFrag.textContent).toContain("Customers: 5");
    expect(openFrag.textContent).not.toContain("(closed)");
    equivalent(legacyUnitCard(sim, unit), unitInspectorTemplate(sim, unit));
  });

  it("basement facility reads a B floor tag and a zero-population kind has no census row", () => {
    const { sim, unit } = simWith("parking", 0);
    const frag = renderToFragment(unitInspectorTemplate(sim, unit));
    expect(frag.textContent).toContain("B1");
    expect(frag.textContent).not.toContain("Occupants");
    equivalent(legacyUnitCard(sim, unit), unitInspectorTemplate(sim, unit));
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

describe("transport inspector card matches the legacy inline builder", () => {
  it("standard elevator (cars row) and stairs (no cars row)", () => {
    const el = withLift("elevatorStandard");
    const frag = renderToFragment(transportInspectorTemplate(el.sim, el.lift));
    expect(frag.textContent).toContain(`Cars: ${el.lift.cars}`);
    equivalent(legacyTransportCard(el.sim, el.lift), transportInspectorTemplate(el.sim, el.lift));
    const st = withLift("stairs");
    expect(renderToFragment(transportInspectorTemplate(st.sim, st.lift)).textContent).not.toContain("Cars:");
    equivalent(legacyTransportCard(st.sim, st.lift), transportInspectorTemplate(st.sim, st.lift));
  });
});

describe("build-refusal tooltip matches the legacy inline builder", () => {
  it("wraps the reason in the win-title grammar and escapes a hostile reason", () => {
    const frag = renderToFragment(buildRefusalTemplate("Needs a lobby below."));
    expect(frag.querySelector("h4.win-title")!.textContent).toBe("Can't build here");
    expect(frag.querySelector("div.preview-refuse")!.textContent).toBe("Needs a lobby below.");
    equivalent(legacyRefusal("Needs a lobby below."), buildRefusalTemplate("Needs a lobby below."));
    const hostile = `<img src=x onerror="alert(1)">`;
    const hostileFrag = renderToFragment(buildRefusalTemplate(hostile));
    expect(hostileFrag.querySelector("img")).toBeNull();
    expect(hostileFrag.querySelector(".preview-refuse")!.textContent).toBe(hostile);
    equivalent(legacyRefusal(hostile), buildRefusalTemplate(hostile));
  });
});
