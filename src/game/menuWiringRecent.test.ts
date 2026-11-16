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
vi.mock("../ui/movableWindow", () => ({ MovableWindow: movable, WITHIN_PARENT: "parent" }));
vi.mock("../ui/splashTemplate", () => ({ SPONSOR_URL: "https://sponsor.example/", sponsorOffered: () => sponsor.offered }));
vi.mock("../analytics", () => ({ trackAppAction: sponsor.track }));
const recent = vi.hoisted(() => ({ fill: vi.fn(), wire: vi.fn() }));
vi.mock("./recentMenu", () => ({ fillRecentMenu: recent.fill, wireRecentMenu: recent.wire }));
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

/** The File menu with Open Recent as index.html lays it out. */
function mount(): void {
  const item = (id: string) => `<button class="mb-item" id="${id}" role="menuitem">${id}</button>`;
  document.body.innerHTML = `
    <nav id="menubar">
      <div class="mb-menu">
        <button class="mb-title" id="mb-file" aria-expanded="false" aria-controls="mb-file-menu"><u>F</u>ile</button>
        <div class="mb-pop" id="mb-file-menu" role="menu" hidden>
          ${item("mb-import")}
          <div class="mb-sub" role="none">
            <button class="mb-item mb-sub-title" id="mb-recent" role="menuitem" aria-expanded="false" aria-controls="mb-recent-menu">Open Recent</button>
            <div class="mb-pop mb-subpop" id="mb-recent-menu" role="menu" hidden>
              <button class="mb-item mb-recent" id="mb-recent-1" role="menuitem"><u>1</u>Sky</button>
              <button class="mb-item" id="mb-recent-none" role="menuitem" aria-disabled="true" hidden>No recent towers</button>
            </div>
          </div>
          ${item("mb-quick-save")}${item("mb-close")}${item("mb-export")}
        </div>
      </div>
    </nav>
    <main id="stage"></main>`;
}

function fakeApp(): GameApp {
  const ui = {
    cb: { onSave: vi.fn(), onToggleAudio: vi.fn(), isMuted: vi.fn(() => false), onReplayOnboarding: vi.fn() },
    el: { undo: null, redo: null, towerName: document.createElement("input") },
    sayVisibly: vi.fn(),
  };
  return { ui, mobileMq: { matches: false } } as unknown as GameApp;
}

const $ = (id: string) => document.getElementById(id) as HTMLElement;

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
  document.body.className = "";
  mount();
});

afterEach(() => {
  document.body.innerHTML = "";
});

/** Split from menuWiring.test.ts (the 500-line ceiling). */
describe("wireMenus: File > Open Recent", () => {
  it("wires the lines once and fills them each time the File menu opens", () => {
    const app = fakeApp();
    const bar = wireMenus(app)!;
    expect(recent.wire).toHaveBeenCalledExactlyOnceWith(app);
    expect(recent.fill).not.toHaveBeenCalled();
    bar.open($("mb-file") as HTMLButtonElement, false);
    bar.close(false);
    bar.open($("mb-file") as HTMLButtonElement, false);
    expect(recent.fill).toHaveBeenCalledTimes(2);
  });

  it("counts a line as a File menu pick by its number's code, and the submenu's title as no pick", () => {
    const bar = wireMenus(fakeApp())!;
    bar.open($("mb-file") as HTMLButtonElement, false);
    $("mb-recent").dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
    expect(menus.pick).not.toHaveBeenCalled();
    expect(bar.current()).toBe($("mb-file"));
    $("mb-recent-1").dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 0 }));
    expect(menus.pick).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ menu: "file", item: "recent_1", via: "keys", grayed: false }));
  });

  it("grays Open Recent with the other File commands once the game stopped on its engine", () => {
    const bar = wireMenus(fakeApp())!;
    document.body.insertAdjacentHTML("beforeend", '<div id="engine-failure"></div>');
    bar.open($("mb-file") as HTMLButtonElement, false);
    expect($("mb-recent").getAttribute("aria-disabled")).toBe("true");
    $("mb-recent").dispatchEvent(new PointerEvent("pointerover", { pointerType: "mouse", bubbles: true }));
    expect($("mb-recent-menu").hidden).toBe(true);
    bar.close(false);
    $("engine-failure").remove();
    bar.open($("mb-file") as HTMLButtonElement, false);
    expect($("mb-recent").hasAttribute("aria-disabled")).toBe(false);
  });
});
