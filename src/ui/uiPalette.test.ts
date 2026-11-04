import { describe, it, expect, vi } from "vitest";
import { toolInfoFor } from "./templates/toolInfo";
import { renderToFragment } from "./testing/litTestUtils";
import { catalogFor } from "../engine/catalog";
import { buildPalette, relabelPalette, selectGroup, syncPaletteTabs } from "./uiPalette";
import type { Tool, UI } from "./UI";

/**
 * The build palette: Inspect/Bulldoze in a pinned cluster, every build category a
 * `.pal-group` section, and a phone-only category tab bar that shows one section at
 * a time. These assert the item markup the e2e selectors and onboarding pulse
 * depend on, plus the tab controller (sticky selection, empty-group hiding, the
 * Modern sub-band, and the unlock "new" pip), driven through the `.locked` classes
 * the lock scan writes, without standing up the whole UI.
 */
function stubUI(): { ui: UI; palette: HTMLElement; tabs: HTMLElement; selectTool: ReturnType<typeof vi.fn> } {
  const palette = document.createElement("div");
  const tabs = document.createElement("div");
  const selectTool = vi.fn();
  const ui = { el: { palette, paletteTabs: tabs }, selectTool, cb: { getCatalog: () => catalogFor("classic") } } as unknown as UI;
  return { ui, palette, tabs, selectTool };
}

/** Simulate the lock scan for one group: set/clear `.locked` on its facility items. */
function setLocked(palette: HTMLElement, group: string, locked: boolean): void {
  palette.querySelectorAll<HTMLElement>(`.pal-group[data-group="${group}"] .pal-item[data-kind]`).forEach((it) => {
    it.classList.toggle("locked", locked);
  });
}

describe("buildPalette", () => {
  it("renders pinned tool items with a swatch, a name, data-tool, and button a11y", () => {
    const { ui, palette } = stubUI();
    buildPalette(ui);
    const inspect = palette.querySelector<HTMLElement>('.pal-pinned .pal-item[data-tool="inspect"]')!;
    expect(inspect).not.toBeNull();
    expect(inspect.querySelector(".pal-swatch")).not.toBeNull();
    expect(inspect.querySelector(".pal-name svg")?.getAttribute("data-icon")).toBe("inspect");
    expect(inspect.querySelector(".pal-name")?.textContent?.trim()).toBe("Inspect");
    expect(inspect.getAttribute("role")).toBe("button");
    expect(inspect.tabIndex).toBe(0);
    expect(palette.querySelector('.pal-pinned .pal-item[data-tool="bulldoze"]')).not.toBeNull();
  });

  it("renders a facility item with swatch, name, cost, and its group tag, inside its section", () => {
    const { ui, palette } = stubUI();
    buildPalette(ui);
    const office = palette.querySelector<HTMLElement>('.pal-group[data-group="Commercial"] .pal-item[data-kind="office"]')!;
    expect(office).not.toBeNull();
    expect(office.dataset.group).toBe("Commercial");
    expect(office.querySelector<HTMLElement>(".pal-swatch")!.getAttribute("style")).toContain("background:");
    expect(office.querySelector(".pal-cost")?.textContent?.startsWith("$")).toBe(true);
    expect(office.getAttribute("aria-label")).toContain("$");
  });

  it("reads names and prices from the tower's catalog (#921)", () => {
    const { ui, palette } = stubUI();
    const base = catalogFor("classic");
    const marked = { ...base, facilities: base.facilities.map((f) => (f.key === "office" ? { ...f, name: "Corner Suite", cost: 77_000 } : f)) };
    (ui as unknown as { cb: { getCatalog: () => typeof marked } }).cb.getCatalog = () => marked;
    buildPalette(ui);
    const office = palette.querySelector<HTMLElement>('.pal-item[data-kind="office"]')!;
    expect(office.querySelector(".pal-name")?.textContent).toBe("Corner Suite");
    expect(office.querySelector(".pal-cost")?.textContent).toBe("$77k");
    const card = renderToFragment(toolInfoFor(marked, "office")).textContent ?? "";
    expect(card).toContain("Corner Suite");
    expect(card).toContain("Cost: $77,000");
  });

  it("activates a facility build item on click and on Enter, dispatching selectTool", () => {
    const { ui, palette, selectTool } = stubUI();
    buildPalette(ui);
    const office = palette.querySelector<HTMLElement>('.pal-item[data-kind="office"]')!;
    office.dispatchEvent(new Event("click", { bubbles: true }));
    expect(selectTool).toHaveBeenLastCalledWith({ type: "build", kind: "office" } as Tool);
    office.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(selectTool).toHaveBeenCalledTimes(2);
  });

  it("activates on the Space release, letting the key reach the window, where the world reads it as the pan key", () => {
    const { ui, palette, selectTool } = stubUI();
    buildPalette(ui);
    document.body.appendChild(palette);
    const office = palette.querySelector<HTMLElement>('.pal-item[data-kind="office"]')!;
    const key = (type: string, init: KeyboardEventInit = {}): KeyboardEvent => {
      const event = new KeyboardEvent(type, { key: " ", bubbles: true, cancelable: true, ...init });
      office.dispatchEvent(event);
      return event;
    };
    const seen = vi.fn();
    window.addEventListener("keydown", seen);
    try {
      expect(key("keydown").defaultPrevented, "the press keeps the palette from scrolling").toBe(true);
      expect(key("keydown", { repeat: true }).defaultPrevented, "and so do its repeats").toBe(true);
      expect(selectTool).not.toHaveBeenCalled();
      key("keyup");
      expect(selectTool).toHaveBeenLastCalledWith({ type: "build", kind: "office" } as Tool);
      expect(seen).toHaveBeenCalledTimes(2);
    } finally {
      window.removeEventListener("keydown", seen);
      palette.remove();
    }
  });

  it("does not activate on the release of a Space held as the pan key", () => {
    const { ui, palette, selectTool } = stubUI();
    buildPalette(ui);
    document.body.appendChild(palette);
    const office = palette.querySelector<HTMLElement>('.pal-item[data-kind="office"]')!;
    // inputKeys stops the release of a pan-key hold in the capture phase.
    const stopPan = (e: KeyboardEvent): void => e.preventDefault();
    window.addEventListener("keyup", stopPan, true);
    try {
      office.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true }));
      office.dispatchEvent(new KeyboardEvent("keyup", { key: " ", bubbles: true, cancelable: true }));
    } finally {
      window.removeEventListener("keyup", stopPan, true);
      palette.remove();
    }
    expect(selectTool).not.toHaveBeenCalled();
  });

  it("ignores a Space release whose press it never saw, and a held Enter's repeats", () => {
    const { ui, palette, selectTool } = stubUI();
    buildPalette(ui);
    const office = palette.querySelector<HTMLElement>('.pal-item[data-kind="office"]')!;
    office.dispatchEvent(new KeyboardEvent("keyup", { key: " ", bubbles: true, cancelable: true }));
    office.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    office.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", repeat: true, bubbles: true, cancelable: true }));
    expect(selectTool).toHaveBeenCalledTimes(1);
  });

  it("leaves Ctrl, Cmd or Alt + Space to the system, picking nothing", () => {
    const { ui, palette, selectTool } = stubUI();
    buildPalette(ui);
    const office = palette.querySelector<HTMLElement>('.pal-item[data-kind="office"]')!;
    for (const mod of ["ctrlKey", "metaKey", "altKey"] as const) {
      const down = new KeyboardEvent("keydown", { key: " ", [mod]: true, bubbles: true, cancelable: true });
      office.dispatchEvent(down);
      expect(down.defaultPrevented, `${mod} + Space reaches the system`).toBe(false);
      office.dispatchEvent(new KeyboardEvent("keyup", { key: " ", bubbles: true, cancelable: true }));
    }
    expect(selectTool).not.toHaveBeenCalled();
  });

  it("drops a Space press whose release was lost when a chord with Space comes next", () => {
    const { ui, palette, selectTool } = stubUI();
    buildPalette(ui);
    const office = palette.querySelector<HTMLElement>('.pal-item[data-kind="office"]')!;
    // A plain press whose release never came (Cmd went down while it was held).
    office.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true }));
    office.dispatchEvent(new KeyboardEvent("keydown", { key: " ", ctrlKey: true, bubbles: true, cancelable: true }));
    office.dispatchEvent(new KeyboardEvent("keyup", { key: " ", ctrlKey: true, bubbles: true, cancelable: true }));
    expect(selectTool, "the chord's release picks nothing").not.toHaveBeenCalled();
  });

  it("drops a Space press when Ctrl, Cmd or Alt goes down, or comes with the release", () => {
    const { ui, palette, selectTool } = stubUI();
    buildPalette(ui);
    const office = palette.querySelector<HTMLElement>('.pal-item[data-kind="office"]')!;
    const key = (type: string, init: KeyboardEventInit): void => {
      office.dispatchEvent(new KeyboardEvent(type, { bubbles: true, cancelable: true, ...init }));
    };
    for (const [mod, name] of [["ctrlKey", "Control"], ["metaKey", "Meta"], ["altKey", "Alt"]] as const) {
      key("keydown", { key: " " });
      key("keydown", { key: name, [mod]: true });
      key("keyup", { key: name });
      key("keyup", { key: " " });
    }
    expect(selectTool, "a modifier pressed mid-hold drops the press").not.toHaveBeenCalled();
    // With Option held, macOS reports the release as a no-break space: it still
    // ends the press, so a stray plain release after it picks nothing either.
    key("keydown", { key: " " });
    key("keyup", { key: "\u00a0", code: "Space", altKey: true });
    key("keyup", { key: " " });
    expect(selectTool, "the Option release ends the press").not.toHaveBeenCalled();
  });

  it("wraps each group in a section carrying its data-group so the scan can hide empty ones", () => {
    const { ui, palette } = stubUI();
    buildPalette(ui);
    expect(palette.querySelector('.pal-group[data-group="Structure"]')).not.toBeNull();
    expect(palette.querySelector('.pal-group[data-group="Special"]')).not.toBeNull();
    expect(palette.querySelector('.pal-group[data-group="Structure"] .pal-group-title[data-group="Structure"]')).not.toBeNull();
  });

  it("gives Commercial and Leisure a Modern sub-band with the modernOnly venues under it", () => {
    const { ui, palette } = stubUI();
    buildPalette(ui);
    const leisureSub = palette.querySelector<HTMLElement>('.pal-group[data-group="Leisure"] .pal-sub[data-sub-group="Leisure"]');
    expect(leisureSub?.textContent).toBe("Modern");
    // A Modern venue is tagged .pal-mod and sits in the Leisure section.
    const nightclub = palette.querySelector<HTMLElement>('.pal-group[data-group="Leisure"] .pal-item[data-kind="nightclub"]');
    expect(nightclub?.classList.contains("pal-mod")).toBe(true);
    // Structure has no Modern venues, so no sub-band.
    expect(palette.querySelector('.pal-group[data-group="Structure"] .pal-sub')).toBeNull();
  });
});

describe("category tabs", () => {
  it("builds one tab per build group with tablist a11y", () => {
    const { ui, tabs } = stubUI();
    buildPalette(ui);
    expect(tabs.getAttribute("role")).toBe("tablist");
    const labels = [...tabs.querySelectorAll(".pal-tab")].map((t) => t.textContent);
    expect(labels).toEqual(["Structure", "Transport", "Commercial", "Living", "Leisure", "Services", "Special"]);
  });

  it("leaves the first category active from the start (no blank content row before the first scan)", () => {
    const { ui, palette, tabs } = stubUI();
    buildPalette(ui);
    expect(palette.querySelector(".pal-group.tab-active")?.getAttribute("data-group")).toBe("Structure");
    expect(tabs.querySelector('.pal-tab[aria-selected="true"]')?.getAttribute("data-group")).toBe("Structure");
  });

  it("selectGroup marks the section active and the tab selected (sticky, no menu)", () => {
    const { ui, palette, tabs } = stubUI();
    buildPalette(ui);
    selectGroup(ui, "Leisure");
    expect(palette.querySelector(".pal-group.tab-active")?.getAttribute("data-group")).toBe("Leisure");
    expect(tabs.querySelector('.pal-tab[aria-selected="true"]')?.getAttribute("data-group")).toBe("Leisure");
    // Only one section is active at a time.
    expect(palette.querySelectorAll(".pal-group.tab-active").length).toBe(1);
  });

  it("clicking a tab button activates its group (the path onboarding uses to reveal a hidden tool)", () => {
    const { ui, palette, tabs } = stubUI();
    buildPalette(ui);
    // Onboarding opens the category holding a pulsed tool by clicking its tab.
    tabs.querySelector<HTMLElement>('.pal-tab[data-group="Commercial"]')!.dispatchEvent(new Event("click", { bubbles: true }));
    expect(palette.querySelector(".pal-group.tab-active")?.getAttribute("data-group")).toBe("Commercial");
  });

  it("hides an all-locked category's tab and section, and its Modern sub-band until a venue unlocks", () => {
    const { ui, palette, tabs } = stubUI();
    buildPalette(ui);
    setLocked(palette, "Leisure", true); // below 3 stars: everything in Leisure locked
    syncPaletteTabs(ui);
    expect(tabs.querySelector<HTMLElement>('.pal-tab[data-group="Leisure"]')!.hidden).toBe(true);
    expect(palette.querySelector<HTMLElement>('.pal-group[data-group="Leisure"]')!.hidden).toBe(true);
    // Now unlock Leisure: tab, section, and Modern sub-band all reappear.
    setLocked(palette, "Leisure", false);
    syncPaletteTabs(ui);
    expect(tabs.querySelector<HTMLElement>('.pal-tab[data-group="Leisure"]')!.hidden).toBe(false);
    expect(palette.querySelector<HTMLElement>('.pal-group[data-group="Leisure"] .pal-sub')!.hidden).toBe(false);
  });

  it("pips a tab whose tools just unlocked, but not on the first scan, and clears the pip on open", () => {
    const { ui, palette, tabs } = stubUI();
    buildPalette(ui);
    const leisureTab = tabs.querySelector<HTMLElement>('.pal-tab[data-group="Leisure"]')!;
    setLocked(palette, "Leisure", true);
    syncPaletteTabs(ui); // establish the baseline count (0) without pipping
    expect(leisureTab.classList.contains("has-new")).toBe(false);
    setLocked(palette, "Leisure", false);
    selectGroup(ui, "Structure"); // Leisure is not the open tab
    syncPaletteTabs(ui); // Leisure grew 0 -> 8: pip it
    expect(leisureTab.classList.contains("has-new")).toBe(true);
    selectGroup(ui, "Leisure"); // opening it clears the pip
    expect(leisureTab.classList.contains("has-new")).toBe(false);
  });

  it("keeps a valid tab selected: auto-selects the first visible one, and re-selects when the active empties", () => {
    const { ui, palette, tabs } = stubUI();
    buildPalette(ui);
    syncPaletteTabs(ui); // nothing selected yet -> first visible (Structure)
    expect(tabs.querySelector('.pal-tab[aria-selected="true"]')?.getAttribute("data-group")).toBe("Structure");
    selectGroup(ui, "Leisure");
    setLocked(palette, "Leisure", true); // the open category just emptied
    syncPaletteTabs(ui);
    const selected = tabs.querySelector<HTMLElement>('.pal-tab[aria-selected="true"]')!;
    expect(selected.hidden).toBe(false);
    expect(selected.getAttribute("data-group")).not.toBe("Leisure");
  });
});

describe("relabelPalette (#921)", () => {
  it("keeps the buttons when the layout is the same, and rebuilds them when it differs", () => {
    const { ui, palette, tabs } = stubUI();
    const base = catalogFor("classic");
    (ui as unknown as { tool: Tool; paletteScanKey: string | null }).tool = { type: "build", kind: "office" };
    (ui as unknown as { paletteScanKey: string | null }).paletteScanKey = "scanned";
    buildPalette(ui);
    selectGroup(ui, "Commercial");
    const office = palette.querySelector('.pal-item[data-kind="office"]');
    // Same layout, new prices: the same nodes are relabeled.
    relabelPalette(ui, { ...base, facilities: base.facilities.map((f) => (f.key === "office" ? { ...f, cost: 12_345 } : f)) });
    expect(palette.querySelector('.pal-item[data-kind="office"]')).toBe(office);
    expect(office?.querySelector(".pal-cost")?.textContent).toContain("12");
    expect((ui as unknown as { paletteScanKey: string | null }).paletteScanKey).toBe("scanned");
    // A catalog that moves the office to another group lays the palette out
    // differently: the buttons are rebuilt, the open tab and the active tool
    // survive, and the lock scan is asked to run again.
    const moved = { ...base, facilities: base.facilities.map((f) => (f.key === "office" ? { ...f, category: "service" as const } : f)) };
    // Onboarding has pulsed the office, and the keyboard sits on it.
    document.body.appendChild(palette);
    office!.classList.add("tt-pulse");
    (office as HTMLElement).focus();
    relabelPalette(ui, moved);
    const rebuilt = palette.querySelector<HTMLElement>('.pal-item[data-kind="office"]')!;
    expect(rebuilt).not.toBe(office);
    expect(rebuilt.dataset.group).toBe("Services");
    expect(rebuilt.classList.contains("active")).toBe(true);
    expect(palette.querySelectorAll('.pal-item[data-kind="office"]')).toHaveLength(1);
    expect(tabs.querySelector('.pal-tab[aria-selected="true"]')?.getAttribute("data-group")).toBe("Commercial");
    expect((ui as unknown as { paletteScanKey: string | null }).paletteScanKey).toBeNull();
    expect(ui.paletteCatalog).toBe(moved);
    expect(rebuilt.classList.contains("tt-pulse")).toBe(true);
    expect(document.activeElement).toBe(rebuilt);
    palette.remove();
  });
});
