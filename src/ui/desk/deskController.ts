import { trackAppAction, trackAppActionOnce } from "../../analyticsActions";
import { browserStorage } from "../overviewMapPrefs";
import { PALETTE_COLLAPSE_BUTTON_ID, PALETTE_COLLAPSED_CLASS } from "../paletteCollapse";
import {
  HELP_LIMITS,
  TOOLS_LIMITS,
  TOWER_LIMITS,
  type DeskWindowId,
} from "@verticopolis/components/windows/desk/deskGeometry";
import { read, write, type Store } from "./deskStore";
import { DeskTitle } from "./deskTitle";
import { clearTowerChrome, restoreSteppedDown, towerTitleText, type SteppedDown } from "./deskTower";
import { buildControlPanel } from "./deskControlPanel";
import { MANUAL_TITLE, ManualWindow, setDeskManual } from "./deskHelpWindow";
import { watchDeskWindows } from "./deskWatch";
import { startDeskTaskbar } from "./deskTaskbarWiring";
import { DESK_LAYOUT_KEY, placeWindows, pullOntoDesk, saveLayout } from "./deskLayout";
import { deskTaskResult, trackDeskClose, trackDeskTask, trackDeskWindow } from "./deskAnalytics";
import type { DeskTaskbar, TaskEntry } from "./deskTaskbar";
import {
  buildFrame,
  DESK_ACTIVE_CLASS,
  DeskWindow,
  type DeskChange,
  type DeskWindowSpec,
} from "@verticopolis/components/windows/desk/deskWindow";
import { onMenuItem } from "../../game/menuBarHost";

/**
 * The 1994 desk (option C, picked by the owner on 2026-11-15): on a computer,
 * every part of the game is its own window on a teal desktop with a taskbar,
 * the way the 1994 original opened a tower. The tower window holds the menu
 * bar, the tower and the status bar; Info, Tools, the Map, the Bulletin and
 * Tower Info are windows of their own beside it. Phones, tablets and small
 * windows keep today's layout, and so does the title screen.
 *
 * The desk moves the game's own elements into its windows and puts them back
 * when it goes away, so every id, listener and test that knows them keeps
 * working. It turns on when the page is wide and tall enough with a mouse
 * (`DESK_MQ`) and no title screen is up. There is no player switch (owner,
 * 2026-11-15): `?desk=on` and `?desk=off` are for testing.
 *
 * Cost: nothing per frame. A MutationObserver hears the few elements whose
 * open state the game owns (the Map, Bulletin, Tower Info, Tools, the title
 * screen's class, the tower's name), and each answer touches the taskbar only.
 */

/** Where the desk can show: a screen at least 1024 x 600 whose main input is
 *  a mouse or a trackpad. A touchscreen laptop gets it too, since its main
 *  pointer is the trackpad (owner, 2026-11-15). A phone or tablet does not,
 *  a tablet with a pen included (#2341): touch is its main input, even though
 *  the pen is a fine pointer that can hover. `?desk=on` still brings the desk
 *  to a tablet (DESK_ANY_SCREEN_MQ). */
export const DESK_MQ = "(min-width: 1024px) and (min-height: 600px) and (pointer: fine) and (hover: hover)";
/** The class on `<body>` while the desk is up. */
export const DESK_CLASS = "desk";
/** The event the desk sends on the document when it comes up or goes away. */
export const DESK_CHANGE_EVENT = "vc-desk-change";
/** Storage keys: the testing switch, the windows' places, the maximized tower. */
export const DESK_KEY = { enabled: "vc-desk", layout: DESK_LAYOUT_KEY, max: "vc-desk-max" } as const;

/** The stored value `?desk=on` writes: the desk on any screen. */
export const DESK_ANY_SCREEN = "any";
/** The narrowest screen `?desk=on` puts the desk on. */
export const DESK_ANY_SCREEN_MQ = "(min-width: 768px)";

/** Whether the desk is up now. */
export function deskActive(doc: Document = document): boolean {
  return doc.body.classList.contains(DESK_CLASS);
}

/** The taskbar order: the tower first, then the small windows. */
const ORDER: readonly DeskWindowId[] = ["tower", "info", "tools", "map", "bulletin", "towerInfo", "control", "help"];

/** One element the desk moved, and where it came from. */
interface Moved {
  readonly node: HTMLElement;
  readonly parent: Node;
  readonly next: Node | null;
}

export class DeskController {
  private readonly mq: MediaQueryList | null;
  private readonly wideMq: MediaQueryList | null;
  private readonly store: Store | null = browserStorage();
  private wins = new Map<DeskWindowId, DeskWindow>();
  private moved: Moved[] = [];
  private desk: HTMLElement | null = null;
  private taskbar: DeskTaskbar | null = null;
  private readonly title: DeskTitle;
  /** Renames the tower window (lit touches its title only when it changed). */
  private setTowerTitle: ((title: string) => void) | null = null;
  private manual: ManualWindow | null = null;
  private infoFrame: HTMLElement | null = null;
  /** True while the saved maximize comes back at start, which is not a click. */
  private restoring = false;
  /** Small windows the maximized tower pushed below its menu bar. */
  private readonly steppedDown = new Map<DeskWindowId, SteppedDown>();
  private watcher: MutationObserver | null = null;
  private syncControl: (() => void) | null = null;
  private active: DeskWindow | null = null;
  private z = 100;
  private readonly movedOnce = new Set<DeskWindowId>();
  private resizeFrame: number | null = null;

  constructor(private readonly doc: Document = document) {
    this.title = new DeskTitle(doc);
    this.mq = typeof window.matchMedia === "function" ? window.matchMedia(DESK_MQ) : null;
    this.wideMq = typeof window.matchMedia === "function" ? window.matchMedia(DESK_ANY_SCREEN_MQ) : null;
  }

  /** Watch for the moments the desk should come or go, and decide now. */
  start(): void {
    // Testing switches: `?desk=on` turns the desk on on any screen, a phone
    // or tablet included, so it can be tried there; `?desk=off` turns it off
    // until `?desk=on` (the screenshot and e2e runs use it).
    const ask = new URL(this.doc.location?.href ?? "http://x/").searchParams.get("desk");
    if (ask === "on") write(this.store, DESK_KEY.enabled, DESK_ANY_SCREEN);
    else if (ask === "off") write(this.store, DESK_KEY.enabled, "off");
    this.mq?.addEventListener("change", () => this.decide());
    this.wideMq?.addEventListener("change", () => this.decide());
    // The title screen's class on <body> decides too.
    new MutationObserver(() => this.decide()).observe(this.doc.body, { attributes: true, attributeFilter: ["class"] });
    this.wireMenuItems();
    this.decide();
  }

  /** Off only after `?desk=off`. */
  private enabled(): boolean {
    return read(this.store, DESK_KEY.enabled) !== "off";
  }

  /** The desk is on on any screen at least tablet-wide (`?desk=on`): a phone
   *  in its browser's desktop mode, a tablet. A phone held upright keeps its
   *  own layout, which the desk cannot share. */
  private anyScreen(): boolean {
    return read(this.store, DESK_KEY.enabled) === DESK_ANY_SCREEN && !!this.wideMq?.matches;
  }

  private decide(): void {
    const screenFits = !!this.mq?.matches || this.anyScreen();
    const fits = screenFits && this.enabled();
    const splash = this.doc.body.classList.contains("splash-up");
    const want = fits && !splash && !!this.doc.getElementById("stage");
    // The title screen sits in its own window on the desk.
    if (fits && splash) this.title.show();
    else this.title.hide();
    if (want && !this.desk) this.up();
    else if (!want && this.desk) this.down();
  }

  private wireMenuItems(): void {
    // Info and Tools are what the player plays with, so on the desk they never
    // close; the Window menu brings every window up (owner, 2026-11-15).
    for (const item of this.doc.querySelectorAll<HTMLElement>("[data-desk-win]")) {
      onMenuItem(item.id, () => this.show(item.dataset.deskWin as DeskWindowId), this.doc);
    }
  }

  /** Bring window `id` up: opened the game's own way if it is closed, back
   *  from the taskbar if minimized, and in front. */
  private show(id: DeskWindowId): void {
    const w = this.wins.get(id);
    if (!w) return;
    if (!w.spec.isOpen()) w.spec.open?.();
    this.bringUp(id);
  }

  private move(node: HTMLElement | null, into: HTMLElement): void {
    if (!node?.parentNode) return;
    this.moved.push({ node, parent: node.parentNode, next: node.nextSibling });
    into.appendChild(node);
  }

  // ---------- up and down ----------

  private up(): void {
    const doc = this.doc;
    const app = doc.getElementById("app");
    if (!app) return;
    doc.body.classList.add(DESK_CLASS);
    const desk = doc.createElement("div");
    desk.id = "desk";
    desk.className = "desk-area";
    app.appendChild(desk);
    this.desk = desk;

    // The tower window: the menu bar, the tower and the status bar.
    const tower = buildFrame(doc, "desk-win-tower", towerTitleText(this.doc), {
      label: "Close the tower",
      onClick: () => {
        trackDeskClose("tower");
        doc.getElementById("mb-close")?.click();
      },
    });
    this.setTowerTitle = tower.setTitle;
    desk.appendChild(tower.root);
    // The bar's host lays out as if it were not there, so the bar sits in the
    // tower window as its first row.
    this.move(doc.getElementById("menubar-host"), tower.body);
    this.move(doc.getElementById("stage"), tower.body);
    this.move(doc.getElementById("statusbar"), tower.body);

    // Info: the rating, date, time, funds, people and speed.
    const info = buildFrame(doc, "desk-win-info", "Info");
    this.infoFrame = info.root;
    desk.appendChild(info.root);
    this.move(doc.getElementById("topbar"), info.body);
    // Status Bar and Full Screen join the Window menu while the desk is up.
    const windowMenu = doc.getElementById("mb-window-menu");
    if (windowMenu)
      for (const id of ["mb-win-statusbar", "mb-fullscreen"]) this.move(doc.getElementById(id), windowMenu);

    // Tools and the small windows the game already draws.
    const palette = doc.getElementById("palette");
    const map = doc.getElementById("overview-map");
    const bulletin = doc.getElementById("bulletin-win");
    const towerInfo = doc.getElementById("tower-win");
    for (const el of [palette, map, towerInfo, bulletin]) this.move(el, desk);
    // Tools never folds on the desk: a window folded off the desk opens.
    if (palette?.classList.contains(PALETTE_COLLAPSED_CLASS)) doc.getElementById(PALETTE_COLLAPSE_BUTTON_ID)?.click();
    const item = (id: string) => () => doc.getElementById(id)?.click();

    const spec = (
      id: DeskWindowId,
      el: HTMLElement,
      label: () => string,
      rest: Partial<DeskWindowSpec> & Pick<DeskWindowSpec, "isOpen">,
    ): DeskWindowSpec => ({
      id,
      el,
      label,
      layer: "tool",
      limits: null,
      canMax: false,
      changed: (what) => this.changed(id, what),
      pressed: () => this.focus(this.wins.get(id) ?? null),
      ...rest,
    });
    const add = (s: DeskWindowSpec) => this.wins.set(s.id, new DeskWindow(s));
    add(
      spec("tower", tower.root, () => towerTitleText(this.doc), {
        layer: "app",
        limits: TOWER_LIMITS,
        canMax: true,
        isOpen: () => true,
        close: () => doc.getElementById("mb-close")?.click(),
      }),
    );
    add(spec("info", info.root, () => "Info", { isOpen: () => true }));
    if (palette)
      add(spec("tools", palette, () => "Tools", { limits: TOOLS_LIMITS, heightOnly: true, isOpen: () => true }));
    if (map)
      add(
        spec("map", map, () => "Map", {
          isOpen: () => !map.hidden,
          open: item("mb-win-map"),
          close: () => map.querySelector<HTMLElement>(".overview-map-close")?.click(),
        }),
      );
    if (bulletin)
      add(
        spec("bulletin", bulletin, () => "Bulletin", {
          isOpen: () => !bulletin.hidden,
          open: item("mb-win-bulletin"),
          close: () => bulletin.querySelector<HTMLElement>('[data-close="bulletin-win"]')?.click(),
        }),
      );
    if (towerInfo)
      add(
        spec("towerInfo", towerInfo, () => "Tower Info", {
          isOpen: () => !towerInfo.hidden,
          open: item("mb-win-tower"),
          close: () => towerInfo.querySelector<HTMLElement>('[data-close="tower-win"]')?.click(),
        }),
      );

    // The Control Panel: closed until the Verticopolis menu or the tray opens it.
    const control = buildControlPanel(
      doc,
      (icon) => trackAppAction("desk_control", icon),
      () => trackDeskClose("control"),
    );
    desk.appendChild(control.root);
    add(
      spec("control", control.root, () => "Control Panel", {
        isOpen: control.isOpen,
        open: control.open,
        close: control.close,
      }),
    );
    this.syncControl = control.sync;

    // The Player's Manual: closed until Help opens a page in it (uiHelp.ts,
    // which also holds the tower's pause), so the desk never opens it itself.
    const manual = new ManualWindow(doc, {
      closed: () => trackDeskClose("help"),
      shown: () => this.bringUp("help"),
      menuPicked: (item) => trackAppAction("desk_help_menu", item),
    });
    desk.appendChild(manual.frame.root);
    add(
      spec("help", manual.frame.root, () => MANUAL_TITLE, {
        limits: HELP_LIMITS,
        canMax: true,
        isOpen: () => manual.isOpen(),
        close: () => manual.close(),
      }),
    );
    this.manual = manual;
    setDeskManual(manual);
    const openControl = () => {
      control.open();
      this.bringUp("control");
    };

    this.taskbar = startDeskTaskbar(doc, app, desk, this.wins, {
      taskPressed: (id) => this.taskPressed(id),
      controlPanel: openControl,
      bringUp: (id) => this.bringUp(id),
      focus: (w) => this.focus(w),
      active: () => this.active,
    });

    // The small windows start stacked above the tower, in their own order.
    for (const w of this.wins.values()) if (w.spec.layer === "tool") w.spec.el.style.zIndex = String(++this.z);
    this.wins.get("tower")!.spec.el.style.zIndex = "1";
    this.layOut();
    doc.defaultView?.addEventListener("resize", this.onResize);
    this.watcher = watchDeskWindows(
      doc,
      [palette, map, bulletin, towerInfo, control.root, manual.frame.root],
      this.wins,
      {
        opened: (id) => this.bringUp(id),
        closed: (w) => {
          if (w === this.active) this.focusNext();
        },
        refresh: () => this.refresh(),
      },
    );
    this.focus(this.wins.get("tower") ?? null, false);
    trackAppActionOnce("desk_shown");
    doc.dispatchEvent(new CustomEvent(DESK_CHANGE_EVENT));
  }

  private down(): void {
    this.doc.defaultView?.removeEventListener("resize", this.onResize);
    if (this.resizeFrame !== null) this.doc.defaultView?.cancelAnimationFrame(this.resizeFrame);
    this.resizeFrame = null;
    this.steppedDown.clear();
    this.watcher?.disconnect();
    this.watcher = null;
    setDeskManual(null);
    this.manual?.dispose();
    this.manual = null;
    for (const w of this.wins.values()) w.dispose();
    this.wins.clear();
    this.doc.querySelectorAll(".desk-added").forEach((e) => e.remove());
    for (const { node, parent, next } of this.moved.reverse()) {
      parent.insertBefore(node, next && next.parentNode === parent ? next : null);
    }
    this.moved = [];
    this.taskbar?.stop();
    this.taskbar?.root.remove();
    this.taskbar = null;
    this.syncControl = null;
    this.desk?.remove();
    this.desk = null;
    this.infoFrame = null;
    this.setTowerTitle = null;
    this.active = null;
    this.doc.body.classList.remove(DESK_CLASS);
    this.doc.dispatchEvent(new CustomEvent(DESK_CHANGE_EVENT));
  }

  // ---------- layout ----------

  private layOut(): void {
    if (!this.desk) return;
    placeWindows(this.desk, this.store, this.wins, this.infoFrame);
    if (read(this.store, DESK_KEY.max) === "tower") {
      this.restoring = true;
      this.wins.get("tower")?.toggleMax();
      this.restoring = false;
    }
  }

  /** The browser window changed size: pull every window back onto the desk,
   *  once per frame at most. */
  private readonly onResize = (): void => {
    const view = this.doc.defaultView;
    if (!view || this.resizeFrame !== null) return;
    this.resizeFrame = view.requestAnimationFrame(() => {
      this.resizeFrame = null;
      if (this.desk) pullOntoDesk(this.desk, this.wins);
    });
  };

  private save(): void {
    saveLayout(this.store, this.wins);
  }

  // ---------- focus and the taskbar ----------

  /** Give `win` the focus; `raise` false keeps its place in the stack (the
   *  tower at start, under the small windows it opened with). */
  private focus(win: DeskWindow | null, raise = true): void {
    if (win && (win.minimized || !win.spec.isOpen())) win = null;
    // The tower's place moves on a maximize or a restore even with the focus.
    if (win && raise && (win !== this.active || win.spec.layer === "app")) {
      // Windows stack in the order they were pressed, the tower too; a
      // maximized tower stays under the small windows (owner, 2026-11-15).
      win.spec.el.style.zIndex = String(win.spec.layer === "app" && win.maximized ? 0 : ++this.z);
    }
    this.active = win;
    for (const w of this.wins.values()) w.spec.el.classList.toggle(DESK_ACTIVE_CLASS, w === win);
    this.refresh();
  }

  /** Give the focus to the topmost window still showing. */
  private focusNext(): void {
    let best: DeskWindow | null = null;
    for (const w of this.wins.values()) {
      if (w.minimized || !w.spec.isOpen()) continue;
      if (!best || Number(w.spec.el.style.zIndex || 0) > Number(best.spec.el.style.zIndex || 0)) best = w;
    }
    this.focus(best);
  }

  private bringUp(id: DeskWindowId): void {
    const w = this.wins.get(id);
    if (!w) return;
    w.restore();
    this.focus(w);
  }

  private taskPressed(id: DeskWindowId): void {
    const w = this.wins.get(id);
    if (!w) return;
    const result = deskTaskResult(w.minimized, w === this.active);
    trackDeskTask(id, result);
    if (result === "restore") this.bringUp(id);
    else if (result === "min") w.minimize();
    else this.focus(w);
  }

  private changed(id: DeskWindowId, what: DeskChange): void {
    if (what === "move" || what === "resize") this.save();
    // Only the tower's maximize is remembered for the next visit.
    if ((what === "max" || what === "unmax") && id === "tower")
      write(this.store, DESK_KEY.max, what === "max" ? "tower" : "");
    if (what === "max" && id === "tower")
      if (this.desk) clearTowerChrome(this.doc, this.desk, this.wins, this.steppedDown);
    if (what === "unmax" && id === "tower" && this.steppedDown.size) {
      restoreSteppedDown(this.wins, this.steppedDown);
      this.save();
    }
    if (this.restoring) return;
    if (what !== "move" || !this.movedOnce.has(id)) trackDeskWindow(id, what);
    if (what === "move") this.movedOnce.add(id);
    if (what === "min") this.focusNext();
    else if (what === "restore" || what === "max" || what === "unmax") this.focus(this.wins.get(id) ?? null);
    else this.refresh();
  }

  /** Rebuild the taskbar and the tower's title from the windows' state. */
  private refresh(): void {
    this.setTowerTitle?.(towerTitleText(this.doc));
    const entries: TaskEntry[] = [];
    for (const id of ORDER) {
      const w = this.wins.get(id);
      if (!w || !w.spec.isOpen()) continue;
      entries.push({ id, label: w.spec.label(), active: w === this.active, minimized: w.minimized });
    }
    this.taskbar?.render(entries);
    for (const item of this.doc.querySelectorAll<HTMLElement>("[data-desk-win]")) {
      const open = String(!!this.wins.get(item.dataset.deskWin as DeskWindowId)?.spec.isOpen());
      if (item.getAttribute("aria-checked") !== open) item.setAttribute("aria-checked", open);
    }
    this.taskbar?.syncSound();
    this.syncControl?.();
  }
}

/** Start the desk for this page, once. */
export function wireDesk(doc: Document = document): DeskController | null {
  if (doc.body.dataset.desk) return null;
  doc.body.dataset.desk = "1";
  const desk = new DeskController(doc);
  desk.start();
  return desk;
}
