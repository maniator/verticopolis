import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../analytics", () => ({ trackAppAction: vi.fn(), trackAppActionOnce: vi.fn() }));

import { trackAppAction, trackAppActionOnce } from "../../analytics";
import { DESK_MINIMIZED_CLASS } from "./deskWindow";
import { DESK_ANY_SCREEN, DESK_ANY_SCREEN_MQ, DESK_CLASS, DESK_KEY, DESK_MQ, DeskController, deskActive, wireDesk } from "./deskController";

/** The page the desk works on: the game's own elements, in their usual places. */
const PAGE = `
  <div id="app">
    <div id="topbar">Info</div>
    <nav id="menubar"><button id="mb-options">Options</button><div id="mb-window-menu"><button id="mb-dw-info" data-desk-win="info">Info</button><button id="mb-dw-map" data-desk-win="map">Map</button></div><button id="mb-win-map">Map</button><button id="mb-win-statusbar">Status Bar</button><button id="mb-fullscreen">Full Screen</button><button id="mb-close">Close</button><button id="mb-sound" aria-checked="true">Sound</button></nav>
    <div id="stage">tower</div>
    <div id="statusbar">status</div>
    <aside id="palette" class="win"><div class="win-title">Tools</div></aside>
    <section id="overview-map" class="win"><div class="win-title">Map<button class="btn xs overview-map-close">x</button></div></section>
    <section id="bulletin-win" class="win"><div class="win-title">Bulletin<button class="btn xs" data-close="bulletin-win">x</button></div></section>
    <section id="tower-win" class="win" hidden><div class="win-title">Tower Info<button class="btn xs" data-close="tower-win">x</button></div></section>
  </div>`;

/** Which media queries match: a computer, a narrower screen, or neither. */
let matching = new Set<string>();
const listeners = new Map<string, Array<() => void>>();

function screen(...queries: string[]): void {
  matching = new Set(queries);
}

function fireMediaChange(): void {
  for (const fns of listeners.values()) for (const fn of fns) fn();
}

/** The page under test. Each test gets a fresh document, so the observers of
 *  an earlier test's desk never hear this one. */
let doc: Document;

/** A fresh page at `url`, with the game's elements in their usual places. */
function page(url = "http://localhost/"): Document {
  const d = document.implementation.createHTMLDocument("Verticopolis");
  d.body.innerHTML = PAGE;
  Object.defineProperty(d, "location", { value: new URL(url) });
  return d;
}

/** Where each of the game's elements sits: its parent's id. */
function places(): Record<string, string | undefined> {
  const ids = ["topbar", "menubar", "stage", "statusbar", "palette", "overview-map", "bulletin-win", "tower-win"];
  return Object.fromEntries(ids.map((id) => [id, doc.getElementById(id)?.parentElement?.id]));
}

beforeEach(() => {
  doc = page();
  localStorage.clear();
  listeners.clear();
  screen(DESK_MQ, DESK_ANY_SCREEN_MQ);
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      get matches() {
        return matching.has(query);
      },
      addEventListener: (_: string, fn: () => void) => listeners.set(query, [...(listeners.get(query) ?? []), fn]),
    })),
  );
  vi.mocked(trackAppAction).mockClear();
  vi.mocked(trackAppActionOnce).mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("DeskController", () => {
  it("asks for the computer's media query", () => {
    new DeskController(doc).start();
    expect(window.matchMedia).toHaveBeenCalledWith(DESK_MQ);
  });

  it("puts the game's elements into windows on a computer, with a taskbar button for each open window", () => {
    new DeskController(doc).start();
    expect(doc.body.classList.contains(DESK_CLASS)).toBe(true);
    const tower = doc.querySelector("#desk-win-tower .desk-body")!;
    expect([...tower.children].map((e) => e.id)).toEqual(["menubar", "stage", "statusbar"]);
    expect(doc.getElementById("topbar")!.parentElement!.closest("#desk-win-info")).not.toBeNull();
    for (const id of ["palette", "overview-map", "bulletin-win", "tower-win"]) expect(doc.getElementById(id)!.parentElement!.id).toBe("desk");
    const tasks = [...doc.querySelectorAll<HTMLElement>(".desk-task")].map((b) => b.dataset.win);
    // Tower Info is closed, and so is the Control Panel.
    expect(tasks).toEqual(["tower", "info", "tools", "map", "bulletin"]);
    expect(trackAppActionOnce).toHaveBeenCalledWith("desk_shown");
  });

  it("stays off after ?desk=off, the testing switch (there is no player switch)", () => {
    localStorage.setItem(DESK_KEY.enabled, "off");
    new DeskController(doc).start();
    expect(doc.body.classList.contains(DESK_CLASS)).toBe(false);
  });

  it("never comes up on a phone", () => {
    screen();
    const before = places();
    new DeskController(doc).start();
    expect(doc.body.classList.contains(DESK_CLASS)).toBe(false);
    expect(places()).toEqual(before);
  });

  it("goes away when the screen stops fitting, putting every element back in order, and comes back when it fits again", () => {
    const before = places();
    const order = [...doc.getElementById("app")!.children].map((e) => e.id);
    new DeskController(doc).start();
    screen();
    fireMediaChange();
    expect(doc.body.classList.contains(DESK_CLASS)).toBe(false);
    expect(places()).toEqual(before);
    expect([...doc.getElementById("app")!.children].map((e) => e.id)).toEqual(order);
    expect(doc.getElementById("desk")).toBeNull();
    expect(doc.getElementById("desk-taskbar")).toBeNull();
    screen(DESK_MQ, DESK_ANY_SCREEN_MQ);
    fireMediaChange();
    expect(doc.body.classList.contains(DESK_CLASS)).toBe(true);
  });

  it("shows the title screen in its own window, and opens the desk when the title screen goes", async () => {
    doc.body.classList.add("splash-up");
    new DeskController(doc).start();
    expect(doc.body.classList.contains(DESK_CLASS)).toBe(false);
    expect(doc.body.classList.contains("desk-title")).toBe(true);
    expect(doc.querySelector(".desk-title-bar")).not.toBeNull();
    doc.body.classList.remove("splash-up");
    // The body's class is heard through a MutationObserver.
    await Promise.resolve();
    expect(doc.body.classList.contains(DESK_CLASS)).toBe(true);
    expect(doc.body.classList.contains("desk-title")).toBe(false);
    expect(doc.querySelector(".desk-title-bar")).toBeNull();
  });

  it("?desk=on brings the desk to a screen narrower than a computer's, and ?desk=off turns it off", () => {
    screen(DESK_ANY_SCREEN_MQ);
    doc = page("http://localhost/?desk=on");
    new DeskController(doc).start();
    expect(localStorage.getItem(DESK_KEY.enabled)).toBe(DESK_ANY_SCREEN);
    expect(doc.body.classList.contains(DESK_CLASS)).toBe(true);
    doc = page("http://localhost/?desk=off");
    new DeskController(doc).start();
    expect(localStorage.getItem(DESK_KEY.enabled)).toBe("off");
    expect(doc.body.classList.contains(DESK_CLASS)).toBe(false);
  });

  it("?desk=on still leaves an upright phone its own layout", () => {
    screen();
    doc = page("http://localhost/?desk=on");
    new DeskController(doc).start();
    expect(doc.body.classList.contains(DESK_CLASS)).toBe(false);
  });

  it("minimizes a window to the taskbar and brings it back from its button", () => {
    new DeskController(doc).start();
    const map = doc.getElementById("overview-map")!;
    map.querySelector<HTMLElement>(".desk-btn-min")!.click();
    expect(map.classList.contains(DESK_MINIMIZED_CLASS)).toBe(true);
    const button = doc.querySelector<HTMLElement>('.desk-task[data-win="map"]')!;
    expect(button.getAttribute("aria-pressed")).toBe("false");
    button.click();
    expect(map.classList.contains(DESK_MINIMIZED_CLASS)).toBe(false);
    expect(doc.querySelector('.desk-task[data-win="map"]')!.getAttribute("aria-pressed")).toBe("true");
    expect(trackAppAction).toHaveBeenCalledWith("desk_window", "map_min");
  });

  it("never closes Info or Tools, and the Window menu brings any window up, closed or minimized", async () => {
    new DeskController(doc).start();
    expect(doc.querySelector("#desk-win-info .desk-btn-close")).toBeNull();
    expect(doc.querySelector("#palette .desk-btn-close")).toBeNull();
    const map = doc.getElementById("overview-map")!;
    // The game's Map item opens the Map the game's way.
    doc.getElementById("mb-win-map")!.addEventListener("click", () => (map.hidden = false));
    map.hidden = true;
    await Promise.resolve();
    expect(doc.getElementById("mb-dw-map")!.getAttribute("aria-checked")).toBe("false");
    doc.getElementById("mb-dw-map")!.click();
    expect(map.hidden).toBe(false);
    expect(doc.querySelector('.desk-task[data-win="map"]')!.getAttribute("aria-pressed")).toBe("true");
    const info = doc.getElementById("desk-win-info")!;
    info.querySelector<HTMLElement>(".desk-btn-min")!.click();
    expect(info.classList.contains(DESK_MINIMIZED_CLASS)).toBe(true);
    doc.getElementById("mb-dw-info")!.click();
    expect(info.classList.contains(DESK_MINIMIZED_CLASS)).toBe(false);
    expect(doc.getElementById("mb-dw-info")!.getAttribute("aria-checked")).toBe("true");
  });

  it("moves Status Bar and Full Screen into the Window menu while it is up, and back after", () => {
    const desk = new DeskController(doc);
    desk.start();
    const parents = () => ["mb-win-statusbar", "mb-fullscreen"].map((id) => doc.getElementById(id)!.parentElement!.id);
    expect(parents()).toEqual(["mb-window-menu", "mb-window-menu"]);
    screen();
    fireMediaChange();
    expect(parents()).toEqual(["menubar", "menubar"]);
  });

  it("stacks the tower like any window, but keeps a maximized tower under the small windows", () => {
    new DeskController(doc).start();
    const tower = doc.getElementById("desk-win-tower")!;
    const map = doc.getElementById("overview-map")!;
    const z = (el: HTMLElement) => Number(el.style.zIndex);
    map.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(z(map)).toBeGreaterThan(z(tower));
    tower.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(z(tower)).toBeGreaterThan(z(map));
    // Only the window pressed last wears the lit title bar.
    expect([...doc.querySelectorAll(".desk-active")].map((e) => e.id)).toEqual(["desk-win-tower"]);
    tower.querySelector<HTMLElement>(".desk-btn-max")!.click();
    expect(z(tower)).toBeLessThan(z(map));
    expect(tower.classList.contains("desk-active")).toBe(true);
    tower.querySelector<HTMLElement>(".desk-btn-max")!.click();
    expect(z(tower)).toBeGreaterThan(z(map));
  });

  it("opens a window's menu from its taskbar button and its title bar, and runs its commands", () => {
    new DeskController(doc).start();
    const map = doc.getElementById("overview-map")!;
    const menu = doc.querySelector<HTMLElement>(".desk-win-menu")!;
    const item = (c: string) => menu.querySelector<HTMLButtonElement>(`[data-command="${c}"]`)!;
    const right = (el: Element) => el.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 50, clientY: 60 }));
    expect(right(doc.querySelector('.desk-task[data-win="map"]')!)).toBe(false);
    expect(menu.hidden).toBe(false);
    expect([item("restore").disabled, item("minimize").disabled, item("maximize").disabled, item("close").disabled]).toEqual([false, false, true, false]);
    item("minimize").click();
    expect(map.classList.contains(DESK_MINIMIZED_CLASS)).toBe(true);
    expect(menu.hidden).toBe(true);
    // Info never closes; the tower maximizes from its title bar's menu.
    right(doc.querySelector("#desk-win-info > .win-title")!);
    expect(item("close").disabled).toBe(true);
    menu.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(menu.hidden).toBe(true);
    right(doc.querySelector("#desk-win-tower > .win-title")!);
    item("maximize").click();
    expect(doc.getElementById("desk-win-tower")!.classList.contains("desk-maximized")).toBe(true);
  });

  it("closes a window from its menu with the game's own close button, and opens the menu from the keyboard", () => {
    new DeskController(doc).start();
    const menu = doc.querySelector<HTMLElement>(".desk-win-menu")!;
    const item = (c: string) => menu.querySelector<HTMLButtonElement>(`[data-command="${c}"]`)!;
    const right = (el: Element) => el.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 50, clientY: 60 }));
    for (const [win, button] of [
      ["overview-map", ".overview-map-close"],
      ["bulletin-win", '[data-close="bulletin-win"]'],
      ["tower-win", '[data-close="tower-win"]'],
    ] as const) {
      const closed = vi.fn();
      doc.querySelector(`#${win} ${button}`)!.addEventListener("click", closed);
      right(doc.querySelector(`#${win} > .win-title`)!);
      expect(item("close").disabled).toBe(false);
      item("close").click();
      expect(closed).toHaveBeenCalledOnce();
    }
    // The Control Panel closes from its menu and from its own ✕.
    doc.querySelector<HTMLElement>(".desk-tray-display")!.click();
    const panel = doc.getElementById("desk-win-control")!;
    expect(panel.hidden).toBe(false);
    right(panel.querySelector(".win-title")!);
    item("close").click();
    expect(panel.hidden).toBe(true);
    doc.querySelector<HTMLElement>(".desk-tray-display")!.click();
    panel.querySelector<HTMLElement>(".desk-btn-close")!.click();
    expect(panel.hidden).toBe(true);
    // Shift+F10 on a taskbar button opens its menu; the arrow keys skip grayed items.
    const task = doc.querySelector<HTMLElement>('.desk-task[data-win="info"]')!;
    task.dispatchEvent(new KeyboardEvent("keydown", { key: "F10", shiftKey: true, bubbles: true, cancelable: true }));
    expect(menu.hidden).toBe(false);
    for (const key of ["ArrowDown", "ArrowDown", "ArrowUp"]) {
      menu.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
      expect(menu.contains(doc.activeElement) && !(doc.activeElement as HTMLButtonElement).disabled).toBe(true);
    }
    menu.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(menu.hidden).toBe(true);
    // A double-click on a window that cannot maximize leaves it at its size.
    const info = doc.getElementById("desk-win-info")!;
    info.querySelector(".win-title")!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(info.classList.contains("desk-maximized")).toBe(false);
  });

  it("opens the Control Panel from the tray, and its icons run the game's menu items", () => {
    new DeskController(doc).start();
    const panel = doc.getElementById("desk-win-control")!;
    expect(panel.hidden).toBe(true);
    doc.querySelector<HTMLElement>(".desk-tray-display")!.click();
    expect(panel.hidden).toBe(false);
    expect(doc.querySelector('.desk-task[data-win="control"]')).not.toBeNull();
    const sound = vi.fn();
    doc.getElementById("mb-sound")!.addEventListener("click", sound);
    panel.querySelector<HTMLElement>('[data-control="sounds"]')!.click();
    expect(sound).toHaveBeenCalledTimes(1);
    expect(trackAppAction).toHaveBeenCalledWith("desk_control", "sounds");
  });

  it("starts once per page, and says whether the desk is up", () => {
    expect(deskActive(doc)).toBe(false);
    expect(wireDesk(doc)).toBeInstanceOf(DeskController);
    expect(wireDesk(doc)).toBeNull();
    expect(deskActive(doc)).toBe(true);
  });

  it("closes the tower the game's own way, from its title-bar button", () => {
    new DeskController(doc).start();
    const close = vi.fn();
    doc.getElementById("mb-close")!.addEventListener("click", close);
    doc.querySelector<HTMLElement>("#desk-win-tower .desk-btn-close")!.click();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("opens a Tools window folded off the desk", () => {
    const palette = doc.getElementById("palette")!;
    palette.classList.add("pal-collapsed");
    const toggle = doc.createElement("button");
    toggle.id = "btn-palette-collapse";
    toggle.addEventListener("click", () => palette.classList.remove("pal-collapsed"));
    doc.body.appendChild(toggle);
    new DeskController(doc).start();
    expect(palette.classList.contains("pal-collapsed")).toBe(false);
  });

  it("brings a window to the front when it is pressed, and runs a Verticopolis menu item", () => {
    new DeskController(doc).start();
    const mapButton = () => doc.querySelector('.desk-task[data-win="map"]')!;
    expect(mapButton().getAttribute("aria-pressed")).toBe("false");
    doc.getElementById("overview-map")!.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(mapButton().getAttribute("aria-pressed")).toBe("true");
    const about = vi.fn();
    const item = doc.createElement("button");
    item.id = "btn-about";
    item.addEventListener("click", about);
    doc.body.appendChild(item);
    doc.querySelector<HTMLElement>('.desk-start-menu [data-item="btn-about"]')!.click();
    expect(about).toHaveBeenCalledTimes(1);
    expect(trackAppAction).toHaveBeenCalledWith("desk_start", "btn-about");
  });

  it("keeps the small windows off a maximized tower's menu bar, puts them back on restore, and remembers the maximize", () => {
    new DeskController(doc).start();
    const max = doc.querySelector<HTMLElement>("#desk-win-tower .desk-btn-max")!;
    // The menu bar's foot sits 40 px down the desk; the Map starts above it.
    doc.getElementById("menubar")!.getBoundingClientRect = () => ({ bottom: 40 }) as DOMRect;
    max.click();
    expect(localStorage.getItem(DESK_KEY.max)).toBe("tower");
    expect(localStorage.getItem(DESK_KEY.layout)).toBeNull();
    expect(trackAppAction).toHaveBeenCalledWith("desk_window", "tower_max");
    max.click();
    expect(localStorage.getItem(DESK_KEY.max)).toBe("");
    // The windows it stepped down went back up, and the desk kept their places.
    expect(Object.keys(JSON.parse(localStorage.getItem(DESK_KEY.layout)!))).toEqual(expect.arrayContaining(["map", "bulletin", "info"]));
  });

  it("shows a sound toggled from the Control Panel on the tray and the Sounds icon, with no menu opened", async () => {
    new DeskController(doc).start();
    const sound = doc.getElementById("mb-sound")!;
    // The game's Sound item flips its own check, as menuWiring does.
    sound.addEventListener("click", () => sound.setAttribute("aria-checked", String(sound.getAttribute("aria-checked") === "false")));
    const icon = doc.querySelector<HTMLElement>('#desk-win-control [data-control="sounds"]')!;
    expect(icon.textContent).toBe("Sounds: On");
    icon.click();
    await Promise.resolve();
    expect(doc.querySelector(".desk-tray-sound")!.classList.contains("muted")).toBe(true);
    expect(icon.textContent).toBe("Sounds: Off");
  });
});
