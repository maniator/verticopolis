import { describe, it, expect } from "vitest";
import { Simulation } from "../../engine/Simulation";
import { GRID, maxCarsFor } from "../../engine/facilities";
import type { Transport, Unit } from "../../engine/types";
import { unitEditorTemplate, transportEditorTemplate } from "./editor";
import { renderToFragment } from "../testing/litTestUtils";

/**
 * The editor card bodies (E6-S1). Package: the title bar's ✕ a11y contract,
 * the `data-edit`/`data-field` markers main.ts and the action dispatch read,
 * the rename input's value binding, the disabled bounds on the car buttons,
 * hostile-label escaping, and every row/action branch: office (rename +
 * adjuster), sold and unsold condos, hotel room rate, a closed venue's
 * customer count, cinema operational/gutted, No Rate, the mobile diagnostics
 * fold-in, elevator car bounds, express vs standard stops, and fixed-span
 * stairs. The templates were proven structurally equivalent to the retired
 * `unitEditorHtml`/`transportEditorHtml` by transitional guards (removed with
 * the string builders in the final sweep; see git history). The diff/identity
 * mechanics live in `editorPatch.test.ts`; the UI wiring in the integration
 * spec.
 */

/** A built tower carrying one unit of the requested kind (full-width floors so
 *  any catalog width fits), plus a standard elevator. Placements are asserted:
 *  a silent fixture failure would make the assertions pass for the wrong
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
    expect(sim.tower.setCars(lift.id, maxCarsFor(lift.kind))).toBe(true); // addcar disabled at the pool max
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

describe("unit editor row and action branches", () => {
  it("office: desktop keeps the access row; the mobile fold-in swaps it for diagnostics", () => {
    const { sim, unit } = simWith("office");
    const desktop = renderToFragment(unitEditorTemplate(sim, unit));
    expect(desktop.querySelector('[data-field="served"]')).not.toBeNull();
    expect(desktop.querySelector(".ed-diagnostics")).toBeNull();
    const mobile = renderToFragment(unitEditorTemplate(sim, unit, true));
    expect(mobile.querySelector('[data-field="served"]')).toBeNull();
    expect(mobile.querySelector(".ed-diagnostics")).not.toBeNull();
  });

  it("security (zero-population service kind): mobile keeps the plain access row", () => {
    // Service kinds' diagnostics emit no access line, so the mobile fold-in
    // keeps the Yes/No row (the !hasAccessDiagnostic branch).
    const { sim, unit } = simWith("security");
    const frag = renderToFragment(unitEditorTemplate(sim, unit, true));
    expect(frag.querySelector('[data-field="served"]')).not.toBeNull();
  });

  it("office: gutted swaps resale for scrap rows; No Rate reads where the price shows", () => {
    const { sim, unit } = simWith("office");
    unit.state = "gutted";
    const gutted = renderToFragment(unitEditorTemplate(sim, unit));
    expect(gutted.textContent).toContain("Scrap value");
    expect(gutted.textContent).toContain("Gutted: bulldoze and rebuild.");
    expect(gutted.textContent).not.toContain("Resale value");
    unit.state = "occupied";
    unit.noRate = true;
    const offMarket = renderToFragment(unitEditorTemplate(sim, unit));
    expect(offMarket.querySelector('[data-field="rent"]')!.textContent).toBe("No Rate");
  });

  it("condo: unsold offers the price adjuster and batch action; sold drops them", () => {
    const unsold = simWith("condo");
    unsold.unit.state = "empty"; // built, never sold: the adjuster stays offered
    const uFrag = renderToFragment(unitEditorTemplate(unsold.sim, unsold.unit));
    expect(uFrag.textContent).toContain("Sale price");
    expect(uFrag.querySelector('[data-edit="rentUp"]')).not.toBeNull();
    expect(uFrag.querySelector('[data-edit="batchKind"]')).not.toBeNull();
    const sold = simWith("condo");
    sold.unit.everOccupied = true;
    sold.unit.residents = 4;
    const sFrag = renderToFragment(unitEditorTemplate(sold.sim, sold.unit));
    expect(sFrag.querySelector('[data-edit="rentUp"]')).toBeNull();
    expect(sFrag.querySelector('[data-edit="batchKind"]')).toBeNull();
  });

  it("hotel single: nightly room rate", () => {
    const { sim, unit } = simWith("hotelSingle");
    const frag = renderToFragment(unitEditorTemplate(sim, unit));
    expect(frag.textContent).toContain("Room rate");
    expect(frag.querySelector('[data-field="rent"]')!.textContent).toContain("/night");
  });

  it("fast food: open and closed customer readouts", () => {
    const { sim, unit } = simWith("fastFood");
    unit.customersIn = 7;
    const open = renderToFragment(unitEditorTemplate(sim, unit)); // 07:00, open
    expect(open.querySelector('[data-field="customers"]')!.textContent).toBe("7");
    sim.clock.minutes = 23 * 60; // 23:00, closed
    const closed = renderToFragment(unitEditorTemplate(sim, unit));
    expect(closed.querySelector('[data-field="customers"]')!.textContent).toBe("7 (closed)");
  });

  it("cinema: operational shows the film row and booking action; gutted drops the row", () => {
    const { sim, unit } = simWith("cinema", 3);
    unit.filmPolicy = "blockbuster";
    const op = renderToFragment(unitEditorTemplate(sim, unit));
    expect(op.textContent).toContain("Now showing");
    expect(op.querySelector('[data-edit="filmPolicy"]')!.textContent).toContain("Blockbuster");
    unit.state = "gutted";
    expect(renderToFragment(unitEditorTemplate(sim, unit)).textContent).not.toContain("Now showing");
  });
});

describe("transport editor row and action branches", () => {
  it("standard elevator: a skipped floor reads plainly (never borrowing the express copy)", () => {
    const { sim, lift } = withLift("elevatorStandard", 4);
    expect(renderToFragment(transportEditorTemplate(sim, lift)).querySelector('[data-field="stops"]')!.textContent).toBe(
      "all floors",
    );
    expect(sim.tower.setStop(lift.id, 3, false)).toBe(true);
    const stops = renderToFragment(transportEditorTemplate(sim, lift)).querySelector('[data-field="stops"]')!
      .textContent!;
    expect(stops).toBe("skips 1 floor");
    expect(stops).not.toContain("express");
  });

  it("serves and height cells read the span in plain copy", () => {
    const { sim, lift } = withLift("elevatorStandard");
    const frag = renderToFragment(transportEditorTemplate(sim, lift));
    expect(frag.querySelector('[data-field="serves"]')!.textContent).toBe("1 – 2");
    expect(frag.querySelector('[data-field="height"]')!.textContent).toBe("2 floors");
  });

  it("mobile folds the transport diagnostics block in", () => {
    const { sim, lift } = withLift("elevatorStandard", 4);
    // A passenger elevator reports its average load once the sim has measured
    // utilization; seed it so transportDiagnostics emits its "Avg load" line
    // (an idle, never-ticked shaft has no measurement and no line, which the
    // mobile editor renders as no fold-in block at all).
    sim.elevatorUtil.set(lift.id, 0.5);
    const mobile = renderToFragment(transportEditorTemplate(sim, lift, true));
    expect(mobile.querySelector(".ed-diagnostics")).not.toBeNull();
    expect(mobile.textContent).toContain("Avg load: 50% full");
    // Desktop leaves the diagnostics to the hover card, so it carries no block.
    expect(renderToFragment(transportEditorTemplate(sim, lift)).querySelector(".ed-diagnostics")).toBeNull();
  });

  it("mobile omits the diagnostics block for an idle elevator with no measured load", () => {
    // No utilization recorded yet: transportDiagnostics is empty, so the mobile
    // editor renders no empty .ed-diagnostics box (parity with the old empty
    // div's `:empty { display:none }`, now expressed as no box at all).
    const { sim, lift } = withLift("elevatorStandard", 4);
    expect(renderToFragment(transportEditorTemplate(sim, lift, true)).querySelector(".ed-diagnostics")).toBeNull();
  });

  it("express elevator surfaces a preserved skipped lobby honestly", () => {
    const express = withLift("elevatorExpress", 3);
    expect(
      renderToFragment(transportEditorTemplate(express.sim, express.lift)).querySelector('[data-field="stops"]')!
        .textContent,
    ).toBe("lobbies and sky lobbies");
    // A legacy/forged save can carry a deliberately skipped lobby; the Stops
    // readout surfaces the count instead of overstating the policy.
    express.lift.skipFloors = [1];
    const frag = renderToFragment(transportEditorTemplate(express.sim, express.lift));
    expect(frag.querySelector('[data-field="stops"]')!.textContent).toBe("lobbies and sky lobbies (1 skipped)");
  });

  it("service elevator keeps the elevator rows; an escalator is a fixed-span flight", () => {
    const service = withLift("elevatorService");
    const sFrag = renderToFragment(transportEditorTemplate(service.sim, service.lift));
    expect(sFrag.querySelector('[data-field="cars"]')).not.toBeNull();
    expect(sFrag.querySelector('[data-edit="stops"]')).not.toBeNull(); // staff-only still configures stops
    const esc = withLift("escalator", 2, "shop");
    const eFrag = renderToFragment(transportEditorTemplate(esc.sim, esc.lift));
    expect(eFrag.querySelector('[data-field="cars"]')).toBeNull();
    expect(eFrag.querySelector('[data-edit="extendUp"]')).toBeNull();
    expect(eFrag.querySelector('[data-edit="sell"]')).not.toBeNull();
  });
});
