import type { GameApp } from "../main";
import { MenuBar } from "@verticopolis/components/windows/menuBar";
import { MovableWindow, WITHIN_PARENT } from "@verticopolis/components/windows/movableWindow";
import { browserStorage } from "../ui/overviewMapPrefs";
import { PALETTE_COLLAPSE_BUTTON_ID, PALETTE_COLLAPSED_CLASS } from "../ui/paletteCollapse";
import { SPONSOR_URL, sponsorOffered } from "../ui/splashTemplate";
import { trackAppAction } from "../analytics";
import {
  menuItemCodeOf,
  menuNameOf,
  trackMenuDismiss,
  trackMenuOpen,
  trackMenuPick,
  type MenuScreen,
} from "../analyticsMenus";
import { isEngineStopped, isSplashUp } from "./interactionState";
import { closeTower } from "./titleScreen";
import { wireFileShortcuts, type FileCommands } from "./fileShortcuts";
import { showOpenDialog, showSaveAsDialog } from "./fileSpaceCommands";
import { fillRecentMenu, wireRecentMenu } from "./recentMenu";
import { overviewMapOpen, setOverviewMapOpen } from "./overviewMapWiring";
import { callFireRescue } from "./fireRescueCall";
import { confirmExterminate } from "./appModals";
import { TOWER_CALL_ITEM, showTowerCalls, towerCalls, type TowerCalls } from "./towerCallItems";
import { fitFullScreenItem } from "./fullScreenItem";
import { firstDragReporter, reportWindowClose } from "./movableWindows";
import { deskActive } from "../ui/desk/deskController";

/**
 * The menu bar's commands (index.html `#menubar`, behavior in
 * `ui/menuBar.ts`). The items whose ids predate the bar (btn-new,
 * btn-settings, btn-stats, btn-help, btn-about, btn-install-menu) keep the
 * click handlers `UI.wireControls` gives them; this wires the rest: Quick
 * Save, Close, Import, Export, Undo and Redo, Rename, Call Fire Rescue, Call
 * Exterminator, the rules, the windows the Tower menu shows, Tools, Status
 * Bar, Full Screen, Sound, Classic vs Modern and Replay Getting Started.
 *
 * The order is the party's (2026-11-15,
 * `_bmad-output/party-mode/menu-bar-order-party-findings-2026-11-15.md`):
 * the Tower menu holds the tower's windows (Tower Info, Map, Bulletin), and
 * Options holds the display toggles: Tools and Status Bar (a computer's
 * layout only) and Full Screen. The Window menu that held those was folded
 * into Options (owner, 2026-11-15). The title screen shows only File,
 * Options and Help, and leaves out what needs a tower.
 *
 * Tower Info and Bulletin (both in the Tower menu) are small windows over
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

/** The floating windows the Tower menu shows or hides, and whether
 *  each starts open on a desktop when the player has stored no choice. */
export const MENU_WINDOW = {
  tower: { id: "tower-win", item: "mb-win-tower", key: "vc.window.tower", openOnDesktop: false },
  bulletin: { id: "bulletin-win", item: "mb-win-bulletin", key: "vc.window.bulletin", openOnDesktop: true },
} as const;

/** The status bar's stored choice, and the body class that hides it. */
export const STATUS_BAR_KEY = "vc.window.statusbar";
export const STATUS_BAR_HIDDEN_CLASS = "statusbar-off";

/** The menus, by title, with nothing to offer until a tower is open. The
 *  title screen has no tower chosen yet (a placeholder runs behind it), so
 *  they leave the bar while it is up, the way a 1995 program's menu bar
 *  shrinks to File and Help with no document open (party 2026-11-15). */
export const TOWER_ONLY_MENUS = ["mb-edit", "mb-tower", "mb-window"] as const;

/** The items of the menus the title screen keeps that act on a tower, and
 *  the lines above them: they leave those menus while it is up. */
export const TOWER_ONLY_ITEMS = [
  "mb-save-sep",
  "mb-quick-save",
  "mb-export",
  "mb-close-sep",
  "mb-close",
  "mb-win-tools",
  "mb-win-statusbar",
  "mb-replay",
] as const;

/** On the title screen these items press the title screen's own button, so it
 *  leaves the way it always does (and the mute glyph stays in step). Open is
 *  not among them: it opens the Open window straight away, as the title
 *  screen's Open Tower… does. */
export const ON_TITLE_SCREEN: Readonly<Record<string, string>> = {
  "btn-new": "new",
  "mb-sound": "mute",
};

/** The File items that need a live engine: Close saves the tower first, Open
 *  and Open Recent hand a file to it, Save and Save As read the tower from it. */
const ENGINE_FILE_ITEMS = ["mb-close", "mb-import", "mb-recent", "mb-quick-save", "mb-export"] as const;

/** The `detail` a File key reports as `app_action` `file_key`. */
const FILE_KEY_DETAIL: Readonly<Record<keyof FileCommands, string>> = { open: "open", save: "save", saveAs: "save_as" };

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

/** Show the menus and items that need a tower only when one is open. */
function fitToScreen(titleScreenUp: boolean): void {
  for (const id of TOWER_ONLY_MENUS) {
    const menu = document.getElementById(id)?.parentElement;
    if (menu) menu.hidden = titleScreenUp;
  }
  for (const id of TOWER_ONLY_ITEMS) {
    const item = document.getElementById(id);
    if (item) item.hidden = titleScreenUp;
  }
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
  const floating = (
    Object.entries(MENU_WINDOW) as [keyof typeof MENU_WINDOW, (typeof MENU_WINDOW)[keyof typeof MENU_WINDOW]][]
  ).map(([name, w]) => {
    const win = document.getElementById(w.id);
    if (win) {
      // On the 1994 desk the desk counts the move (desk_window <window>_move).
      const placed = firstDragReporter(name, () => !deskActive());
      new MovableWindow({ win, title: `#${w.id} > .win-title`, within: WITHIN_PARENT, placed });
      win.hidden = !stored(storage, w.key, w.openOnDesktop && !onPhone);
      win.querySelector(`[data-close="${w.id}"]`)?.addEventListener("click", (e) => {
        reportWindowClose(e, name);
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

  // File: Open…, Save and Save As… also answer to their keys. Open and Save
  // As show My Towers (fileSpaceCommands.ts).
  // The analytics tell a menu pick from its Ctrl+O key.
  const file = {
    open: () => showOpenDialog(app, "key"),
    save: () => ui.cb.onSave(),
    saveAs: () => showSaveAsDialog(app),
  };
  on("mb-quick-save", file.save);
  on("mb-close", () => closeTower(app));
  on("mb-import", () => showOpenDialog(app, "menu"));
  wireRecentMenu(app);
  on("mb-export", file.saveAs);
  wireFileShortcuts(file, window, reportKey);
  // Edit: the toolbar's own buttons, so the gray-out and the gesture rules hold.
  on("mb-undo", () => ui.el.undo?.click());
  on("mb-redo", () => ui.el.redo?.click());
  // Tower.
  on("mb-rename", () => {
    towerWin?.setShown(true);
    ui.el.towerName.focus();
    ui.el.towerName.select();
  });
  on(TOWER_CALL_ITEM.fireRescue, () => callFireRescue(app));
  on(TOWER_CALL_ITEM.exterminator, () => void confirmExterminate(app, { reopenStats: false }));
  on("mb-rules", () => ui.showTowerRules());
  on("mb-win-map", () => setOverviewMapOpen(app, !overviewMapOpen(app)));
  // Options.
  // Its check follows at once, so the desk's tray speaker and Control Panel
  // show the change without a menu opening.
  on("mb-sound", () => {
    ui.cb.onToggleAudio();
    check("mb-sound", !ui.cb.isMuted());
  });
  on("mb-win-tools", () => document.getElementById(PALETTE_COLLAPSE_BUTTON_ID)?.click());
  on("mb-fullscreen", () => toggleFullScreen(ui));
  // Help.
  on("mb-compare", () => ui.showCompare());
  on("mb-replay", () => ui.cb.onReplayOnboarding());
  wireSponsor();

  // The same test Settings uses (`isSplashUp`): the title screen is up while
  // its element is on the page, whatever body class a removal left behind.
  const titleScreenUp = isSplashUp;
  const screen = (): MenuScreen => (titleScreenUp() ? "title" : "tower");
  // The title screen is a child of the body with a body class of its own
  // (ui/Onboarding.ts): the bar follows either one changing at once, not
  // only when a menu next opens. The callback is a lookup and ten
  // attribute writes, on a body child or class change only.
  fitToScreen(titleScreenUp());
  if (typeof MutationObserver === "function") {
    new MutationObserver(() => fitToScreen(titleScreenUp())).observe(document.body, {
      childList: true,
      attributes: true,
      attributeFilter: ["class"],
    });
  }
  // Capture runs before an item's own handlers: a grayed item does nothing,
  // and on the title screen a routed item presses the title screen's button.
  root.addEventListener(
    "click",
    (e) => {
      const item = e.target instanceof Element ? e.target.closest<HTMLElement>(".mb-item") : null;
      // A submenu's title only opens its submenu (ui/menuBar.ts): not a pick.
      if (!item || item.matches(".mb-sub-title")) return;
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
    // An item of a submenu counts in the menu it opens from (File > Open Recent).
    const menu = menuNameOf(item.closest(".mb-pop:not(.mb-subpop)")?.id ?? "");
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

  /** A File key that ran reports `app_action` `file_key`, never a
   *  `menu_pick`: no menu was opened, so the menu funnels stay menu trips. */
  function reportKey(command: keyof FileCommands, grayed: boolean): void {
    if (!grayed) trackAppAction("file_key", FILE_KEY_DETAIL[command]);
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
    onOpen: (menu) => {
      if (menu.id === "mb-file-menu") fillRecentMenu();
      check("mb-win-tools", !document.getElementById("palette")?.classList.contains(PALETTE_COLLAPSED_CLASS));
      check("mb-win-map", overviewMapOpen(app));
      for (const w of floating) check(w.item, !!w.win && !w.win.hidden);
      check("mb-win-statusbar", !document.body.classList.contains(STATUS_BAR_HIDDEN_CLASS));
      check("mb-fullscreen", !!document.fullscreenElement);
      // The installed app on a phone is not offered Full Screen (fullScreenItem.ts).
      fitFullScreenItem(app.mobileMq?.matches ?? false);
      check("mb-sound", !ui.cb.isMuted());
      grayLike("mb-undo", ui.el.undo);
      grayLike("mb-redo", ui.el.redo);
      const noTower = titleScreenUp();
      fitToScreen(noTower);
      // A tower the game stopped on cannot be saved, so it cannot be closed either.
      // Nor can it be opened over, saved or saved as (the File keys refuse them too).
      const stopped = isEngineStopped();
      for (const id of ENGINE_FILE_ITEMS) {
        if (stopped) document.getElementById(id)?.setAttribute("aria-disabled", "true");
        else document.getElementById(id)?.removeAttribute("aria-disabled");
      }
      // Fire Rescue and the exterminator, read from the engine only as the
      // Tower menu opens (towerCallItems.ts). A stopped engine answers
      // nothing, so both stay grayed.
      if (menu.id === "mb-tower-menu" && !noTower) {
        let calls: TowerCalls = { fireRescue: false, exterminator: null };
        if (!stopped) {
          try {
            calls = towerCalls(app);
          } catch {
            // An engine that cannot answer leaves both grayed; the calls
            // themselves would refuse anyway.
          }
        }
        showTowerCalls(calls);
      }
      // The Tools fold exists on the desktop layout only, and in a tower.
      const tools = document.getElementById("mb-win-tools");
      // On the 1994 desk Tools never folds; its Window menu brings it up.
      if (tools) tools.hidden = noTower || !document.getElementById(PALETTE_COLLAPSE_BUTTON_ID)?.offsetParent;
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
