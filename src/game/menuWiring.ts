import type { GameApp } from "../main";
import { MenuBar } from "../ui/menuBar";
import { MovableWindow } from "../ui/movableWindow";
import { browserStorage } from "../ui/overviewMapPrefs";
import { PALETTE_COLLAPSE_BUTTON_ID, PALETTE_COLLAPSED_CLASS } from "../ui/paletteCollapse";
import { openImport } from "../ui/uiImport";
import { SPONSOR_URL, sponsorOffered } from "../ui/splashTemplate";
import { trackAppAction } from "../analytics";
import { menuItemCodeOf, menuNameOf, trackMenuDismiss, trackMenuOpen, trackMenuPick, type MenuScreen } from "../analyticsMenus";
import { isSplashUp } from "./interactionState";
import { overviewMapOpen, setOverviewMapOpen } from "./overviewMapWiring";

/**
 * The menu bar's commands (index.html `#menubar`, behavior in
 * `ui/menuBar.ts`). The items whose ids predate the bar (btn-new, btn-load,
 * btn-settings, btn-stats, btn-help, btn-about, btn-install-menu) keep the
 * click handlers `UI.wireControls` gives them; this wires the rest: Quick
 * Save, Import, Export, Undo and Redo, Rename, the rules, the windows the
 * Tower and Window menus open, Full Screen, Sound, Classic vs Modern and Replay Getting
 * Started.
 *
 * Tower Info (Tower menu) and Bulletin (Window menu) are small windows over
 * the tower that replaced the old right sidebar. They move by their title
 * bars like the Map and remember whether the player left them open. With no
 * choice stored, Tower Info starts closed, and the Bulletin starts open on a
 * desktop so the news is in view, and closed on a phone, where the tower
 * needs the room (party, 2026-11-14). The status bar can be
 * hidden too, and remembers that.
 *
 * Nothing here runs per frame: the menus' check marks and the grayed
 * Undo and Redo are read once, as their menu opens.
 *
 * Analytics (owner, 2026-11-14): each trip into the menus sends `menu_open`,
 * then `menu_pick` (grayed clicks included) or `menu_dismiss`; the windows'
 * ✕ and their first drag send `window_close` and `window_move`
 * (`analyticsMenus.ts`, `docs/analytics-data-map.md`).
 */

/** The floating windows the Tower and Window menus show or hide, and whether
 *  each starts open on a desktop when the player has stored no choice. */
export const MENU_WINDOW = {
  tower: { id: "tower-win", item: "mb-win-tower", key: "vc.window.tower", openOnDesktop: false },
  bulletin: { id: "bulletin-win", item: "mb-win-bulletin", key: "vc.window.bulletin", openOnDesktop: true },
} as const;

/** The status bar's stored choice, and the body class that hides it. */
export const STATUS_BAR_KEY = "vc.window.statusbar";
export const STATUS_BAR_HIDDEN_CLASS = "statusbar-off";

/** The commands that act on the tower in play. The title screen has no tower
 *  chosen yet (a placeholder runs behind it), so they are grayed while it is
 *  up, the way a 1995 program grays Save until a document is open. */
export const NEEDS_A_TOWER = [
  "mb-quick-save",
  "mb-export",
  "mb-undo",
  "mb-redo",
  "btn-stats",
  "mb-rename",
  "mb-rules",
  "mb-win-tools",
  "mb-win-map",
  "mb-win-tower",
  "mb-win-bulletin",
  "mb-win-statusbar",
  "mb-replay",
] as const;

/** On the title screen these items press the title screen's own button, so it
 *  leaves the way it always does (and the mute glyph stays in step). Import is
 *  not among them: it opens the file chooser straight away, as the Load Tower
 *  picker's own "Choose file…" does from the title screen. */
export const ON_TITLE_SCREEN: Readonly<Record<string, string>> = {
  "btn-new": "new",
  "btn-load": "load",
  "mb-sound": "mute",
};

/** The stored value for a window or bar the player left open, and closed. */
const SHOWN = { open: "open", closed: "closed" } as const;

type Store = Pick<Storage, "getItem" | "setItem">;

function stored(storage: Store | null, key: string, fallback: boolean): boolean {
  try {
    const v = storage?.getItem(key);
    if (v === SHOWN.open) return true;
    if (v === SHOWN.closed) return false;
    return fallback;
  } catch {
    return fallback;
  }
}

function remember(storage: Store | null, key: string, open: boolean): void {
  try {
    storage?.setItem(key, open ? SHOWN.open : SHOWN.closed);
  } catch {
    // A full quota or a blocked origin: the choice still holds for this visit.
  }
}

function on(id: string, run: () => void): void {
  document.getElementById(id)?.addEventListener("click", run);
}

function check(id: string, checked: boolean): void {
  document.getElementById(id)?.setAttribute("aria-checked", String(checked));
}

/** Gray a menu item out the way the toolbar grays its twin. */
function grayLike(id: string, twin: Element | null): void {
  const item = document.getElementById(id);
  if (!item) return;
  if (twin?.getAttribute("aria-disabled") === "true") item.setAttribute("aria-disabled", "true");
  else item.removeAttribute("aria-disabled");
}

/** Wire the menu bar once; a page without it, or a second call, does nothing. */
export function wireMenus(app: GameApp): MenuBar | null {
  const root = document.getElementById("menubar");
  const stage = document.getElementById("stage");
  if (!root || !stage || root.dataset.wired) return null;
  root.dataset.wired = "1";
  const ui = app.ui;
  const storage = browserStorage();

  // Tower Info and Bulletin. A phone starts both closed.
  const onPhone = app.mobileMq?.matches ?? false;
  const floating = Object.entries(MENU_WINDOW).map(([name, w]) => {
    const win = document.getElementById(w.id);
    if (win) {
      let moved = false;
      const placed = () => {
        if (!moved) trackAppAction("window_move", name);
        moved = true;
      };
      new MovableWindow({ win, title: `#${w.id} > .win-title`, within: stage, placed });
      win.hidden = !stored(storage, w.key, w.openOnDesktop && !onPhone);
      win.querySelector(`[data-close="${w.id}"]`)?.addEventListener("click", () => {
        trackAppAction("window_close", name);
        setShown(false);
      });
    }
    function setShown(open: boolean): void {
      if (!win) return;
      win.hidden = !open;
      remember(storage, w.key, open);
    }
    on(w.item, () => setShown(!!win?.hidden));
    return { ...w, win, setShown };
  });
  const towerWin = floating.find((w) => w.id === MENU_WINDOW.tower.id);

  // The status bar.
  const setStatusBar = (open: boolean) => document.body.classList.toggle(STATUS_BAR_HIDDEN_CLASS, !open);
  setStatusBar(stored(storage, STATUS_BAR_KEY, true));
  on("mb-win-statusbar", () => {
    const open = document.body.classList.contains(STATUS_BAR_HIDDEN_CLASS);
    setStatusBar(open);
    remember(storage, STATUS_BAR_KEY, open);
  });

  // File.
  on("mb-quick-save", () => ui.cb.onSave());
  on("mb-import", () => openImport(ui));
  on("mb-export", () => ui.promptExport());
  // Edit: the toolbar's own buttons, so the gray-out and the gesture rules hold.
  on("mb-undo", () => ui.el.undo?.click());
  on("mb-redo", () => ui.el.redo?.click());
  // Tower.
  on("mb-rename", () => {
    towerWin?.setShown(true);
    ui.el.towerName.focus();
    ui.el.towerName.select();
  });
  on("mb-rules", () => ui.showTowerRules());
  on("mb-win-map", () => setOverviewMapOpen(app, !overviewMapOpen(app)));
  // Window.
  on("mb-win-tools", () => document.getElementById(PALETTE_COLLAPSE_BUTTON_ID)?.click());
  on("mb-fullscreen", () => toggleFullScreen(ui));
  // Options.
  on("mb-sound", () => ui.cb.onToggleAudio());
  // Help.
  on("mb-compare", () => ui.showCompare());
  on("mb-replay", () => ui.cb.onReplayOnboarding());
  wireSponsor();

  // The same test Settings uses (`isSplashUp`): the title screen is up while
  // its element is on the page, whatever body class a removal left behind.
  const titleScreenUp = isSplashUp;
  const screen = (): MenuScreen => (titleScreenUp() ? "title" : "tower");
  // Capture runs before an item's own handlers: a grayed item does nothing,
  // and on the title screen a routed item presses the title screen's button.
  root.addEventListener(
    "click",
    (e) => {
      const item = e.target instanceof Element ? e.target.closest<HTMLElement>(".mb-item") : null;
      if (!item) return;
      reportPick(item, e);
      if (item.getAttribute("aria-disabled") === "true") {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      const action = titleScreenUp() ? ON_TITLE_SCREEN[item.id] : undefined;
      const titleButton = action ? document.querySelector<HTMLElement>(`#splash [data-splash="${action}"]`) : null;
      if (!titleButton) return;
      e.stopPropagation();
      bar.close(false);
      titleButton.click();
    },
    true,
  );
  keepMenuBarHeight(root);

  /** One `menu_pick`, while a menu is open (a script's click is not a pick). */
  function reportPick(item: HTMLElement, e: MouseEvent): void {
    const open = bar.current();
    const menu = menuNameOf(item.closest("[role='menu']")?.id ?? "");
    if (!open || !menu) return;
    const grayed = item.getAttribute("aria-disabled") === "true";
    const checked = item.getAttribute("aria-checked");
    trackMenuPick({
      menu,
      item: menuItemCodeOf(item.id),
      via: e.detail === 0 ? "keys" : "pointer",
      screen: screen(),
      browsed: bar.browsed(),
      grayed,
      // The check mark was set as the menu opened; a pick flips it.
      ...(checked !== null && !grayed ? { state: checked === "true" ? ("off" as const) : ("on" as const) } : {}),
    });
  }

  const bar = new MenuBar(root, {
    onTrip: (title, via) => {
      const menu = menuNameOf(title.id);
      if (menu) trackMenuOpen({ menu, via, screen: screen() });
    },
    onDismiss: (title, how, browsed) => {
      const menu = menuNameOf(title.id);
      if (menu) trackMenuDismiss({ menu, how, screen: screen(), browsed });
    },
    onOpen: () => {
      check("mb-win-tools", !document.getElementById("palette")?.classList.contains(PALETTE_COLLAPSED_CLASS));
      check("mb-win-map", overviewMapOpen(app));
      for (const w of floating) check(w.item, !!w.win && !w.win.hidden);
      check("mb-win-statusbar", !document.body.classList.contains(STATUS_BAR_HIDDEN_CLASS));
      check("mb-fullscreen", !!document.fullscreenElement);
      check("mb-sound", !ui.cb.isMuted());
      grayLike("mb-undo", ui.el.undo);
      grayLike("mb-redo", ui.el.redo);
      const noTower = titleScreenUp();
      for (const id of NEEDS_A_TOWER) {
        if (noTower) document.getElementById(id)?.setAttribute("aria-disabled", "true");
        else if (id !== "mb-undo" && id !== "mb-redo") document.getElementById(id)?.removeAttribute("aria-disabled");
      }
      // The Tools fold exists on the desktop layout only.
      const tools = document.getElementById("mb-win-tools");
      if (tools) tools.hidden = !document.getElementById(PALETTE_COLLAPSE_BUTTON_ID)?.offsetParent;
      // Install app's separator shows with it (installAffordance.ts shows the item).
      const install = document.getElementById("btn-install-menu");
      const installSep = root.querySelector<HTMLElement>(".mb-install-sep");
      if (installSep) installSep.hidden = !install || install.hidden;
    },
  });
  return bar;
}

/** Publish the menu bar's height as `--menubar-h`, so the title screen can
 *  start under it (the bar stays on top there, as a program's menu bar does
 *  over its opening screen). */
function keepMenuBarHeight(root: HTMLElement): void {
  const write = () => document.documentElement.style.setProperty("--menubar-h", `${root.offsetHeight}px`);
  write();
  if (typeof ResizeObserver === "function") new ResizeObserver(write).observe(root);
}

/** The Help menu's Sponsor item: the splash's tip jar link (owner,
 *  2026-11-14), the same address, left out of the Android app for the same
 *  reason (`sponsorOffered`). A tap counts as `sponsor_click` from `menu`. */
function wireSponsor(): void {
  const link = document.getElementById("mb-sponsor");
  if (!(link instanceof HTMLAnchorElement)) return;
  link.hidden = !sponsorOffered();
  if (link.hidden) return;
  link.href = SPONSOR_URL;
  link.addEventListener("click", () => trackAppAction("sponsor_click", "menu"));
}

/** What the Full Screen item says on a browser that cannot fill the screen
 *  from a page (an iPhone's Safari). */
export const NO_FULL_SCREEN =
  "This browser can't play full screen from a web page. Add Verticopolis to your home screen (Share, then Add to Home Screen) to play it full screen.";

/** Fill the screen with the game, or leave full screen. */
export function toggleFullScreen(ui: Pick<GameApp["ui"], "sayVisibly">, doc: Document = document): void {
  if (doc.fullscreenElement) {
    void doc.exitFullscreen().catch(() => {});
    return;
  }
  if (!doc.fullscreenEnabled || typeof doc.documentElement.requestFullscreen !== "function") {
    ui.sayVisibly(NO_FULL_SCREEN, "info");
    return;
  }
  void doc.documentElement.requestFullscreen().catch(() => ui.sayVisibly(NO_FULL_SCREEN, "info"));
}
