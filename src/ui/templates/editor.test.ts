import { describe, it, expect } from "vitest";
import { Simulation } from "../../engine/Simulation";
import { GRID } from "../../engine/facilities";
import type { Transport, Unit } from "../../engine/types";
import { unitEditorHtml, transportEditorHtml } from "../editorHtml";
import { unitEditorTemplate, transportEditorTemplate } from "./editor";
import { renderToFragment, assertDomEquivalent } from "../testing/litTestUtils";

/**
 * The editor card bodies (E6-S1). Package: the title bar's ✕ a11y contract,
 * the `data-edit`/`data-field` markers main.ts and the action dispatch read,
 * the rename input's value binding, the disabled bounds on the car buttons,
 * hostile-label escaping, and the transitional `assertDomEquivalent` guards
 * against `unitEditorHtml`/`transportEditorHtml` across every row/action
 * branch: office (rename + adjuster), sold and unsold condos, hotel room rate,
 * a closed venue's customer count, cinema operational/gutted, No Rate, the
 * mobile diagnostics fold-in, elevator car bounds, express vs standard stops,
 * and fixed-span stairs. The diff/identity mechanics live in
 * `editorPatch.test.ts`; the UI wiring in the integration spec.
 */

/** A built tower carrying one unit of the requested kind (full-width floors so
 *  any catalog width fits), plus a standard elevator. Placements are asserted:
 *  a silent fixture failure would make the equivalence pass for the wrong
 *  reason. */
function simWith(kind: Parameters<Simulation["tower"]["place"]>[0], floors = 2): { sim: Simulation; unit: Unit } {
  const sim = new Simulation();
  for (let x = 0; x < GRID.width; x++) expect(sim.tower.place("lobby", 1, x).ok).toBe(true);
  for (let fl = 2; fl <= floors; fl++) {
    for (let x = 0; x < GRID.width; x++) expect(sim.tower.place("floor", fl, x).ok).toBe(true);
  }
  const r = sim.tower.place(kind, 2, 40);
  expect(r.ok).toBe(true);
  const unit = sim.tower.units.find((u) => u.id === r.unitId)!;
  unit.state = "occupied";
  return { sim, unit };
}

function withLift(
  kind: "elevatorStandard" | "elevatorService" | "elevatorExpress" | "stairs" | "escalator",
  top = 2,
  // Escalators refuse office floors by canon, so their fixture rides a shop.
  base: "office" | "shop" = "office",
): { sim: Simulation; lift: Transport } {
  const { sim } = simWith(base, Math.max(top, 2));
  // Tower-level placement, like the unit fixture's tower.place: the star and
  // money gates live in sim.buildTransport and are not what this suite pins.
  expect(sim.tower.placeTransport(kind, 10, 1, top).ok).toBe(true);
  const lift = sim.tower.transports[sim.tower.transports.length - 1];
  return { sim, lift };
}

const equivalent = (legacy: string, lit: Parameters<typeof assertDomEquivalent>[1]): void =>
  expect(() => assertDomEquivalent(legacy, lit)).not.toThrow();

describe("unit editor template structure", () => {
  it("title bar ✕ keeps the shared recipe and its aria-label; cells carry data-field markers", () => {
    const { sim, unit } = simWith("office");
    const frag = renderToFragment(unitEditorTemplate(sim, unit));
    const x = frag.querySelector<HTMLButtonElement>("h4.win-title > button.ed-close")!;
    expect(x).not.toBeNull();
    expect(x.getAttribute("aria-label")).toBe("Close");
    expect([...x.classList].sort()).toEqual(["btn", "ed-close", "xs"]);
    for (const field of ["status", "occupants", "served", "eval", "rent"]) {
      expect(frag.querySelector(`[data-field="${field}"]`), field).not.toBeNull();
    }
    expect(frag.querySelector('button.danger[data-edit="sell"]')).not.toBeNull();
  });

  it("binds the unit label as the rename input's value", () => {
    const { sim, unit } = simWith("office");
    unit.label = "Acme Corp";
    const frag = renderToFragment(unitEditorTemplate(sim, unit));
    expect(frag.querySelector<HTMLInputElement>("#ed-name")!.value).toBe("Acme Corp");
  });

  it("renders a hostile unit label and retail subtype as literal text, injecting no element", () => {
    const hostile = `<img src=x onerror="alert(1)">`;
    const { sim, unit } = simWith("shop");
    unit.subtype = hostile; // titles the card
    const frag = renderToFragment(unitEditorTemplate(sim, unit));
    expect(frag.querySelector("img")).toBeNull();
    expect(frag.querySelector("h4.win-title")!.textContent).toContain(hostile);
  });
});

describe("transport editor template structure", () => {
  it("car buttons disable at the pool bounds", () => {
    const { sim, lift } = withLift("elevatorStandard");
    if (lift.cars !== 1) expect(sim.tower.setCars(lift.id, 1)).toBe(true);
    let frag = renderToFragment(transportEditorTemplate(sim, lift));
    expect(frag.querySelector<HTMLButtonElement>('[data-edit="removecar"]')!.disabled).toBe(true);
    expect(frag.querySelector<HTMLButtonElement>('[data-edit="addcar"]')!.disabled).toBe(false);
    expect(sim.tower.setCars(lift.id, 8)).toBe(true); // MAX_CARS for every elevator kind
    frag = renderToFragment(transportEditorTemplate(sim, lift));
    expect(frag.querySelector<HTMLButtonElement>('[data-edit="removecar"]')!.disabled).toBe(false);
    expect(frag.querySelector<HTMLButtonElement>('[data-edit="addcar"]')!.disabled).toBe(true);
  });

  it("an express offers no stop-config actions; stairs get neither cars nor extend arrows", () => {
    const express = withLift("elevatorExpress");
    const eFrag = renderToFragment(transportEditorTemplate(express.sim, express.lift));
    expect(eFrag.querySelector('[data-edit="stops"]')).toBeNull();
    expect(eFrag.querySelector('[data-edit="express"]')).toBeNull();
    expect(eFrag.querySelector('[data-edit="extendUp"]')).not.toBeNull();
    const stairs = withLift("stairs");
    const sFrag = renderToFragment(transportEditorTemplate(stairs.sim, stairs.lift));
    expect(sFrag.querySelector('[data-field="cars"]')).toBeNull();
    expect(sFrag.querySelector('[data-edit="extendUp"]')).toBeNull();
    expect(sFrag.querySelector('[data-edit="sell"]')).not.toBeNull();
  });
});

describe("unit editor matches the legacy builder", () => {
  it("office: desktop and the mobile diagnostics fold-in", () => {
    const { sim, unit } = simWith("office");
    equivalent(unitEditorHtml(sim, unit), unitEditorTemplate(sim, unit));
    equivalent(unitEditorHtml(sim, unit, true), unitEditorTemplate(sim, unit, true));
  });

  it("security (zero-population service kind): mobile keeps the plain access row", () => {
    // Service kinds' diagnostics emit no access line, so the mobile fold-in
    // keeps the Yes/No row (the !hasAccessDiagnostic branch); pin the branch
    // on the lit path, then its equivalence.
    const { sim, unit } = simWith("security");
    const frag = renderToFragment(unitEditorTemplate(sim, unit, true));
    expect(frag.querySelector('[data-field="served"]')).not.toBeNull();
    equivalent(unitEditorHtml(sim, unit, true), unitEditorTemplate(sim, unit, true));
  });

  it("office: gutted rows and the No Rate readout", () => {
    const { sim, unit } = simWith("office");
    unit.state = "gutted";
    equivalent(unitEditorHtml(sim, unit), unitEditorTemplate(sim, unit));
    unit.state = "occupied";
    unit.noRate = true;
    equivalent(unitEditorHtml(sim, unit), unitEditorTemplate(sim, unit));
  });

  it("condo: unsold (price adjuster) and sold (household-scaled price, no adjuster)", () => {
    const unsold = simWith("condo");
    unsold.unit.state = "empty"; // built, never sold: the adjuster stays offered
    equivalent(unitEditorHtml(unsold.sim, unsold.unit), unitEditorTemplate(unsold.sim, unsold.unit));
    const sold = simWith("condo");
    sold.unit.everOccupied = true;
    sold.unit.residents = 4;
    equivalent(unitEditorHtml(sold.sim, sold.unit), unitEditorTemplate(sold.sim, sold.unit));
  });

  it("hotel single: nightly room rate", () => {
    const { sim, unit } = simWith("hotelSingle");
    equivalent(unitEditorHtml(sim, unit), unitEditorTemplate(sim, unit));
  });

  it("fast food: open and closed customer readouts, desktop and mobile", () => {
    const { sim, unit } = simWith("fastFood");
    unit.customersIn = 7;
    equivalent(unitEditorHtml(sim, unit), unitEditorTemplate(sim, unit)); // 07:00, open
    sim.clock.minutes = 23 * 60; // 23:00, closed
    // Pin that the fixture actually reached the closed branch: an equivalence
    // check alone would pass if both builders silently stayed on the open one.
    const frag = renderToFragment(unitEditorTemplate(sim, unit));
    expect(frag.querySelector('[data-field="customers"]')!.textContent).toBe("7 (closed)");
    equivalent(unitEditorHtml(sim, unit), unitEditorTemplate(sim, unit));
    equivalent(unitEditorHtml(sim, unit, true), unitEditorTemplate(sim, unit, true));
  });

  it("cinema: operational (film policy action) and gutted (no showing row)", () => {
    const { sim, unit } = simWith("cinema", 3);
    unit.filmPolicy = "blockbuster";
    equivalent(unitEditorHtml(sim, unit), unitEditorTemplate(sim, unit));
    unit.state = "gutted";
    equivalent(unitEditorHtml(sim, unit), unitEditorTemplate(sim, unit));
  });
});

describe("transport editor matches the legacy builder", () => {
  it("standard elevator: both car bounds, a skipped floor, desktop and mobile", () => {
    const { sim, lift } = withLift("elevatorStandard", 4);
    equivalent(transportEditorHtml(sim, lift), transportEditorTemplate(sim, lift));
    if (lift.cars !== 1) expect(sim.tower.setCars(lift.id, 1)).toBe(true); // removecar disabled
    expect(sim.tower.setStop(lift.id, 3, false)).toBe(true); // "skips 1 floor"
    equivalent(transportEditorHtml(sim, lift), transportEditorTemplate(sim, lift));
    expect(sim.tower.setCars(lift.id, 8)).toBe(true); // MAX_CARS: addcar disabled
    equivalent(transportEditorHtml(sim, lift), transportEditorTemplate(sim, lift));
    equivalent(transportEditorHtml(sim, lift, true), transportEditorTemplate(sim, lift, true));
  });

  it("express elevator (with and without a preserved skipped lobby) and stairs", () => {
    const express = withLift("elevatorExpress", 3);
    equivalent(transportEditorHtml(express.sim, express.lift), transportEditorTemplate(express.sim, express.lift));
    // A legacy/forged save can carry a deliberately skipped lobby; the Stops
    // readout surfaces the count honestly. Pin the branch, then its equivalence.
    express.lift.skipFloors = [1];
    const frag = renderToFragment(transportEditorTemplate(express.sim, express.lift));
    expect(frag.querySelector('[data-field="stops"]')!.textContent).toBe("lobbies and sky lobbies (1 skipped)");
    equivalent(transportEditorHtml(express.sim, express.lift), transportEditorTemplate(express.sim, express.lift));
    const stairs = withLift("stairs");
    equivalent(transportEditorHtml(stairs.sim, stairs.lift), transportEditorTemplate(stairs.sim, stairs.lift));
  });

  it("service elevator and escalator", () => {
    const service = withLift("elevatorService");
    equivalent(transportEditorHtml(service.sim, service.lift), transportEditorTemplate(service.sim, service.lift));
    const esc = withLift("escalator", 2, "shop");
    equivalent(transportEditorHtml(esc.sim, esc.lift), transportEditorTemplate(esc.sim, esc.lift));
  });
});
