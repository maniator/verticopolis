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

describe("facilityDiagnostics: lobby-distance advice names only buildable slots", () => {
  /** A 20-tile-wide tower with lobby floor 1, plain floors 2..`top`, one
   *  standard elevator serving the whole span, and an occupied office on
   *  `floor`. No sky lobby is built, so slot 15 (and up) stays empty. */
  function tallSim(top: number, floor: number): { sim: Simulation; unit: Unit } {
    const sim = new Simulation();
    sim.money = 1e12;
    sim.star = 5;
    for (let x = 10; x < 30; x++) expect(sim.tower.place("lobby", 1, x).ok).toBe(true);
    for (let fl = 2; fl <= top; fl++) {
      for (let x = 10; x < 30; x++) expect(sim.tower.place("floor", fl, x).ok).toBe(true);
    }
    expect(sim.buildTransport("elevatorStandard", 10, 1, top).ok).toBe(true);
    const r = sim.tower.place("office", floor, 15);
    expect(r.ok).toBe(true);
    const unit = sim.tower.units.find((u) => u.id === r.unitId)!;
    unit.state = "occupied";
    return { sim, unit };
  }

  it("names the exact buildable slot for a capped (far-band) office", () => {
    const { sim, unit } = tallSim(10, 9); // distance 8: far band, slot 15 empty
    const frag = render(facilityDiagnostics(sim, unit));
    const line = [...frag.querySelectorAll("div")].find((d) => d.textContent?.startsWith("Far from"));
    expect(line?.textContent).toContain("Satisfaction is capped here");
    expect(line?.textContent).toContain("A sky lobby on floor 15 would lift it.");
    expect(line?.getAttribute("style")).toBe("color:var(--bad)");
  });

  it("names the exact buildable slot for an eroding (very-far) office", () => {
    const { sim, unit } = tallSim(14, 13); // distance 12: very far, slot 15 empty
    const frag = render(facilityDiagnostics(sim, unit));
    const line = [...frag.querySelectorAll("div")].find((d) => d.textContent?.startsWith("Too far"));
    expect(line?.textContent).toContain("Satisfaction sinks until tenants give notice.");
    expect(line?.textContent).toContain("Build the sky lobby on floor 15 to lift these tenants.");
    expect(line?.getAttribute("style")).toBe("color:var(--bad)");
  });

  it("goes neutral and uncolored at the top of the tower, where no nearer slot can exist", () => {
    // Every legal slot (15..90) carries a lobby; the office sits on floor 98,
    // 8 floors above the highest buildable slot, so there is no legal fix. The
    // line must inform without color, imperative, or a named floor.
    const sim = new Simulation();
    sim.money = 1e12;
    sim.star = 5;
    for (let x = 10; x < 30; x++) expect(sim.tower.place("lobby", 1, x).ok).toBe(true);
    for (let fl = 2; fl <= 98; fl++) {
      const kind = fl % 15 === 0 ? "lobby" : "floor";
      for (let x = 10; x < 30; x++) expect(sim.tower.place(kind, fl, x).ok).toBe(true);
    }
    // An express elevator reaches the top: it stops at every lobby floor and at
    // its own endpoints, so floor 98 is served.
    expect(sim.buildTransport("elevatorExpress", 10, 1, 98).ok).toBe(true);
    const r = sim.tower.place("office", 98, 15);
    expect(r.ok).toBe(true);
    const unit = sim.tower.units.find((u) => u.id === r.unitId)!;
    unit.state = "occupied";
    expect(sim.tower.nearestBuildableLobbySlot(98)).toBeNull(); // precondition: no legal fix
    const frag = render(facilityDiagnostics(sim, unit));
    const line = [...frag.querySelectorAll("div")].find((d) => d.textContent?.startsWith("Far from"));
    expect(line?.textContent).toContain("no closer sky lobby slot exists this high in the tower");
    expect(line?.textContent).not.toContain("would lift it");
    expect(line?.textContent).not.toMatch(/floor \d/); // never names an unbuildable floor
    expect(line?.getAttribute("style")).toBeNull(); // informational, not a fault
  });
});
