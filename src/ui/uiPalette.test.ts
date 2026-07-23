import { describe, it, expect, vi } from "vitest";
import { buildPalette, selectGroup, syncPaletteTabs } from "./uiPalette";
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
  const ui = { el: { palette, paletteTabs: tabs }, selectTool } as unknown as UI;
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
    expect(inspect.querySelector(".pal-name")?.textContent).toBe("🔍 Inspect");
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

  it("activates a facility build item on click and on Enter, dispatching selectTool", () => {
    const { ui, palette, selectTool } = stubUI();
    buildPalette(ui);
    const office = palette.querySelector<HTMLElement>('.pal-item[data-kind="office"]')!;
    office.dispatchEvent(new Event("click", { bubbles: true }));
    expect(selectTool).toHaveBeenLastCalledWith({ type: "build", kind: "office" } as Tool);
    office.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(selectTool).toHaveBeenCalledTimes(2);
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
