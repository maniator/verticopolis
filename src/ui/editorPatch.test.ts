// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
import { render } from "lit-html";
import { Simulation } from "../engine/Simulation";
import type { Transport, Unit } from "../engine/types";
import { unitEditorTemplate, transportEditorTemplate } from "./templates/editor";
import { syncRungSelects } from "./templates/rungPicker";

/**
 * The editor card's update-in-place invariant, rewritten for lit (E6-S1).
 * The old `key`/`patchVolatile` protocol guaranteed a pump refresh could never
 * recreate a button mid-click; lit's binding diff now carries that guarantee,
 * so these tests pin it against the REAL templates: re-rendering with changed
 * values patches only the affected text/attributes, while every button and the
 * rename input keep their element identity. The UI-level wiring (delegation,
 * editorBusy, hide/close) is pinned by the renderEditor integration block.
 */

/** A small built MODERN tower with an occupied office (rename + the '+ rent'
 *  stepper these identity tests pin; Classic renders the rung picker, which
 *  has its own identity test below) and a standard elevator. Placements are
 *  asserted so a silent fixture failure can't make the identity assertions
 *  pass vacuously. */
function fixture(): { sim: Simulation; office: Unit; lift: Transport } {
  const sim = new Simulation(12345, "modern");
  for (let x = 10; x < 30; x++) expect(sim.tower.place("lobby", 1, x).ok).toBe(true);
  for (let x = 10; x < 30; x++) expect(sim.tower.place("floor", 2, x).ok).toBe(true);
  const r = sim.tower.place("office", 2, 12);
  expect(r.ok).toBe(true);
  const office = sim.tower.units.find((u) => u.id === r.unitId)!;
  office.state = "occupied";
  expect(sim.buildTransport("elevatorStandard", 10, 1, 2).ok).toBe(true);
  const lift = sim.tower.transports[sim.tower.transports.length - 1];
  return { sim, office, lift };
}

describe("editor card lit diffing — updates in place, element identity survives", () => {
  it("patches a changed stat cell without recreating the buttons or the rename input", () => {
    const { sim, office } = fixture();
    office.satisfaction = 0.5;
    const card = document.createElement("div");
    render(unitEditorTemplate(sim, office), card);
    const btn = card.querySelector<HTMLElement>('[data-edit="rentUp"]')!;
    const name = card.querySelector<HTMLInputElement>("#ed-name")!;
    const evalCell = card.querySelector('[data-field="eval"]')!;
    expect(evalCell.textContent).toContain("50%");

    office.satisfaction = 0.78;
    render(unitEditorTemplate(sim, office), card);

    expect(evalCell.textContent).toContain("78%");
    // Same element identities → a click that began before the refresh still lands.
    expect(card.querySelector('[data-edit="rentUp"]')).toBe(btn);
    expect(card.querySelector("#ed-name")).toBe(name);
    expect(card.querySelector('[data-field="eval"]')).toBe(evalCell);
  });

  it("selecting a DIFFERENT entity mints a fresh rename input (no half-typed text carryover)", () => {
    // The legacy protocol keyed the rebuild on the entity id; the templates
    // carry that identity via lit's `keyed`. Without it, the reused input's
    // dirty (mid-edit) value would survive the attribute update and unit A's
    // half-typed text would show, and commit, on unit B.
    const { sim, office } = fixture();
    const r2 = sim.tower.place("office", 2, 21); // 9 wide → spans 21..29 on the 10..29 floor
    expect(r2.ok).toBe(true);
    const officeB = sim.tower.units.find((u) => u.id === r2.unitId)!;
    officeB.state = "occupied";
    const card = document.createElement("div");
    render(unitEditorTemplate(sim, office), card);
    const inputA = card.querySelector<HTMLInputElement>("#ed-name")!;
    inputA.value = "half-typed"; // player is mid-rename when the selection moves

    render(unitEditorTemplate(sim, officeB), card);
    const inputB = card.querySelector<HTMLInputElement>("#ed-name")!;
    expect(inputB).not.toBe(inputA); // new selection, new input
    expect(inputB.value).toBe(officeB.label);
  });

  it("a click listener attached before a refresh still fires on the same button after it", () => {
    const { sim, office } = fixture();
    const card = document.createElement("div");
    render(unitEditorTemplate(sim, office), card);
    const btn = card.querySelector<HTMLElement>('[data-edit="rentUp"]')!;
    const onClick = vi.fn();
    btn.addEventListener("click", onClick);

    office.satisfaction = 0.3; // a stat tick lands "mid-click"
    render(unitEditorTemplate(sim, office), card);

    btn.click();
    expect(onClick).toHaveBeenCalledOnce();
    expect(card.contains(btn)).toBe(true);
  });

  it("the Classic rung picker keeps element identity across a refresh and follows the engine value", () => {
    // Same invariant for the Classic card's select: a stat-tick refresh must
    // never recreate the picker (which would collapse an open dropdown), and a
    // price change re-selects the right option through lit's .selected diff.
    const sim = new Simulation(); // Classic
    for (let x = 10; x < 30; x++) expect(sim.tower.place("lobby", 1, x).ok).toBe(true);
    for (let x = 10; x < 30; x++) expect(sim.tower.place("floor", 2, x).ok).toBe(true);
    const r = sim.tower.place("office", 2, 12);
    expect(r.ok).toBe(true);
    const office = sim.tower.units.find((u) => u.id === r.unitId)!;
    office.state = "occupied";
    const card = document.createElement("div");
    // Mirror renderEditor: selection is written post-render by syncRungSelects
    // (a select's options must be attached before its value can be set).
    const paint = () => {
      render(unitEditorTemplate(sim, office), card);
      syncRungSelects(card);
    };
    paint();
    const select = card.querySelector<HTMLSelectElement>("#ed-rung")!;
    expect(select).not.toBeNull();
    expect(select.value).toBe("2"); // Average, the default rung
    office.satisfaction = 0.4; // a stat tick lands mid-interaction
    paint();
    expect(card.querySelector("#ed-rung")).toBe(select);
    sim.priceUnit(office, 15_000); // High
    paint();
    expect(card.querySelector("#ed-rung")).toBe(select);
    expect(select.value).toBe("3");
  });

  it("a shape change (gutted) restructures rows while the action buttons keep identity", () => {
    const { sim, office } = fixture();
    const card = document.createElement("div");
    render(unitEditorTemplate(sim, office), card);
    expect(card.textContent).toContain("Resale value");
    const sell = card.querySelector<HTMLElement>('[data-edit="sell"]')!;
    const status = card.querySelector('[data-field="status"]')!;

    office.state = "gutted";
    render(unitEditorTemplate(sim, office), card);

    expect(status.textContent).toBe("gutted");
    expect(card.textContent).toContain("Scrap value");
    expect(card.textContent).not.toContain("Resale value");
    expect(card.querySelector('[data-edit="sell"]')).toBe(sell);
  });

  it("a car button crossing its disabled bound flips the attribute on the SAME element", () => {
    const { sim, lift } = fixture();
    const card = document.createElement("div");
    render(transportEditorTemplate(sim, lift), card);
    const remove = card.querySelector<HTMLButtonElement>('[data-edit="removecar"]')!;
    // The legacy protocol REBUILT the whole card at this bound (it was part of
    // the shape key); lit just patches the attribute, so even this refresh can
    // no longer swallow an in-flight click.
    expect(remove.disabled).toBe(lift.cars <= 1);
    expect(sim.tower.setCars(lift.id, lift.cars <= 1 ? 2 : 1)).toBe(true);
    render(transportEditorTemplate(sim, lift), card);
    expect(card.querySelector('[data-edit="removecar"]')).toBe(remove);
    expect(remove.disabled).toBe(lift.cars <= 1);
  });
});
