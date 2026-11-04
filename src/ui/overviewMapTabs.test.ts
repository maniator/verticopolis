import { describe, it, expect, beforeEach } from "vitest";
import { MAP_VIEWS, type MapViewEntry, type MapViewId } from "../render/overviewMap/views";
import { MAP_TABS_DOM, MapTabs, tabId, tabStep } from "./overviewMapTabs";

function build(views: ReadonlyArray<MapViewEntry> = MAP_VIEWS): { tabs: MapTabs; panel: HTMLElement; chosen: MapViewId[] } {
  document.body.innerHTML = "";
  const panel = document.createElement("div");
  const chosen: MapViewId[] = [];
  const tabs = new MapTabs(document, panel, (v) => chosen.push(v), views);
  document.body.append(tabs.list, panel);
  return { tabs, panel, chosen };
}

const tab = (id: MapViewId) => document.getElementById(tabId(id)) as HTMLButtonElement;
const key = (target: HTMLElement, k: string, init: KeyboardEventInit = {}) => {
  const e = new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(e);
  return e;
};

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("tabStep", () => {
  it("moves to the neighbor with the arrows, wrapping, and to the ends with Home and End", () => {
    expect(tabStep("ArrowRight", 0, 4)).toBe(1);
    expect(tabStep("ArrowDown", 3, 4)).toBe(0);
    expect(tabStep("ArrowLeft", 0, 4)).toBe(3);
    expect(tabStep("ArrowUp", 2, 4)).toBe(1);
    expect(tabStep("Home", 2, 4)).toBe(0);
    expect(tabStep("End", 0, 4)).toBe(3);
    expect(tabStep("Enter", 0, 4)).toBeNull();
    expect(tabStep("ArrowRight", 0, 0)).toBeNull();
  });
});

describe("the map's tab row", () => {
  it("is a tablist of tabs controlling the body, with Edit selected and alone in the Tab order", () => {
    const { tabs, panel } = build();
    expect(tabs.list.getAttribute("role")).toBe("tablist");
    expect(tabs.list.getAttribute("aria-label")).toBe("Map views");
    const all = [...tabs.list.querySelectorAll("button")];
    expect(all.map((b) => b.textContent)).toEqual(["Edit", "Eval", "Pricing", "Hotel"]);
    for (const b of all) {
      expect(b.getAttribute("role")).toBe("tab");
      expect(b.getAttribute("aria-controls")).toBe(MAP_TABS_DOM.panel);
    }
    expect(panel.id).toBe(MAP_TABS_DOM.panel);
    expect(panel.getAttribute("role")).toBe("tabpanel");
    expect(panel.getAttribute("aria-labelledby")).toBe(tabId("edit"));
    expect(tabs.selected).toBe("edit");
    expect(tab("edit").getAttribute("aria-selected")).toBe("true");
    expect(tab("edit").tabIndex).toBe(0);
    for (const id of ["eval", "pricing", "hotel"] as const) {
      expect(tab(id).getAttribute("aria-selected")).toBe("false");
      expect(tab(id).tabIndex).toBe(-1);
    }
  });

  it("selects a tab on a click and tells the window once", () => {
    const { tabs, panel, chosen } = build();
    tab("hotel").click();
    expect(tabs.selected).toBe("hotel");
    expect(chosen).toEqual(["hotel"]);
    expect(panel.getAttribute("aria-labelledby")).toBe(tabId("hotel"));
    expect(tab("hotel").tabIndex).toBe(0);
    tab("hotel").click();
    expect(chosen).toEqual(["hotel"]);
  });

  it("moves focus to a clicked tab only when focus was already in the row", () => {
    build();
    tab("hotel").click();
    expect(document.activeElement).not.toBe(tab("hotel"));
    tab("hotel").focus();
    tab("eval").click();
    expect(document.activeElement).toBe(tab("eval"));
    expect(tab("eval").tabIndex).toBe(0);
  });

  it("keeps focus where it was on a mouse press, so the map keeps its keys", () => {
    build();
    const e = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    tab("hotel").dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
  });

  it("moves selection and focus with the arrow keys, Home and End", () => {
    const { tabs, chosen } = build();
    tab("edit").focus();
    const right = key(tab("edit"), "ArrowRight");
    expect(right.defaultPrevented).toBe(true);
    expect(tabs.selected).toBe("eval");
    expect(document.activeElement).toBe(tab("eval"));
    key(tab("eval"), "ArrowDown");
    expect(tabs.selected).toBe("pricing");
    key(tab("pricing"), "End");
    expect(tabs.selected).toBe("hotel");
    key(tab("hotel"), "ArrowRight");
    expect(tabs.selected).toBe("edit");
    key(tab("edit"), "ArrowLeft");
    expect(tabs.selected).toBe("hotel");
    key(tab("hotel"), "Home");
    expect(tabs.selected).toBe("edit");
    expect(chosen).toEqual(["eval", "pricing", "hotel", "edit", "hotel", "edit"]);
  });

  it("leaves other keys and shortcuts alone", () => {
    const { tabs } = build();
    expect(key(tab("edit"), "b").defaultPrevented).toBe(false);
    expect(key(tab("edit"), "ArrowRight", { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(tabs.selected).toBe("edit");
  });
});
