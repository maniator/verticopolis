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
vi.mock("@verticopolis/components/windows/movableWindow", () => ({ MovableWindow: movable, WITHIN_PARENT: "parent" }));
vi.mock("../ui/splashTemplate", () => ({
  SPONSOR_URL: "https://sponsor.example/",
  sponsorOffered: () => sponsor.offered,
}));
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

import { wireMenus, drawMenuBar } from "./menuWiring";

/** The File menu with Open Recent as index.html lays it out. */
function mount(): void {
  document.body.innerHTML = `
    <div id="menubar-host"></div>
    <main id="stage"></main>`;
  drawMenuBar();
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
    expect(menus.pick).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ menu: "file", item: "recent_1", via: "keys", grayed: false }),
    );
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
