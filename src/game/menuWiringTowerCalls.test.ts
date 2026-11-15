import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GameApp } from "../main";

const map = vi.hoisted(() => ({ open: false, set: vi.fn() }));
const files = vi.hoisted(() => ({ showOpenDialog: vi.fn(), showSaveAsDialog: vi.fn() }));
const store = vi.hoisted(() => new Map<string, string>());
const movable = vi.hoisted(() => vi.fn());
const sponsor = vi.hoisted(() => ({ offered: true, track: vi.fn() }));
const closer = vi.hoisted(() => ({ closeTower: vi.fn() }));
const calls = vi.hoisted(() => ({ towerCalls: vi.fn(), exterminate: vi.fn(), fire: vi.fn() }));
vi.mock("./towerCallItems", async (real) => ({
  ...(await real<typeof import("./towerCallItems")>()),
  towerCalls: calls.towerCalls,
}));
vi.mock("./appModals", () => ({ confirmExterminate: calls.exterminate }));
vi.mock("./fireRescueCall", () => ({ callFireRescue: calls.fire }));

vi.mock("./overviewMapWiring", () => ({
  overviewMapOpen: () => map.open,
  setOverviewMapOpen: map.set,
}));
vi.mock("./fileSpaceCommands", () => files);
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

import { wireMenus } from "./menuWiring";

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
          <hr class="mb-sep" id="mb-save-sep" /><hr class="mb-sep" id="mb-close-sep" />
        </div>
      </div>
      <div class="mb-menu">
        <button class="mb-title" id="mb-edit" aria-expanded="false" aria-controls="mb-edit-menu"><u>E</u>dit</button>
        <div class="mb-pop" id="mb-edit-menu" role="menu" hidden>${item("mb-edit-probe")}</div>
      </div>
      <div class="mb-menu">
        <button class="mb-title" id="mb-tower" aria-expanded="false" aria-controls="mb-tower-menu"><u>T</u>ower</button>
        <div class="mb-pop" id="mb-tower-menu" role="menu" hidden>
          ${item("mb-fire-rescue")}<button class="mb-item" id="mb-exterminator" role="menuitem" hidden>Call Exterminator</button>
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

beforeEach(() => {
  store.clear();
  map.open = false;
  sponsor.offered = true;
  vi.clearAllMocks();
  calls.towerCalls.mockReset();
  document.body.className = "";
  mount();
});

afterEach(() => {
  document.body.innerHTML = "";
});

/** Split from menuWiring.test.ts (the 500-line ceiling): the Tower menu's
 *  calls for help, wired the same way. */
describe("wireMenus: the Tower menu's calls for help", () => {
  it("the Tower menu reads the two calls as it opens, and only then", () => {
    calls.towerCalls.mockReturnValue({ fireRescue: false, exterminator: true });
    const { app } = fakeApp();
    const bar = wireMenus(app)!;
    bar.open($("mb-file") as HTMLButtonElement, false);
    expect(calls.towerCalls).not.toHaveBeenCalled();
    bar.open($("mb-tower") as HTMLButtonElement, false);
    expect(calls.towerCalls).toHaveBeenCalledExactlyOnceWith(app);
    expect($("mb-fire-rescue").getAttribute("aria-disabled")).toBe("true");
    expect($("mb-exterminator").hidden).toBe(false);
    expect($("mb-exterminator").hasAttribute("aria-disabled")).toBe(false);
    $("mb-exterminator").click();
    expect(calls.exterminate).toHaveBeenCalledExactlyOnceWith(app, { reopenStats: false });
    // A fire lights the rescue on the next open.
    calls.towerCalls.mockReturnValue({ fireRescue: true, exterminator: null });
    bar.open($("mb-tower") as HTMLButtonElement, false);
    expect($("mb-fire-rescue").hasAttribute("aria-disabled")).toBe(false);
    expect($("mb-exterminator").hidden).toBe(true);
    $("mb-fire-rescue").click();
    expect(calls.fire).toHaveBeenCalledExactlyOnceWith(app);
  });

  it("an engine that cannot answer leaves both calls grayed, and a stopped one is not asked", () => {
    calls.towerCalls.mockImplementation(() => {
      throw new Error("engine down");
    });
    const { app } = fakeApp();
    const bar = wireMenus(app)!;
    bar.open($("mb-tower") as HTMLButtonElement, false);
    expect($("mb-fire-rescue").getAttribute("aria-disabled")).toBe("true");
    expect($("mb-exterminator").hidden).toBe(true);
    bar.close(false);
    calls.towerCalls.mockClear();
    document.body.insertAdjacentHTML("beforeend", '<div id="engine-failure"></div>');
    bar.open($("mb-tower") as HTMLButtonElement, false);
    expect(calls.towerCalls).not.toHaveBeenCalled();
    expect($("mb-fire-rescue").getAttribute("aria-disabled")).toBe("true");
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

  it("on the title screen, Open shows the Open window itself, without pressing the title screen's Load Tower", () => {
    const { app } = fakeApp();
    const bar = wireMenus(app)!;
    files.showOpenDialog.mockClear();
    const splashLoad = vi.fn();
    const splash = document.createElement("div");
    splash.id = "splash";
    splash.innerHTML = `<button data-splash="load"></button>`;
    document.body.append(splash);
    splash.querySelector("button")!.addEventListener("click", splashLoad);
    bar.open($("mb-file") as HTMLButtonElement, false);
    $("mb-import").click();
    expect(files.showOpenDialog).toHaveBeenCalledExactlyOnceWith(app);
    expect(splashLoad).not.toHaveBeenCalled();
    splash.remove();
  });
});
