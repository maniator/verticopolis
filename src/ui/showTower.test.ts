import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeUI, mountAppDom } from "../tests/uiFixture";
import { HudTower, pump, show } from "./hud.fixture";

/** The texts on the toast rail, newest last. */
const toasts = (): (string | null)[] =>
  Array.from(document.getElementById("toast-wrap")!.children, (c) => c.textContent);
/** The bulletin's lines in the order the window shows them, newest on top. */
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
      "New tenants: 369 hotel rooms booked.",
      ...Array<string>(4).fill("Parking Space on B5 is now open for business."),
      "Welcome to your new tower.",
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
    expect(bulletin()[0]).toBe("Office on 12 is now open for business.");
  });

  it("keeps the newest line on top across batches and drops the oldest past the cap", () => {
    const { ui } = makeUI();
    const tower = savedTower();
    show(ui, tower);
    pump(ui, tower);
    // A batch of two, then one more: each lands above the lines before it.
    tower.emit("Office on 12 is now open for business.", "good");
    tower.emit("Condo on 14 sold for $80,000.", "money");
    pump(ui, tower);
    tower.emit("A fire broke out on 9.", "bad");
    pump(ui, tower);
    expect(bulletin().slice(0, 4)).toEqual([
      "A fire broke out on 9.",
      "Condo on 14 sold for $80,000.",
      "Office on 12 is now open for business.",
      "New tenants: 369 hotel rooms booked.",
    ]);
    // Past the window's cap the oldest line, at the bottom, is the one dropped.
    for (let i = 1; i <= HudTower.LOG_KEEP; i++) {
      tower.emit(`event ${i}`, "info");
      pump(ui, tower);
    }
    const lines = bulletin();
    expect(lines).toHaveLength(HudTower.LOG_KEEP);
    expect(lines[0]).toBe(`event ${HudTower.LOG_KEEP}`);
    expect(lines[lines.length - 1]).toBe("event 1");
    expect(lines).not.toContain("A fire broke out on 9.");
  });

  it("keeps a reader scrolled back through the Bulletin on the same lines as new ones arrive", () => {
    const { ui } = makeUI();
    const tower = savedTower();
    show(ui, tower);
    // jsdom has no layout: each line is 20px tall here.
    const log = document.getElementById("log")!;
    Object.defineProperty(log, "scrollHeight", { configurable: true, get: () => log.childElementCount * 20 });
    log.scrollTop = 60;
    tower.emit("Office on 12 is now open for business.", "good");
    tower.emit("Condo on 14 sold for $80,000.", "money");
    pump(ui, tower);
    expect(log.scrollTop).toBe(100); // pushed down by the two new lines
    // At the top it stays at the top, so the newest line shows.
    log.scrollTop = 0;
    tower.emit("A fire broke out on 9.", "bad");
    pump(ui, tower);
    expect(log.scrollTop).toBe(0);
  });

  it("keeps a scrolled-back reader in place once the Bulletin is full", () => {
    const { ui } = makeUI();
    const tower = new HudTower();
    for (let i = 1; i <= HudTower.LOG_KEEP; i++) tower.emit(`event ${i}`, "info");
    show(ui, tower);
    const log = document.getElementById("log")!;
    expect(log.childElementCount).toBe(HudTower.LOG_KEEP);
    Object.defineProperty(log, "scrollHeight", { configurable: true, get: () => log.childElementCount * 20 });
    log.scrollTop = 60;
    tower.emit("Office on 12 is now open for business.", "good");
    tower.emit("Condo on 14 sold for $80,000.", "money");
    pump(ui, tower);
    expect(log.childElementCount).toBe(HudTower.LOG_KEEP); // the two oldest went
    expect(log.scrollTop).toBe(100);
  });
});
