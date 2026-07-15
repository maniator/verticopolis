import { describe, it, expect, vi } from "vitest";
import { buildPalette } from "./uiPalette";
import type { Tool, UI } from "./UI";

/**
 * The build palette renders its items through lit now (swatch/name/cost spans),
 * with the button a11y wiring (role/tabindex/aria-label + Enter/Space activation)
 * kept imperative on the container. These assert the item markup the e2e
 * selectors and the onboarding pulse targets depend on, plus the activation
 * dispatch, without standing up the whole UI.
 */
function stubUI(): { ui: UI; palette: HTMLElement; selectTool: ReturnType<typeof vi.fn> } {
  const palette = document.createElement("div");
  const selectTool = vi.fn();
  const ui = { el: { palette }, selectTool } as unknown as UI;
  return { ui, palette, selectTool };
}

describe("buildPalette", () => {
  it("renders tool items with a swatch, a name, data-tool, and button a11y", () => {
    const { ui, palette } = stubUI();
    buildPalette(ui);
    const inspect = palette.querySelector<HTMLElement>('.pal-item[data-tool="inspect"]')!;
    expect(inspect).not.toBeNull();
    expect(inspect.querySelector(".pal-swatch")).not.toBeNull();
    expect(inspect.querySelector(".pal-name")?.textContent).toBe("🔍 Inspect");
    expect(inspect.getAttribute("role")).toBe("button");
    expect(inspect.tabIndex).toBe(0);
    expect(inspect.getAttribute("aria-label")).toBe("🔍 Inspect");
    expect(palette.querySelector('.pal-item[data-tool="bulldoze"]')).not.toBeNull();
  });

  it("renders a facility item with swatch (colored), name, cost, and its group tag", () => {
    const { ui, palette } = stubUI();
    buildPalette(ui);
    const office = palette.querySelector<HTMLElement>('.pal-item[data-kind="office"]')!;
    expect(office).not.toBeNull();
    expect(office.dataset.group).toBe("Commercial");
    const swatch = office.querySelector<HTMLElement>(".pal-swatch")!;
    expect(swatch.getAttribute("style")).toContain("background:");
    expect(office.querySelector(".pal-name")?.textContent).toBeTruthy();
    expect(office.querySelector(".pal-cost")?.textContent?.startsWith("$")).toBe(true);
    // The aria-label folds in the cost so a screen reader hears the price.
    expect(office.getAttribute("aria-label")).toContain("$");
  });

  it("activates a tool item on click and on Enter, dispatching selectTool", () => {
    const { ui, palette, selectTool } = stubUI();
    buildPalette(ui);
    const office = palette.querySelector<HTMLElement>('.pal-item[data-kind="office"]')!;
    office.dispatchEvent(new Event("click", { bubbles: true }));
    expect(selectTool).toHaveBeenLastCalledWith({ type: "build", kind: "office" } as Tool);
    office.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(selectTool).toHaveBeenCalledTimes(2);
  });

  it("renders group titles carrying their data-group so the lock scan can hide empty groups", () => {
    const { ui, palette } = stubUI();
    buildPalette(ui);
    expect(palette.querySelector('.pal-group-title[data-group="Structure"]')).not.toBeNull();
    expect(palette.querySelector('.pal-group-title[data-group="Special"]')).not.toBeNull();
  });
});
