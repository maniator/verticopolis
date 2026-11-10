import { describe, it, expect, beforeEach } from "vitest";
import { MAP_VIEWS, type MapViewId } from "../render/overviewMap/views";
import { MAP_PICKER_DOM, MapViewPicker } from "./overviewMapPicker";

function build(): { picker: MapViewPicker; chosen: MapViewId[] } {
  const chosen: MapViewId[] = [];
  const picker = new MapViewPicker(document, (v) => chosen.push(v));
  document.body.append(picker.root);
  return { picker, chosen };
}

function choose(picker: MapViewPicker, view: string): void {
  picker.select.value = view;
  picker.select.dispatchEvent(new Event("change", { bubbles: true }));
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("the map's View dropdown", () => {
  it("is a select named View with one option per view, Edit selected", () => {
    const { picker } = build();
    expect(picker.root.id).toBe(MAP_PICKER_DOM.root);
    expect(picker.root.tagName).toBe("LABEL");
    expect(picker.root.textContent).toContain("View");
    expect(picker.select.id).toBe(MAP_PICKER_DOM.select);
    expect(picker.root.contains(picker.select)).toBe(true);
    expect([...picker.select.options].map((o) => [o.value, o.textContent])).toEqual(MAP_VIEWS.map((v) => [v.id, v.label]));
    expect(picker.select.value).toBe("edit");
    expect(picker.selected).toBe("edit");
  });

  it("tells the window once per change of view", () => {
    const { picker, chosen } = build();
    choose(picker, "traffic");
    expect(picker.selected).toBe("traffic");
    choose(picker, "traffic");
    choose(picker, "hotel");
    expect(chosen).toEqual(["traffic", "hotel"]);
  });

  it("keeps the selected view for a value no view has", () => {
    const { picker, chosen } = build();
    const odd = document.createElement("option");
    odd.value = "notAView";
    picker.select.append(odd);
    choose(picker, "notAView");
    expect(picker.selected).toBe("edit");
    expect(chosen).toEqual([]);
  });

  it("keeps focus on the select after a choice from the keyboard", () => {
    const { picker } = build();
    picker.select.focus();
    choose(picker, "eval");
    expect(document.activeElement).toBe(picker.select);
  });

  it("gives focus back to what held it after a choice made with a pointer", () => {
    const { picker } = build();
    const map = document.createElement("canvas");
    map.tabIndex = 0;
    document.body.append(map);
    map.focus();
    picker.select.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    picker.select.focus();
    choose(picker, "pricing");
    expect(document.activeElement).toBe(map);
  });

  it("lets go of focus after a pointer choice when nothing held it", () => {
    const { picker } = build();
    picker.select.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    picker.select.focus();
    choose(picker, "occupancy");
    expect(document.activeElement).not.toBe(picker.select);
  });

  it("forgets a pointer press once focus leaves without a choice", () => {
    const { picker } = build();
    picker.select.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    picker.select.focus();
    picker.select.blur();
    picker.select.focus();
    choose(picker, "eval");
    expect(document.activeElement).toBe(picker.select);
  });

  it("forgets a pointer press that chose nothing once a key is pressed on the select", () => {
    const { picker } = build();
    const map = document.createElement("canvas");
    map.tabIndex = 0;
    document.body.append(map);
    map.focus();
    // The list opened with a pointer and closed on the view already chosen:
    // no change, and the select keeps focus.
    picker.select.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    picker.select.focus();
    picker.select.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    choose(picker, "eval");
    expect(document.activeElement).toBe(picker.select);
  });
});
