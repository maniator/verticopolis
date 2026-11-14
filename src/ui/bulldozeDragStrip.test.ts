import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bulldozePickerFor, syncBulldozeDragStrip } from "./bulldozeDragStrip";
import type { DragClears } from "../game/bulldozeDrag";
import { catalogFor } from "../tests/catalogFixture";
import { renderToolCard } from "./toolCard";
import type { UI } from "./UI";

/**
 * The Bulldoze card's "Drag clears" choice and the phone's strip for it: the
 * strip shows while the bulldozer is armed, and a pick from either redraws
 * both.
 */

let strip: HTMLElement;

beforeEach(() => {
  strip = document.createElement("div");
  strip.id = "bulldoze-drag-strip";
  strip.hidden = true;
  document.body.append(strip);
});
afterEach(() => strip.remove());

const pressed = (root: ParentNode) => [...root.querySelectorAll("button")].map((b) => [b.textContent, b.getAttribute("aria-pressed")]);

describe("syncBulldozeDragStrip", () => {
  it("shows both choices while the bulldozer is armed, the pick pressed", () => {
    syncBulldozeDragStrip({ type: "bulldoze" }, { clears: "one kind", pick: vi.fn() });
    expect(strip.hidden).toBe(false);
    expect(pressed(strip)).toEqual([
      ["One kind", "true"],
      ["Everything", "false"],
    ]);
  });

  it("hides and empties itself for any other tool", () => {
    syncBulldozeDragStrip({ type: "bulldoze" }, { clears: "one kind", pick: vi.fn() });
    syncBulldozeDragStrip({ type: "inspect" }, { clears: "one kind", pick: vi.fn() });
    expect(strip.hidden).toBe(true);
    expect(strip.querySelectorAll("button")).toHaveLength(0);
  });
});

describe("bulldozePickerFor", () => {
  it("picks on the choice from the strip, then redraws the card and the strip", () => {
    let clears: DragClears = "one kind";
    const choice = { get clears() { return clears; }, pick: vi.fn((c: DragClears) => (clears = c)) };
    const toolInfo = document.createElement("div");
    const ui = { cb: { bulldozeDrag: () => choice }, tool: { type: "bulldoze" }, el: { toolInfo } } as unknown as UI;
    syncBulldozeDragStrip(ui.tool, bulldozePickerFor(ui));
    strip.querySelectorAll("button")[1]!.click();
    expect(choice.pick).toHaveBeenCalledExactlyOnceWith("everything");
    expect(pressed(toolInfo.querySelector(".ti-drag-clears")!)).toEqual([
      ["One kind", "false"],
      ["Everything", "true"],
    ]);
    expect(pressed(strip).map(([, on]) => on)).toEqual(["false", "true"]);
    expect(toolInfo.textContent).toContain("everything it crosses");
  });
});

describe("renderToolCard", () => {
  it("draws the Bulldoze card with its Drag clears choice and shows the strip, then hides it for another tool", () => {
    const choice = { clears: "everything" as DragClears, pick: vi.fn() };
    const toolInfo = document.createElement("div");
    const ui = { cb: { bulldozeDrag: () => choice, lobbyHeight: () => ({ picked: 1, pick: vi.fn() }), getCatalog: () => catalogFor("modern") }, tool: { type: "bulldoze" }, el: { toolInfo } } as unknown as UI;
    renderToolCard(ui, { type: "bulldoze" });
    expect(pressed(toolInfo.querySelector(".ti-drag-clears")!).map(([, on]) => on)).toEqual(["false", "true"]);
    expect(strip.hidden).toBe(false);
    renderToolCard(ui, { type: "inspect" });
    expect(toolInfo.querySelector(".ti-drag-clears")).toBeNull();
    expect(strip.hidden).toBe(true);
  });
});
