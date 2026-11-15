import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GameApp } from "../main";

const map = vi.hoisted(() => ({ open: false, set: vi.fn() }));
const importer = vi.hoisted(() => ({ openImport: vi.fn() }));
const store = vi.hoisted(() => new Map<string, string>());
const movable = vi.hoisted(() => vi.fn());
const sponsor = vi.hoisted(() => ({ offered: true, track: vi.fn() }));
const closer = vi.hoisted(() => ({ closeTower: vi.fn() }));

vi.mock("./overviewMapWiring", () => ({
  overviewMapOpen: () => map.open,
  setOverviewMapOpen: map.set,
}));
vi.mock("../ui/uiImport", () => importer);
vi.mock("./titleScreen", () => closer);
vi.mock("../ui/movableWindow", () => ({ MovableWindow: movable }));
vi.mock("../ui/splashTemplate", () => ({ SPONSOR_URL: "https://sponsor.example/", sponsorOffered: () => sponsor.offered }));
vi.mock("../analytics", () => ({ trackAppAction: sponsor.track }));
const menus = vi.hoisted(() => ({ open: vi.fn(), pick: vi.fn(), dismiss: vi.fn() }));
vi.mock("../analyticsMenus", async (real) => ({
  ...(await real<typeof import("../analyticsMenus")>()),
  trackMenuOpen: menus.open,
  trackMenuPick: menus.pick,
  trackMenuDismiss: menus.dismiss,
}));
vi.mock("../ui/overviewMapPrefs", () => ({
  browserStorage: () => ({
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  }),
}));

import { MENU_WINDOW, NO_FULL_SCREEN, STATUS_BAR_HIDDEN_CLASS, STATUS_BAR_KEY, toggleFullScreen, wireMenus } from "./menuWiring";

/** The menu bar's items as index.html has them, plus the windows and the
 *  toolbar twins the wiring reaches. */
function mount(): void {
  const item = (id: string, role = "menuitem") => `<button class="mb-item" id="${id}" role="${role}">${id}</button>`;
  document.body.innerHTML = `
    <nav id="menubar">
      <div class="mb-menu">
        <button class="mb-title" id="mb-file" aria-expanded="false" aria-controls="mb-file-menu"><u>F</u>ile</button>
        <div class="mb-pop" id="mb-file-menu" role="menu" hidden>
          ${item("mb-quick-save")}${item("mb-close")}${item("mb-import")}${item("mb-export")}${item("mb-undo")}${item("mb-redo")}
          ${item("mb-rename")}${item("mb-rules")}${item("mb-compare")}${item("mb-replay")}
          ${item("mb-win-tools", "menuitemcheckbox")}${item("mb-win-map", "menuitemcheckbox")}
          ${item("mb-win-tower", "menuitemcheckbox")}${item("mb-win-bulletin", "menuitemcheckbox")}
          ${item("mb-win-statusbar", "menuitemcheckbox")}${item("mb-fullscreen", "menuitemcheckbox")}
          ${item("mb-sound", "menuitemcheckbox")}
          <a class="mb-item" id="mb-sponsor" hidden>Sponsor</a>
          ${item("btn-new")}${item("btn-stats")}
          <hr class="mb-sep mb-install-sep" hidden /><button class="mb-item" id="btn-install-menu" hidden>Install</button>
        </div>
      </div>
    </nav>
    <div id="palette"></div>
    <button id="btn-palette-collapse"></button>
    <main id="stage">
      <section id="tower-win" hidden><button data-close="tower-win">x</button></section>
      <section id="bulletin-win" hidden><button data-close="bulletin-win">x</button></section>
    </main>
    <input id="tower-name" />
    <button id="btn-undo" aria-disabled="true"></button>
    <button id="btn-redo"></button>`;
}

function fakeApp(onPhone = false) {
  const ui = {
    cb: { onSave: vi.fn(), onToggleAudio: vi.fn(), isMuted: vi.fn(() => false), onReplayOnboarding: vi.fn() },
    el: {
      undo: document.getElementById("btn-undo"),
      redo: document.getElementById("btn-redo"),
      towerName: document.getElementById("tower-name") as HTMLInputElement,
    },
    promptExport: vi.fn(),
    showCompare: vi.fn(),
    showTowerRules: vi.fn(),
    sayVisibly: vi.fn(),
  };
  return { app: { ui, mobileMq: { matches: onPhone } } as unknown as GameApp, ui };
}

const $ = (id: string) => document.getElementById(id) as HTMLElement;
const checked = (id: string) => $(id).getAttribute("aria-checked");

beforeEach(() => {
  store.clear();
  map.open = false;
  sponsor.offered = true;
  vi.clearAllMocks();
  document.body.className = "";
  mount();
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("wireMenus", () => {
  it("wires the page once: a second call, or a page without the bar, does nothing", () => {
    const { app } = fakeApp();
    expect(wireMenus(app)).not.toBeNull();
    expect(wireMenus(app)).toBeNull();
    document.body.innerHTML = "";
    expect(wireMenus(app)).toBeNull();
  });

  it("routes File, Edit, Tower, Options and Help items to the game", () => {
    const { app, ui } = fakeApp();
    const undo = vi.fn();
    $("btn-undo").addEventListener("click", undo);
    wireMenus(app);
    $("mb-quick-save").click();
    $("mb-close").click();
    $("mb-import").click();
    $("mb-export").click();
    $("mb-undo").click();
    $("mb-rules").click();
    $("mb-compare").click();
    $("mb-sound").click();
    $("mb-replay").click();
    expect(ui.cb.onSave).toHaveBeenCalledOnce();
    expect(closer.closeTower).toHaveBeenCalledWith(app);
    expect(importer.openImport).toHaveBeenCalledWith(ui);
    expect(ui.promptExport).toHaveBeenCalledOnce();
    expect(undo).toHaveBeenCalledOnce(); // the toolbar's own button, so its rules hold
    expect(ui.showTowerRules).toHaveBeenCalledOnce(); // this tower's column, not the whole comparison
    expect(ui.showCompare).toHaveBeenCalledOnce();
    expect(ui.cb.onToggleAudio).toHaveBeenCalledOnce();
    expect(ui.cb.onReplayOnboarding).toHaveBeenCalledOnce();
  });

  it("on a desktop Tower Info starts closed and the Bulletin open; both move within the stage, toggle and remember", () => {
    const { app } = fakeApp();
    wireMenus(app);
    expect($("tower-win").hidden).toBe(true);
    expect($("bulletin-win").hidden).toBe(false);
    expect(movable).toHaveBeenCalledWith(expect.objectContaining({ win: $("tower-win"), within: $("stage") }));
    $("mb-win-tower").click();
    expect($("tower-win").hidden).toBe(false);
    expect(store.get(MENU_WINDOW.tower.key)).toBe("open");
    $("tower-win").querySelector<HTMLElement>("[data-close]")!.click();
    expect($("tower-win").hidden).toBe(true);
    expect(store.get(MENU_WINDOW.tower.key)).toBe("closed");
  });

  it("a phone starts both windows closed", () => {
    wireMenus(fakeApp(true).app);
    expect($("tower-win").hidden).toBe(true);
    expect($("bulletin-win").hidden).toBe(true);
  });

  it("a Bulletin the player closed stays closed on a desktop", () => {
    store.set(MENU_WINDOW.bulletin.key, "closed");
    wireMenus(fakeApp().app);
    expect($("bulletin-win").hidden).toBe(true);
  });

  it("a window the player left open opens again on the next visit", () => {
    store.set(MENU_WINDOW.bulletin.key, "open");
    wireMenus(fakeApp().app);
    expect($("bulletin-win").hidden).toBe(false);
    expect($("tower-win").hidden).toBe(true);
  });

  it("Rename opens Tower Info and selects the name", () => {
    wireMenus(fakeApp().app);
    $("mb-rename").click();
    expect($("tower-win").hidden).toBe(false);
    expect(document.activeElement).toBe($("tower-name"));
  });

  it("the status bar shows by default, hides from the menu, and remembers", () => {
    wireMenus(fakeApp().app);
    expect(document.body.classList.contains(STATUS_BAR_HIDDEN_CLASS)).toBe(false);
    $("mb-win-statusbar").click();
    expect(document.body.classList.contains(STATUS_BAR_HIDDEN_CLASS)).toBe(true);
    expect(store.get(STATUS_BAR_KEY)).toBe("closed");
    document.body.className = "";
    mount();
    wireMenus(fakeApp().app);
    expect(document.body.classList.contains(STATUS_BAR_HIDDEN_CLASS)).toBe(true);
  });

  it("Tools clicks the palette's fold, and Map flips the Map window", () => {
    const fold = vi.fn();
    $("btn-palette-collapse").addEventListener("click", fold);
    wireMenus(fakeApp().app);
    $("mb-win-tools").click();
    expect(fold).toHaveBeenCalledOnce();
    map.open = true;
    $("mb-win-map").click();
    expect(map.set).toHaveBeenCalledWith(expect.anything(), false);
  });

  it("opening a menu refreshes its check marks and grays Undo like the toolbar", () => {
    const { app, ui } = fakeApp();
    ui.cb.isMuted.mockReturnValue(true);
    map.open = true;
    $("palette").classList.add("pal-collapsed");
    const bar = wireMenus(app)!;
    $("mb-win-bulletin").click(); // closes the Bulletin a desktop starts open
    bar.open($("mb-file") as HTMLButtonElement, false);
    expect(checked("mb-win-tools")).toBe("false");
    expect(checked("mb-win-map")).toBe("true");
    expect(checked("mb-win-tower")).toBe("false");
    expect(checked("mb-win-bulletin")).toBe("false");
    expect(checked("mb-win-statusbar")).toBe("true");
    expect(checked("mb-fullscreen")).toBe("false");
    expect(checked("mb-sound")).toBe("false");
    expect($("mb-undo").getAttribute("aria-disabled")).toBe("true");
    expect($("mb-redo").hasAttribute("aria-disabled")).toBe(false);
  });

  it("Close grays out once the game stopped on its engine, and comes back with a live tower", () => {
    const { app } = fakeApp();
    const bar = wireMenus(app)!;
    document.body.insertAdjacentHTML("beforeend", '<div id="engine-failure"></div>');
    bar.open($("mb-file") as HTMLButtonElement, false);
    expect($("mb-close").getAttribute("aria-disabled")).toBe("true");
    bar.close(false);
    $("engine-failure").remove();
    bar.open($("mb-file") as HTMLButtonElement, false);
    expect($("mb-close").hasAttribute("aria-disabled")).toBe(false);
  });

  it("Sponsor links to the tip jar and counts a tap from the menu; the Android app leaves it out", () => {
    wireMenus(fakeApp().app);
    const link = $("mb-sponsor") as HTMLAnchorElement;
    expect(link.hidden).toBe(false);
    expect(link.href).toBe("https://sponsor.example/");
    link.addEventListener("click", (e) => e.preventDefault()); // no navigation in the test page
    link.click();
    expect(sponsor.track).toHaveBeenCalledWith("sponsor_click", "menu");
    sponsor.offered = false;
    mount();
    wireMenus(fakeApp().app);
    expect($("mb-sponsor").hidden).toBe(true);
    expect($("mb-sponsor").hasAttribute("href")).toBe(false);
  });

  it("on the title screen, tower commands gray out and do nothing, and New Tower presses the title screen's own button", () => {
    const { app, ui } = fakeApp();
    const bar = wireMenus(app)!;
    const splashNew = vi.fn();
    const stats = vi.fn();
    const splash = document.createElement("div");
    splash.id = "splash";
    splash.innerHTML = `<button data-splash="new"></button>`;
    document.body.append(splash);
    splash.querySelector("button")!.addEventListener("click", splashNew);
    $("btn-stats").addEventListener("click", stats);
    const gameNew = vi.fn();
    $("btn-new").addEventListener("click", gameNew);
    bar.open($("mb-file") as HTMLButtonElement, false);
    for (const id of ["mb-quick-save", "mb-close", "mb-export", "btn-stats", "mb-win-tower", "mb-replay"]) expect($(id).getAttribute("aria-disabled"), id).toBe("true");
    $("btn-stats").click();
    $("mb-quick-save").click();
    expect(stats).not.toHaveBeenCalled();
    expect(ui.cb.onSave).not.toHaveBeenCalled();
    $("btn-new").click();
    expect(splashNew).toHaveBeenCalledOnce();
    expect(gameNew).not.toHaveBeenCalled(); // the title screen leaves its own way
    expect(bar.current()).toBeNull();
    // Once the title screen is gone, the commands come back, even when its
    // body class stays behind (a harness that removes the element).
    document.body.classList.add("splash-up");
    splash.remove();
    bar.open($("mb-file") as HTMLButtonElement, false);
    expect($("btn-stats").hasAttribute("aria-disabled")).toBe(false);
    $("btn-new").click();
    expect(gameNew).toHaveBeenCalledOnce();
    document.body.classList.remove("splash-up");
  });

  it("on the title screen, an item whose title-screen button is missing runs its own command", () => {
    const { app } = fakeApp();
    const bar = wireMenus(app)!;
    const splash = document.createElement("div");
    splash.id = "splash";
    document.body.append(splash);
    const gameNew = vi.fn();
    $("btn-new").addEventListener("click", gameNew);
    bar.open($("mb-file") as HTMLButtonElement, false);
    $("btn-new").click();
    expect(gameNew).toHaveBeenCalledOnce();
    splash.remove();
  });

  it("on the title screen, Import opens the file chooser at once instead of the Load Tower picker", () => {
    const { app, ui } = fakeApp();
    const bar = wireMenus(app)!;
    importer.openImport.mockClear();
    const splashLoad = vi.fn();
    const splash = document.createElement("div");
    splash.id = "splash";
    splash.innerHTML = `<button data-splash="load"></button>`;
    document.body.append(splash);
    splash.querySelector("button")!.addEventListener("click", splashLoad);
    bar.open($("mb-file") as HTMLButtonElement, false);
    $("mb-import").click();
    expect(importer.openImport).toHaveBeenCalledExactlyOnceWith(ui);
    expect(splashLoad).not.toHaveBeenCalled();
    splash.remove();
  });

  it("Install app's separator shows only while the install item does", () => {
    const bar = wireMenus(fakeApp().app)!;
    const sep = document.querySelector<HTMLElement>(".mb-install-sep")!;
    bar.open($("mb-file") as HTMLButtonElement, false);
    expect(sep.hidden).toBe(true);
    bar.close();
    $("btn-install-menu").hidden = false;
    bar.open($("mb-file") as HTMLButtonElement, false);
    expect(sep.hidden).toBe(false);
  });
});

describe("wireMenus analytics", () => {
  const pointerClick = (el: HTMLElement) => el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));

  it("a trip sends menu_open, then one menu_pick naming the item, its menu, the menus shown and how", () => {
    const bar = wireMenus(fakeApp().app)!;
    pointerClick($("mb-file"));
    expect(menus.open).toHaveBeenCalledExactlyOnceWith({ menu: "file", via: "click", screen: "tower" });
    pointerClick($("mb-quick-save"));
    expect(menus.pick).toHaveBeenCalledExactlyOnceWith({ menu: "file", item: "quick_save", via: "pointer", screen: "tower", browsed: 1, grayed: false });
    expect(bar.current()).toBeNull();
    expect(menus.dismiss).not.toHaveBeenCalled();
  });

  it("a keyboard pick says keys, and a checkmark item reports the state it flips to", () => {
    const bar = wireMenus(fakeApp().app)!;
    bar.open($("mb-file") as HTMLButtonElement, true, "keys");
    $("mb-win-bulletin").click(); // Enter on a focused item: a click with no pointer
    expect(menus.pick).toHaveBeenLastCalledWith(expect.objectContaining({ item: "bulletin", via: "keys", state: "off" }));
    bar.open($("mb-file") as HTMLButtonElement, false);
    pointerClick($("mb-win-bulletin"));
    expect(menus.pick).toHaveBeenLastCalledWith(expect.objectContaining({ item: "bulletin", via: "pointer", state: "on" }));
  });

  it("a grayed item reports a grayed pick with no state, and the menu stays open", () => {
    const bar = wireMenus(fakeApp().app)!; // the toolbar's Undo is grayed
    pointerClick($("mb-file"));
    pointerClick($("mb-undo"));
    expect(menus.pick).toHaveBeenCalledExactlyOnceWith({ menu: "file", item: "undo", via: "pointer", screen: "tower", browsed: 1, grayed: true });
    expect(bar.current()).toBe($("mb-file"));
    bar.close(true, "escape");
    expect(menus.dismiss).toHaveBeenCalledExactlyOnceWith({ menu: "file", how: "escape", screen: "tower", browsed: 1 });
  });

  it("a click with no menu open (a script's) is not a pick", () => {
    wireMenus(fakeApp().app);
    $("mb-quick-save").click();
    expect(menus.pick).not.toHaveBeenCalled();
  });

  it("on the title screen the events say so, and a routed item still counts as its pick", () => {
    const bar = wireMenus(fakeApp().app)!;
    const splash = document.createElement("div");
    splash.id = "splash";
    splash.innerHTML = `<button data-splash="new"></button>`;
    document.body.append(splash);
    pointerClick($("mb-file"));
    expect(menus.open).toHaveBeenLastCalledWith({ menu: "file", via: "click", screen: "title" });
    pointerClick($("btn-new"));
    expect(menus.pick).toHaveBeenLastCalledWith(expect.objectContaining({ item: "new_tower", screen: "title", grayed: false }));
    expect(bar.current()).toBeNull();
    splash.remove();
  });

  it("a window's close button sends window_close, and its first move window_move, once", () => {
    wireMenus(fakeApp().app);
    const bulletin = movable.mock.calls.find(([o]) => o.win === $("bulletin-win"))![0] as { placed: (s: unknown) => void };
    bulletin.placed({ x: 1, y: 2 });
    bulletin.placed({ x: 3, y: 4 });
    expect(sponsor.track.mock.calls.filter(([a]) => a === "window_move")).toEqual([["window_move", "bulletin"]]);
    $("bulletin-win").querySelector<HTMLElement>("[data-close]")!.click();
    expect(sponsor.track).toHaveBeenCalledWith("window_close", "bulletin");
  });
});

describe("toggleFullScreen", () => {
  function doc(over: Partial<{ fullscreenElement: Element | null; fullscreenEnabled: boolean; request: unknown; exit: () => Promise<void> }>) {
    return {
      fullscreenElement: over.fullscreenElement ?? null,
      fullscreenEnabled: over.fullscreenEnabled ?? true,
      exitFullscreen: over.exit ?? vi.fn(() => Promise.resolve()),
      documentElement: { requestFullscreen: over.request },
    } as unknown as Document;
  }

  it("asks the page to fill the screen", () => {
    const request = vi.fn(() => Promise.resolve());
    const ui = { sayVisibly: vi.fn() };
    toggleFullScreen(ui, doc({ request }));
    expect(request).toHaveBeenCalledOnce();
    expect(ui.sayVisibly).not.toHaveBeenCalled();
  });

  it("leaves full screen when already there", () => {
    const exit = vi.fn(() => Promise.resolve());
    const request = vi.fn();
    toggleFullScreen({ sayVisibly: vi.fn() }, doc({ fullscreenElement: document.body, exit, request }));
    expect(exit).toHaveBeenCalledOnce();
    expect(request).not.toHaveBeenCalled();
  });

  it("explains Add to Home Screen where a page cannot fill the screen", () => {
    const ui = { sayVisibly: vi.fn() };
    toggleFullScreen(ui, doc({ fullscreenEnabled: false, request: vi.fn() }));
    toggleFullScreen(ui, doc({ request: undefined }));
    expect(ui.sayVisibly).toHaveBeenCalledTimes(2);
    expect(ui.sayVisibly).toHaveBeenCalledWith(NO_FULL_SCREEN, "info");
  });

  it("explains it too when the browser refuses the request", async () => {
    const ui = { sayVisibly: vi.fn() };
    toggleFullScreen(ui, doc({ request: vi.fn(() => Promise.reject(new Error("denied"))) }));
    await Promise.resolve();
    await Promise.resolve();
    expect(ui.sayVisibly).toHaveBeenCalledWith(NO_FULL_SCREEN, "info");
  });
});
