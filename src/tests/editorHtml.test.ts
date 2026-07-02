import { describe, expect, it, beforeEach } from "vitest";
import { Simulation } from "../engine/Simulation";
import { unitEditorHtml, unitEditorVolatile, transportEditorHtml, transportEditorVolatile } from "../ui/editorHtml";
import { buildStatsHtml, buildMilestonesHtml } from "../ui/statsHtml";
import type { Transport, Unit } from "../engine/types";

/** The editor/stats HTML builders are pure functions of (sim, entity) since
 *  the module split — these tests pin the structure the DOM patcher and the
 *  design system rely on, without booting the game shell. */
describe("editor & stats HTML builders", () => {
  let sim: Simulation;
  let office: Unit;
  let lift: Transport;

  beforeEach(() => {
    sim = new Simulation();
    for (let x = 10; x < 30; x++) sim.tower.place("lobby", 1, x);
    for (let x = 10; x < 30; x++) sim.tower.place("floor", 2, x);
    const r = sim.tower.place("office", 2, 12);
    office = sim.tower.units.find((u) => u.id === r.unitId)!;
    office.state = "occupied";
    sim.buildTransport("elevatorStandard", 10, 1, 2);
    lift = sim.tower.transports[sim.tower.transports.length - 1];
  });

  it("unit editor renders the window grammar and volatile fields", () => {
    const html = unitEditorHtml(sim, office);
    // Title bar with the shared ✕ recipe (design-system contract).
    expect(html).toContain('class="win-title"');
    expect(html).toContain('class="ed-close btn xs"');
    // Every volatile value is patchable via its data-field span.
    for (const field of Object.keys(unitEditorVolatile(sim, office))) {
      expect(html).toContain(`data-field="${field}"`);
    }
    // Destructive action uses the danger variant, never a bespoke class.
    expect(html).toContain('class="btn danger" data-edit="sell"');
  });

  it("transport editor gates elevator-only rows and actions", () => {
    const html = transportEditorHtml(sim, lift);
    expect(html).toContain('data-field="cars"');
    expect(html).toContain('data-edit="extendUp"');
    // Fixed-span flights get neither cars nor extend arrows.
    sim.buildTransport("stairs", 14, 1, 2);
    const stairs = sim.tower.transports[sim.tower.transports.length - 1];
    const stairsHtml = transportEditorHtml(sim, stairs);
    expect(stairsHtml).not.toContain('data-field="cars"');
    expect(stairsHtml).not.toContain("data-edit=\"extend");
    expect(stairsHtml).toContain('data-edit="sell"');
  });

  it("volatile maps match the fields the full render emits", () => {
    const vol = transportEditorVolatile(sim, lift);
    expect(vol.serves).toBe("1 – 2");
    expect(vol.height).toBe("2 floors");
    expect(Object.keys(vol)).toEqual(expect.arrayContaining(["cars", "capacity", "stops"]));
  });

  it("stats dialog renders every section as a mini title bar", () => {
    const html = buildStatsHtml(sim);
    for (const section of ["Overview", "Tenancy", "Transport &amp; access", "Milestones"]) {
      expect(html).toContain(section);
    }
    // Section strips use the documented .win-title.sm variant.
    expect(html.match(/stats-section win-title sm/g)!.length).toBeGreaterThanOrEqual(4);
    // Funds row reflects solvency styling.
    expect(html).toContain('class="v money"');
  });

  it("milestones checklist splits into two kv columns with a gauge", () => {
    const html = buildMilestonesHtml(sim);
    expect(html.match(/col ms kv/g)!.length).toBe(2);
    expect(html).toContain('class="evalbar"');
  });
});
