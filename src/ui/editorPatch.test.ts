// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
import { render } from "lit-html";
import type { TemplateResult } from "lit-html";
import type { TransportDetail, UnitDetail } from "../simport/panels";
import type { GameMode } from "../shared/types";
import { catalogFor } from "../tests/catalogFixture";
import { transportDetail, unitDetail } from "../tests/fixtures/detailCards";
import { transportEditorTemplate, unitEditorTemplate } from "./templates/editor";
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

/** The cards a refresh redraws: a MODERN occupied office (rename + the
 *  '+ rent' stepper these identity tests pin; Classic renders the rung
 *  picker, which has its own identity test below) and a standard elevator.
 *  Each refresh is a new card, as the pump reads one. */
const office = (over: Partial<UnitDetail> = {}, mode: GameMode = "modern") => unitDetail(mode, "office", { id: 1, x: 12, ...over });
const lift = (cars: number) => transportDetail("elevatorStandard", 2, { id: 5, cars });

function unitEditor(u: UnitDetail, mode: GameMode = "modern"): TemplateResult {
  return unitEditorTemplate(u, catalogFor(mode), 7, false, []);
}

function transportEditor(t: TransportDetail): TemplateResult {
  return transportEditorTemplate(t, catalogFor("classic"), []);
}

describe("editor card lit diffing — updates in place, element identity survives", () => {
  it("patches a changed stat cell without recreating the buttons or the rename input", () => {
    const card = document.createElement("div");
    render(unitEditor(office({ satisfaction: 0.5 })), card);
    const btn = card.querySelector<HTMLElement>('[data-edit="rentUp"]')!;
    const name = card.querySelector<HTMLInputElement>("#ed-name")!;
    const evalCell = card.querySelector('[data-field="eval"]')!;
    expect(evalCell.textContent).toContain("50%");

    render(unitEditor(office({ satisfaction: 0.78 })), card);

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
    const officeB = office({ id: 2, x: 21, label: "Office B" });
    const card = document.createElement("div");
    render(unitEditor(office()), card);
    const inputA = card.querySelector<HTMLInputElement>("#ed-name")!;
    inputA.value = "half-typed"; // player is mid-rename when the selection moves

    render(unitEditor(officeB), card);
    const inputB = card.querySelector<HTMLInputElement>("#ed-name")!;
    expect(inputB).not.toBe(inputA); // new selection, new input
    expect(inputB.value).toBe(officeB.label);
  });

  it("a click listener attached before a refresh still fires on the same button after it", () => {
    const card = document.createElement("div");
    render(unitEditor(office()), card);
    const btn = card.querySelector<HTMLElement>('[data-edit="rentUp"]')!;
    const onClick = vi.fn();
    btn.addEventListener("click", onClick);

    render(unitEditor(office({ satisfaction: 0.3 })), card); // a stat tick lands "mid-click"

    btn.click();
    expect(onClick).toHaveBeenCalledOnce();
    expect(card.contains(btn)).toBe(true);
  });

  it("the Classic rung picker keeps element identity across a refresh and follows the engine value", () => {
    // Same invariant for the Classic card's select: a stat-tick refresh must
    // never recreate the picker (which would collapse an open dropdown), and a
    // price change re-selects the right option through syncRungSelects, the
    // post-render pass that writes select.value from data-current (lit commits
    // option bindings before the options attach, so the value write must come
    // after render).
    let classic = office({}, "classic");
    const card = document.createElement("div");
    // Mirror renderEditor: selection is written post-render by syncRungSelects
    // (a select's options must be attached before its value can be set).
    const paint = () => {
      render(unitEditor(classic, "classic"), card);
      syncRungSelects(card);
    };
    paint();
    const select = card.querySelector<HTMLSelectElement>("#ed-rung")!;
    expect(select).not.toBeNull();
    expect(select.value).toBe("2"); // Average, the default rung
    classic = office({ satisfaction: 0.4 }, "classic"); // a stat tick lands mid-interaction
    paint();
    expect(card.querySelector("#ed-rung")).toBe(select);
    classic = office({ satisfaction: 0.4, rent: 15_000 }, "classic"); // High
    paint();
    expect(card.querySelector("#ed-rung")).toBe(select);
    expect(select.value).toBe("3");
  });

  it("a FOCUSED rung picker is never overwritten by the pump sync (the in-progress pick survives)", () => {
    // Some platforms move a select's value while the player arrows through the
    // open list, before change commits; the ~6 Hz editor pump must not write
    // engine truth over that in-progress pick. After blur, the next sync
    // reconciles normally.
    const classic = office({}, "classic");
    const card = document.createElement("div");
    document.body.appendChild(card); // focus needs a connected element
    try {
      const paint = () => {
        render(unitEditor(classic, "classic"), card);
        syncRungSelects(card);
      };
      paint();
      const select = card.querySelector<HTMLSelectElement>("#ed-rung")!;
      select.focus();
      expect(document.activeElement).toBe(select);
      select.value = "3"; // mid-pick: the player moved the value, change not yet committed
      syncRungSelects(card); // a pump tick lands mid-interaction
      expect(select.value).toBe("3"); // the pick survives
      select.blur();
      syncRungSelects(card); // first sync after blur reconciles to engine truth
      expect(select.value).toBe("2");
    } finally {
      card.remove();
    }
  });

  it("a shape change (gutted) restructures rows while the action buttons keep identity", () => {
    const card = document.createElement("div");
    render(unitEditor(office()), card);
    expect(card.textContent).toContain("Resale value");
    const sell = card.querySelector<HTMLElement>('[data-edit="sell"]')!;
    const status = card.querySelector('[data-field="status"]')!;

    render(unitEditor(office({ state: "gutted" })), card);

    expect(status.textContent).toBe("gutted");
    expect(card.textContent).toContain("Scrap value");
    expect(card.textContent).not.toContain("Resale value");
    expect(card.querySelector('[data-edit="sell"]')).toBe(sell);
  });

  it("a car button crossing its disabled bound flips the attribute on the SAME element", () => {
    const card = document.createElement("div");
    render(transportEditor(lift(1)), card);
    const remove = card.querySelector<HTMLButtonElement>('[data-edit="removecar"]')!;
    // The legacy protocol REBUILT the whole card at this bound (it was part of
    // the shape key); lit just patches the attribute, so even this refresh can
    // no longer swallow an in-flight click.
    expect(remove.disabled).toBe(true);
    render(transportEditor(lift(2)), card);
    expect(card.querySelector('[data-edit="removecar"]')).toBe(remove);
    expect(remove.disabled).toBe(false);
  });
});
