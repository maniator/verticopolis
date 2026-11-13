import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { lobbyPickerFor, syncLobbyHeightStrip } from "./lobbyHeightStrip";
import { catalogFor } from "../tests/catalogFixture";
import type { UI } from "./UI";

/**
 * The phone's lobby height strip (#308): it shows the Lobby card's 1 / 2 / 3
 * story choice over the tower while the Lobby tool is armed, and a pick from
 * it or the card redraws both.
 */

const catalog = catalogFor("modern");
let strip: HTMLElement;

beforeEach(() => {
  strip = document.createElement("div");
  strip.id = "lobby-height-strip";
  strip.hidden = true;
  document.body.append(strip);
});
afterEach(() => strip.remove());

const buttons = () => [...strip.querySelectorAll("button")];

describe("syncLobbyHeightStrip", () => {
  it("shows one button per catalog height while the Lobby tool is armed, the pick pressed", () => {
    syncLobbyHeightStrip({ type: "build", kind: "lobby" }, catalog, { picked: 2, pick: vi.fn() });
    expect(strip.hidden).toBe(false);
    expect(buttons().map((b) => b.textContent)).toEqual(["1 story", "2 stories", "3 stories"]);
    expect(buttons().map((b) => b.getAttribute("aria-pressed"))).toEqual(["false", "true", "false"]);
  });

  it("hides and empties itself for any other tool", () => {
    syncLobbyHeightStrip({ type: "build", kind: "lobby" }, catalog, { picked: 1, pick: vi.fn() });
    syncLobbyHeightStrip({ type: "build", kind: "floor" }, catalog, { picked: 1, pick: vi.fn() });
    expect(strip.hidden).toBe(true);
    expect(buttons()).toHaveLength(0);
    syncLobbyHeightStrip({ type: "inspect" }, catalog, { picked: 1, pick: vi.fn() });
    expect(strip.hidden).toBe(true);
  });
});

describe("lobbyPickerFor", () => {
  it("picks on the choice, then redraws the card and the strip with the new pick", () => {
    let picked = 1;
    const choice = { get picked() { return picked; }, pick: vi.fn((h: number) => (picked = h)) };
    const toolInfo = document.createElement("div");
    const ui = { cb: { lobbyHeight: () => choice, getCatalog: () => catalog }, tool: { type: "build", kind: "lobby" }, el: { toolInfo } } as unknown as UI;
    const picker = lobbyPickerFor(ui);
    expect(picker.picked).toBe(1);
    picker.pick(3);
    expect(choice.pick).toHaveBeenCalledExactlyOnceWith(3);
    const pressed = (root: ParentNode) => [...root.querySelectorAll("button")].map((b) => b.getAttribute("aria-pressed"));
    expect(pressed(toolInfo.querySelector(".ti-lobby-height")!)).toEqual(["false", "false", "true"]);
    expect(pressed(strip)).toEqual(["false", "false", "true"]);
  });
});
