import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeUI, mountAppDom } from "../tests/uiFixture";
import { HudTower, pump, show } from "./hud.fixture";

/** The texts on the toast rail, newest last. */
const toasts = (): (string | null)[] => Array.from(document.getElementById("toast-wrap")!.children, (c) => c.textContent);
/** The bulletin's lines, oldest first. */
const bulletin = (): (string | null)[] => Array.from(document.getElementById("log")!.children, (c) => c.textContent);

/** A saved tower whose log ends with good news, as a player's autosave does. */
function savedTower(): HudTower {
  const tower = new HudTower();
  tower.emit("Welcome to your new tower.", "info");
  for (let i = 0; i < 4; i++) tower.emit("Parking Space on B5 is now open for business.", "good");
  tower.emit("New tenants: 369 hotel rooms booked.", "good");
  return tower;
}

// The real toast rail holds each toast on a timer, so fake the clock.
beforeEach(() => {
  mountAppDom();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("showing a tower the UI has not drawn yet (boot, a load)", () => {
  it("puts the saved log in the bulletin and raises no toast over the title screen", () => {
    const { ui } = makeUI();
    show(ui, savedTower());
    expect(toasts()).toEqual([]);
    expect(bulletin()).toEqual([
      "Welcome to your new tower.",
      ...Array<string>(4).fill("Parking Space on B5 is now open for business."),
      "New tenants: 369 hotel rooms booked.",
    ]);
  });

  it("still toasts the first line the tower writes after it is shown", () => {
    const { ui } = makeUI();
    const tower = savedTower();
    show(ui, tower);
    pump(ui, tower);
    expect(toasts()).toEqual([]);
    tower.emit("Office on 12 is now open for business.", "good");
    pump(ui, tower);
    expect(toasts()).toEqual(["Office on 12 is now open for business."]);
    expect(bulletin().slice(-1)[0]).toBe("Office on 12 is now open for business.");
  });
});
