import { describe, it, expect } from "vitest";
import { html, type TemplateResult } from "lit-html";
import { Simulation } from "../engine/Simulation";
import type { Unit } from "../engine/types";
import { facilityDiagnostics } from "./facilityDiagnostics";
import { renderToFragment } from "../ui/testing/litTestUtils";

/**
 * The shared diagnostic lines, now lit `TemplateResult` arrays (no `unsafeHTML`
 * bridge, no `escapeHtml`). These assert the rendered DOM: which lines appear,
 * their order, and the color styles that carry the red/green verdicts. The
 * editor/inspector fold-in behavior is covered separately in
 * `ui/templates/editor.test.ts` and the gameControllers integration suite.
 */

const render = (lines: TemplateResult[]): DocumentFragment => renderToFragment(html`${lines}`);

/** A tower with floors 1..`floors` (columns 10-29) and a standard elevator
 *  running floor 1-2, then one occupied unit of `kind` placed on `floor`. */
function simWith(
  kind: Parameters<Simulation["tower"]["place"]>[0],
  { floors = 2, floor = 2 }: { floors?: number; floor?: number } = {},
): { sim: Simulation; unit: Unit } {
  const sim = new Simulation();
  for (let x = 10; x < 30; x++) expect(sim.tower.place("lobby", 1, x).ok).toBe(true);
  for (let fl = 2; fl <= floors; fl++) {
    for (let x = 10; x < 30; x++) expect(sim.tower.place("floor", fl, x).ok).toBe(true);
  }
  expect(sim.buildTransport("elevatorStandard", 10, 1, 2).ok).toBe(true);
  const r = sim.tower.place(kind, floor, 12);
  expect(r.ok).toBe(true);
  const unit = sim.tower.units.find((u) => u.id === r.unitId)!;
  unit.state = "occupied";
  return { sim, unit };
}

describe("facilityDiagnostics", () => {
  it("returns no lines for a plain zero-population service kind with nothing to warn about", () => {
    const { sim, unit } = simWith("security");
    expect(facilityDiagnostics(sim, unit)).toEqual([]);
  });

  it("emits a green reachable access line for a served office", () => {
    const { sim, unit } = simWith("office");
    expect(sim.tower.isFloorServed(unit.floor)).toBe(true);
    const frag = render(facilityDiagnostics(sim, unit));
    const access = frag.querySelector("div");
    expect(access?.textContent).toContain("Access: reachable");
    expect(access?.getAttribute("style")).toBe("color:var(--good)");
  });

  it("emits a red not-connected access line for an office on an unserved floor", () => {
    // Floor 3 exists but the fixture elevator only runs 1-2, so floor 3 is unserved.
    const { sim, unit } = simWith("office", { floors: 3, floor: 3 });
    expect(sim.tower.isFloorServed(unit.floor)).toBe(false);
    const frag = render(facilityDiagnostics(sim, unit));
    const access = frag.querySelector("div");
    expect(access?.textContent).toContain("Access: not connected");
    expect(access?.getAttribute("style")).toBe("color:var(--bad)");
  });

  it("names the on-notice reason as text and shows the recovery target", () => {
    const { sim, unit } = simWith("office");
    unit.state = "vacating";
    unit.vacateReason = "rent";
    unit.vacateAt = sim.clock.minutes + 3 * 60;
    unit.satisfaction = 0.2;
    const frag = render(facilityDiagnostics(sim, unit));
    expect(frag.textContent).toContain("Giving notice: rent set too high. Leaves in under 3 hour(s).");
    expect(frag.textContent).toContain("Fix the cause and get satisfaction to");
    const notice = [...frag.querySelectorAll("div")].find((d) => d.textContent?.startsWith("Giving notice"));
    expect(notice?.getAttribute("style")).toBe("color:var(--bad)");
  });

  it("frames a relocation as a life event with no recovery bar", () => {
    const { sim, unit } = simWith("office");
    unit.state = "vacating";
    unit.vacateReason = "relocation";
    unit.vacateAt = sim.clock.minutes + 3 * 60;
    const frag = render(facilityDiagnostics(sim, unit));
    expect(frag.textContent).toContain("the household is relocating. Leaves in under 3 hour(s).");
    expect(frag.textContent).toContain("A life event, so you cannot keep them.");
    expect(frag.textContent).not.toContain("Fix the cause");
  });
});
