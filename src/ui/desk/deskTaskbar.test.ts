import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONTROL_PANEL_ITEM, DeskTaskbar, START_ITEMS, trayClock, type TaskbarHandlers } from "./deskTaskbar";

describe("trayClock", () => {
  it("reads the time as the 1995 tray did, with a 12-hour clock", () => {
    expect(trayClock(new Date(2026, 10, 15, 16, 34))).toBe("4:34 PM");
    expect(trayClock(new Date(2026, 10, 15, 0, 5))).toBe("12:05 AM");
    expect(trayClock(new Date(2026, 10, 15, 12, 0))).toBe("12:00 PM");
    expect(trayClock(new Date(2026, 10, 15, 9, 7))).toBe("9:07 AM");
  });
});

describe("DeskTaskbar", () => {
  let handlers: { task: ReturnType<typeof vi.fn>; start: ReturnType<typeof vi.fn>; controlPanel?: ReturnType<typeof vi.fn> };
  let bar: DeskTaskbar;

  function make(withControl = true): DeskTaskbar {
    handlers = { task: vi.fn(), start: vi.fn(), ...(withControl ? { controlPanel: vi.fn() } : {}) };
    bar = new DeskTaskbar(document, handlers as unknown as TaskbarHandlers);
    document.body.appendChild(bar.root);
    bar.start();
    return bar;
  }

  const menu = () => document.getElementById("desk-start-menu")!;
  const startButton = () => document.querySelector<HTMLElement>(".desk-start")!;
  const items = () => [...menu().querySelectorAll<HTMLElement>(".mb-item")];

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 15, 16, 34, 30));
    document.body.innerHTML = `<button id="mb-sound" aria-checked="true"></button>`;
  });

  afterEach(() => {
    bar.stop();
    vi.useRealTimers();
  });

  it("lists every menu item, Control Panel included, and leaves Control Panel out without a handler", () => {
    make();
    const labels = START_ITEMS.filter((i) => i !== null).map((i) => i![0]);
    expect(items().map((b) => b.textContent)).toEqual(labels);
    expect(document.querySelector(".desk-tray-display")).not.toBeNull();
    bar.stop();
    bar.root.remove();
    make(false);
    expect(items().some((b) => b.dataset.item === CONTROL_PANEL_ITEM)).toBe(false);
    expect(document.querySelector(".desk-tray-display")).toBeNull();
  });

  it("opens the menu from its button, focusing the first item, and closes it on a second press", () => {
    make();
    startButton().click();
    expect(menu().hidden).toBe(false);
    expect(startButton().getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(items()[0]);
    startButton().click();
    expect(menu().hidden).toBe(true);
    expect(startButton().getAttribute("aria-expanded")).toBe("false");
  });

  it("moves through the menu with the arrow keys, wrapping at the ends", () => {
    make();
    startButton().click();
    const key = (k: string) => menu().dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
    key("ArrowDown");
    expect(document.activeElement).toBe(items()[1]);
    key("ArrowUp");
    key("ArrowUp");
    expect(document.activeElement).toBe(items()[items().length - 1]);
  });

  it("closes the menu on Escape, back on its button, and on a press outside it", () => {
    make();
    startButton().click();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(menu().hidden).toBe(true);
    expect(document.activeElement).toBe(startButton());
    startButton().click();
    items()[0].dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(menu().hidden).toBe(false);
    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(menu().hidden).toBe(true);
  });

  it("runs a picked item's game menu item, and opens the Control Panel from its item and the tray", () => {
    make();
    startButton().click();
    items().find((b) => b.dataset.item === "btn-settings")!.click();
    expect(handlers.start).toHaveBeenCalledWith("btn-settings");
    expect(menu().hidden).toBe(true);
    items().find((b) => b.dataset.item === CONTROL_PANEL_ITEM)!.click();
    expect(handlers.controlPanel).toHaveBeenCalledTimes(1);
    expect(handlers.start).toHaveBeenCalledWith(CONTROL_PANEL_ITEM);
    document.querySelector<HTMLElement>(".desk-tray-display")!.click();
    expect(handlers.controlPanel).toHaveBeenCalledTimes(2);
  });

  it("shows a button per window, pressed in for the front one, and rebuilds only on a change", () => {
    make();
    const entries = [
      { id: "tower", label: "Tower One - Verticopolis", active: true, minimized: false },
      { id: "map", label: "Map", active: false, minimized: true },
    ];
    bar.render(entries);
    const buttons = [...document.querySelectorAll<HTMLElement>(".desk-task")];
    expect(buttons.map((b) => b.dataset.win)).toEqual(["tower", "map"]);
    expect(buttons.map((b) => b.getAttribute("aria-pressed"))).toEqual(["true", "false"]);
    bar.render(entries.map((e) => ({ ...e })));
    expect(document.querySelector(".desk-task")).toBe(buttons[0]);
    buttons[1].click();
    expect(handlers.task).toHaveBeenCalledWith("map");
    bar.render([{ ...entries[0], active: false }]);
    expect(document.querySelectorAll(".desk-task")).toHaveLength(1);
    expect(document.querySelector(".desk-task")!.getAttribute("aria-pressed")).toBe("false");
  });

  it("mirrors Options > Sound on the speaker and clicks it from the tray", () => {
    make();
    const speaker = document.querySelector<HTMLElement>(".desk-tray-sound")!;
    expect(speaker.classList.contains("muted")).toBe(false);
    document.getElementById("mb-sound")!.setAttribute("aria-checked", "false");
    bar.syncSound();
    expect(speaker.classList.contains("muted")).toBe(true);
    expect(speaker.getAttribute("aria-label")).toMatch(/off/);
    const sound = vi.fn();
    document.getElementById("mb-sound")!.addEventListener("click", sound);
    speaker.click();
    expect(sound).toHaveBeenCalledTimes(1);
  });

  it("keeps the clock on the minute and stops it when the desk goes", () => {
    make();
    const clock = document.querySelector(".desk-tray-clock")!;
    expect(clock.textContent).toBe("4:34 PM");
    vi.advanceTimersByTime(31_000);
    expect(clock.textContent).toBe("4:35 PM");
    bar.stop();
    vi.advanceTimersByTime(120_000);
    expect(clock.textContent).toBe("4:35 PM");
  });
});
