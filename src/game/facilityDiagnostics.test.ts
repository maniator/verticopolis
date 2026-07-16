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

  it("names the slot AND the build-up step when the slot sits above the built top", () => {
    // A young 10-story tower: slot 15 is the fix, but floors 11-14 do not exist
    // yet, so bare "build on floor 15" would be refused (no floating overhangs).
    // The advice names the whole project.
    const { sim, unit } = tallSim(10, 9); // distance 8: far band, slot 15 above the top
    const frag = render(facilityDiagnostics(sim, unit));
    const line = [...frag.querySelectorAll("div")].find((d) => d.textContent?.startsWith("Far from"));
    expect(line?.textContent).toContain("Satisfaction is capped here");
    expect(line?.textContent).toContain("A sky lobby on floor 15 would lift it (build floors up to it first).");
    expect(line?.getAttribute("style")).toBe("color:var(--bad)");
  });

  it("names the plain imperative when the slot rests directly on the built top", () => {
    // A 14-story tower: slot 15 sits one story above the top, so a lobby there
    // rests on floor 14 and is directly placeable. No extra step to name.
    const { sim, unit } = tallSim(14, 13); // distance 12: very far, slot 15 directly placeable
    const frag = render(facilityDiagnostics(sim, unit));
    const line = [...frag.querySelectorAll("div")].find((d) => d.textContent?.startsWith("Too far"));
    expect(line?.textContent).toContain("Satisfaction sinks until tenants give notice.");
    expect(line?.textContent).toContain("Build the sky lobby on floor 15 to lift these tenants.");
    expect(line?.getAttribute("style")).toBe("color:var(--bad)");
  });

  it("names the teardown when stories rest on the blocked slot", () => {
    // Slot 30 carries floor tiles AND supports built stories above (31-33), so
    // bulldozing it is refused until those come down; the advice must say so
    // rather than send the player into a clear-then-refuse loop.
    const sim = new Simulation();
    sim.money = 1e12;
    sim.star = 5;
    for (let x = 10; x < 30; x++) expect(sim.tower.place("lobby", 1, x).ok).toBe(true);
    for (let fl = 2; fl <= 33; fl++) {
      const kind = fl === 15 ? "lobby" : "floor";
      for (let x = 10; x < 30; x++) expect(sim.tower.place(kind, fl, x).ok).toBe(true);
    }
    expect(sim.buildTransport("elevatorStandard", 10, 1, 30).ok).toBe(true);
    const r = sim.tower.place("office", 23, 15);
    expect(r.ok).toBe(true);
    const unit = sim.tower.units.find((u) => u.id === r.unitId)!;
    unit.state = "occupied";
    const frag = render(facilityDiagnostics(sim, unit));
    const line = [...frag.querySelectorAll("div")].find((d) => d.textContent?.startsWith("Far from"));
    expect(line?.textContent).toContain(
      "A sky lobby on floor 30 would lift it (the stories above it must come down before it can be cleared).",
    );
  });

  it("tells a tenant sitting on the empty slot floor to move, not to demolish itself", () => {
    // Rooms are legal on an unclaimed sky-lobby story, so an office can sit ON
    // the skipped slot. "Clear floor 30" would demolish the advised office, so
    // the copy must acknowledge the unit itself has to move.
    const sim = new Simulation();
    sim.money = 1e12;
    sim.star = 5;
    for (let x = 10; x < 30; x++) expect(sim.tower.place("lobby", 1, x).ok).toBe(true);
    for (let fl = 2; fl <= 30; fl++) {
      const kind = fl === 15 ? "lobby" : "floor";
      for (let x = 10; x < 30; x++) expect(sim.tower.place(kind, fl, x).ok).toBe(true);
    }
    expect(sim.buildTransport("elevatorStandard", 10, 1, 30).ok).toBe(true);
    const r = sim.tower.place("office", 30, 15);
    expect(r.ok).toBe(true);
    const unit = sim.tower.units.find((u) => u.id === r.unitId)!;
    unit.state = "occupied";
    expect(sim.tower.nearestBuildableLobbySlot(30)).toBe(30); // precondition: it sits on the slot
    const frag = render(facilityDiagnostics(sim, unit));
    const line = [...frag.querySelectorAll("div")].find((d) => d.textContent?.startsWith("Too far"));
    expect(line?.textContent).toContain("This unit sits on the empty sky lobby slot; move it and build the lobby on floor 30 to anchor the block.");
    expect(line?.textContent).not.toContain("Clear floor 30");
  });

  it("names the clearing step when the buildable slot already carries non-lobby content", () => {
    // Lobbies at 1 and 15; slot 30 was skipped and extended through with plain
    // floor tiles instead. The office on floor 23 (distance 8 from the floor-15
    // lobby) is capped; the fix is slot 30, but a lobby there is refused until
    // the story is cleared, so the advice must name that step.
    const sim = new Simulation();
    sim.money = 1e12;
    sim.star = 5;
    for (let x = 10; x < 30; x++) expect(sim.tower.place("lobby", 1, x).ok).toBe(true);
    for (let fl = 2; fl <= 30; fl++) {
      const kind = fl === 15 ? "lobby" : "floor";
      for (let x = 10; x < 30; x++) expect(sim.tower.place(kind, fl, x).ok).toBe(true);
    }
    expect(sim.buildTransport("elevatorStandard", 10, 1, 30).ok).toBe(true);
    const r = sim.tower.place("office", 23, 15);
    expect(r.ok).toBe(true);
    const unit = sim.tower.units.find((u) => u.id === r.unitId)!;
    unit.state = "occupied";
    expect(sim.tower.nearestBuildableLobbySlot(23)).toBe(30); // precondition: the blocked slot is the fix
    expect(sim.tower.floorHasNonLobbyContent(30)).toBe(true);
    const frag = render(facilityDiagnostics(sim, unit));
    const line = [...frag.querySelectorAll("div")].find((d) => d.textContent?.startsWith("Far from"));
    expect(line?.textContent).toContain("A sky lobby on floor 30 would lift it (clear that floor first).");
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
