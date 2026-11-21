import { trackAppAction, trackAppActionOnce } from "../../analyticsActions";
import { browserStorage } from "../overviewMapPrefs";
import { PALETTE_COLLAPSE_BUTTON_ID, PALETTE_COLLAPSED_CLASS } from "../paletteCollapse";
import { TOOLS_LIMITS, TOWER_LIMITS, type DeskWindowId } from "@verticopolis/components/windows/desk/deskGeometry";
import { read, write, type Store } from "./deskStore";
import { DESK_KEY, DeskLayout } from "./deskLayout";
import { DeskTitle } from "./deskTitle";
import { buildControlPanel } from "./deskControlPanel";
import {
  deskTaskResult,
  trackDeskClose,
  trackDeskStartOpen,
  trackDeskTask,
  trackDeskTray,
  trackDeskWindow,
  trackWindowMenuOpen,
  trackWindowMenuPick,
} from "./deskAnalytics";
import { DeskTaskbar, type TaskEntry } from "./deskTaskbar";
import {
  deskMode,
  DESK_POCKET_CLASS,
  DESK_TOUCH_CLASS,
  TOUCH_DESK_MQ,
  TOUCH_MQ,
  type DeskMode,
  type DeskSwitch,
  pocketBody,
} from "@verticopolis/components/windows/desk/deskPocket";
import { runWindowCommand, windowMenuState } from "@verticopolis/components/windows/desk/deskWindowMenu";
import {
  buildFrame,
  DESK_ACTIVE_CLASS,
  DeskWindow,
  type DeskChange,
  type DeskWindowSpec,
} from "@verticopolis/components/windows/desk/deskWindow";
import { onMenuItem, runMenuItem, setMenuState, type MenuEntryState } from "../../game/menuBarHost";
import { setDeskMenus } from "./deskMenus";

/**
 * The 1994 desk (option C, picked by the owner on 2026-11-15): on a computer,
 * every part of the game is its own window on a teal desktop with a taskbar,
 * the way the 1994 original opened a tower. The tower window holds the menu
 * bar, the tower and the status bar; Info, Tools, the Map, the Bulletin and
 * Tower Info are windows of their own beside it. A sideways tablet gets the
 * same desk with touch chrome; phones and upright tablets get the pocket desk
 * (`windows/desk/deskPocket` in the components). Small computer windows keep today's layout, and so does
 * the title screen.
 *
 * The desk moves the game's own elements into its windows and puts them back
 * when it goes away, so every id, listener and test that knows them keeps
 * working. It turns on when the page is wide and tall enough with a mouse
 * (`DESK_MQ`), or on a touchscreen, and no title screen is up. There is no
 * player switch (owner, 2026-11-15 and 2026-11-20): `?desk=on`,
 * `?desk=pocket` and `?desk=off` are for testing.
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
export { DESK_KEY };

/** The stored value `?desk=on` writes: the desk on any screen. */
export const DESK_ANY_SCREEN = "any";
/** The narrowest screen `?desk=on` puts the desk on. */
export const DESK_ANY_SCREEN_MQ = "(min-width: 768px)";

/** Whether the desk is up now. */
export function deskActive(doc: Document = document): boolean {
  return doc.body.classList.contains(DESK_CLASS);
}

/** The taskbar order: the tower first, then the small windows. */
const ORDER: readonly DeskWindowId[] = ["tower", "info", "tools", "map", "bulletin", "towerInfo", "control"];

/** One element the desk moved, and where it came from. */
interface Moved {
  readonly node: HTMLElement;
  readonly parent: Node;
  readonly next: Node | null;
}

export class DeskController {
  private readonly mq: MediaQueryList | null;
  private readonly wideMq: MediaQueryList | null;
  private readonly touchMq: MediaQueryList | null;
  private readonly roomyMq: MediaQueryList | null;
  /** The desk showing now, or the one about to come up. */
  private mode: DeskMode = null;
  private readonly store: Store | null = browserStorage();
  private readonly wins = new Map<DeskWindowId, DeskWindow>();
  private readonly layout: DeskLayout;
  private moved: Moved[] = [];
  private desk: HTMLElement | null = null;
  private taskbar: DeskTaskbar | null = null;
  private readonly title: DeskTitle;
  /** Renames the tower window (lit touches its title only when it changed). */
  private setTowerTitle: ((title: string) => void) | null = null;
  private infoFrame: HTMLElement | null = null;
  private watcher: MutationObserver | null = null;
  private syncControl: (() => void) | null = null;
  private active: DeskWindow | null = null;
  private z = 100;
  private readonly movedOnce = new Set<DeskWindowId>();
  /** The window the player just asked for from the Window menu, which the
   *  watcher brings up even on the pocket desk. */
  private asked: DeskWindowId | null = null;

  constructor(private readonly doc: Document = document) {
    this.title = new DeskTitle(doc);
    this.layout = new DeskLayout(doc, this.store, this.wins);
    const media = (q: string) => (typeof window.matchMedia === "function" ? window.matchMedia(q) : null);
    this.mq = media(DESK_MQ);
    this.wideMq = media(DESK_ANY_SCREEN_MQ);
    this.touchMq = media(TOUCH_MQ);
    this.roomyMq = media(TOUCH_DESK_MQ);
  }

  /** Watch for the moments the desk should come or go, and decide now. */
  start(): void {
    // Testing switches: `?desk=on` turns the full desk on on any screen at
    // least tablet-wide, `?desk=pocket` the pocket desk on any screen (a
    // computer's included, to try it), and `?desk=off` turns the desk off
    // until one of the others (the screenshot and e2e runs use it).
    const ask = new URL(this.doc.location?.href ?? "http://x/").searchParams.get("desk");
    if (ask === "on") write(this.store, DESK_KEY.enabled, DESK_ANY_SCREEN);
    else if (ask === "pocket" || ask === "off") write(this.store, DESK_KEY.enabled, ask);
    for (const mq of [this.mq, this.wideMq, this.touchMq, this.roomyMq])
      mq?.addEventListener("change", () => this.decide());
    // The title screen's class on <body> decides too.
    new MutationObserver(() => this.decide()).observe(this.doc.body, { attributes: true, attributeFilter: ["class"] });
    this.wireMenuItems();
    this.decide();
  }

  /** The desk this screen gets now (`windows/desk/deskPocket` in the components). */
  private screenMode(): DeskMode {
    const stored = read(this.store, DESK_KEY.enabled);
    const forced: DeskSwitch = stored === DESK_ANY_SCREEN || stored === "pocket" || stored === "off" ? stored : null;
    return deskMode({
      forced,
      computer: !!this.mq?.matches,
      wide: !!this.wideMq?.matches,
      touch: !!this.touchMq?.matches,
      roomy: !!this.roomyMq?.matches,
    });
  }

  private decide(): void {
    const mode = this.screenMode();
    const splash = this.doc.body.classList.contains("splash-up");
    const want = mode !== null && !splash && !!this.doc.getElementById("stage") ? mode : null;
    // The title screen sits in its own window on the full desk.
    if (mode === "desk" && splash) this.title.show();
    else this.title.hide();
    // Turning a tablet can change the desk: the old one goes first.
    if (this.desk && want !== this.mode) this.down();
    this.mode = want;
    if (want && !this.desk) this.up();
  }

  private get pocket(): boolean {
    return this.mode === "pocket";
  }

  private wireMenuItems(): void {
    // Info and Tools are what the player plays with, so on the desk they never
    // close; the Window menu brings every window up (owner, 2026-11-15).
    for (const item of this.doc.querySelectorAll<HTMLElement>("[data-desk-win]")) {
      onMenuItem(item.id, () => this.show(item.dataset.deskWin as DeskWindowId), this.doc);
    }
    // The Window menu opens the Bulletin by running Tower's hidden item: the player asking.
    onMenuItem("mb-win-bulletin", () => this.ask("bulletin"), this.doc);
  }

  /** Mark `id` as asked for until the game's answer to the pick has been heard. */
  private ask(id: DeskWindowId): void {
    this.asked = id;
    this.doc.defaultView?.setTimeout(() => {
      if (this.asked === id) this.asked = null;
    }, 0);
  }

  /** Bring window `id` up: opened the game's own way if it is closed, back
   *  from the taskbar if minimized, and in front. */
  private show(id: DeskWindowId): void {
    // The pocket desk's Map is the game's own card in the tower's view.
    if (this.pocket && id === "map" && this.doc.getElementById("overview-map")?.hidden)
      runMenuItem("mb-win-map", this.doc);
    const w = this.wins.get(id);
    if (!w) return;
    this.ask(id);
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
    const pocket = this.pocket;
    doc.body.classList.add(DESK_CLASS);
    doc.body.classList.toggle(DESK_POCKET_CLASS, pocket);
    doc.body.classList.toggle(DESK_TOUCH_CLASS, pocket || !!this.touchMq?.matches);
    const desk = doc.createElement("div");
    desk.id = "desk";
    desk.className = "desk-area";
    app.appendChild(desk);
    this.desk = desk;

    // The tower window: the menu bar, the tower and the status bar.
    const tower = buildFrame(doc, "desk-win-tower", this.towerTitleText(), {
      label: "Close the tower",
      onClick: () => {
        trackDeskClose("tower");
        doc.getElementById("mb-close")?.click();
      },
    });
    this.setTowerTitle = tower.setTitle;
    desk.appendChild(tower.root);
    const palette = doc.getElementById("palette");
    const map = doc.getElementById("overview-map");
    // The bar's host lays out as if it were not there, so the bar sits in the
    // tower window as its first row.
    this.move(doc.getElementById("menubar-host"), tower.body);
    if (pocket) {
      // Info, Tools and the tower share the tower window; the Map stays in
      // the tower's view, floating at its phone size.
      const grid = pocketBody(doc);
      tower.body.appendChild(grid);
      for (const id of ["topbar", "palette", "stage"]) this.move(doc.getElementById(id), grid);
    } else this.move(doc.getElementById("stage"), tower.body);
    this.move(doc.getElementById("statusbar"), tower.body);

    // Info: the rating, date, time, funds, people and speed.
    const info = buildFrame(doc, "desk-win-info", "Info");
    if (!pocket) {
      this.infoFrame = info.root;
      desk.appendChild(info.root);
      this.move(doc.getElementById("topbar"), info.body);
    }
    // Status Bar and Full Screen join the Window menu while the desk is up.
    const windowMenu = doc.getElementById("mb-window-menu");
    if (windowMenu)
      for (const id of ["mb-win-statusbar", "mb-fullscreen"]) this.move(doc.getElementById(id), windowMenu);
    setDeskMenus(doc, pocket);

    // Tools and the small windows the game already draws.
    const bulletin = doc.getElementById("bulletin-win");
    const towerInfo = doc.getElementById("tower-win");
    for (const el of pocket ? [towerInfo, bulletin] : [palette, map, towerInfo, bulletin]) this.move(el, desk);
    // Tools never folds on the desk: a window folded off the desk opens.
    if (palette?.classList.contains(PALETTE_COLLAPSED_CLASS)) doc.getElementById(PALETTE_COLLAPSE_BUTTON_ID)?.click();
    const item = (id: string) => () => runMenuItem(id, doc);

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
      spec("tower", tower.root, () => (pocket ? this.towerName() : this.towerTitleText()), {
        layer: "app",
        limits: TOWER_LIMITS,
        canMax: true,
        isOpen: () => true,
        close: () => doc.getElementById("mb-close")?.click(),
      }),
    );
    if (!pocket) add(spec("info", info.root, () => "Info", { isOpen: () => true }));
    if (palette && !pocket)
      add(spec("tools", palette, () => "Tools", { limits: TOOLS_LIMITS, heightOnly: true, isOpen: () => true }));
    if (map && !pocket)
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
    const openControl = () => {
      control.open();
      this.bringUp("control");
    };

    this.taskbar = new DeskTaskbar(doc, {
      task: (id) => this.taskPressed(id as DeskWindowId),
      start: (itemId) => {
        trackAppAction("desk_start", itemId);
        doc.getElementById(itemId)?.click();
      },
      controlPanel: openControl,
      opened: () => trackDeskStartOpen("tower"),
      tray: trackDeskTray,
      windowMenu: {
        state: (id) => windowMenuState(this.wins.get(id as DeskWindowId), this.active),
        run: (id, command) => {
          trackWindowMenuPick(id, command);
          runWindowCommand(this.wins.get(id as DeskWindowId), command, (w) =>
            w.minimized ? this.bringUp(w.spec.id) : this.focus(w),
          );
        },
        opened: (_id, from) => trackWindowMenuOpen(from),
      },
    });
    app.appendChild(this.taskbar.root);
    // A right-click on a window's title bar opens its window menu, as 1995's did.
    desk.addEventListener("contextmenu", (e) => {
      const el = (e.target as Element | null)?.closest?.(".win-title")?.parentElement;
      const id = el ? [...this.wins].find(([, w]) => w.spec.el === el)?.[0] : undefined;
      if (id && this.taskbar?.openWindowMenu(id, e.clientX, e.clientY)) e.preventDefault();
    });
    this.taskbar.start();

    // The small windows start stacked above the tower, in their own order.
    for (const w of this.wins.values()) if (w.spec.layer === "tool") w.spec.el.style.zIndex = String(++this.z);
    this.wins.get("tower")!.spec.el.style.zIndex = "1";
    // The pocket desk opens with the Map over the tower, and a Bulletin
    // already open waits on the taskbar.
    if (pocket && map?.hidden) item("mb-win-map")();
    if (pocket && bulletin && !bulletin.hidden) this.wins.get("bulletin")?.minimize();
    if (!pocket) this.layout.up(desk, this.infoFrame);
    this.watch([palette, map, bulletin, towerInfo, control.root]);
    this.focus(this.wins.get("tower") ?? null, false);
    trackAppActionOnce("desk_shown", pocket ? "pocket" : "desk");
    doc.dispatchEvent(new CustomEvent(DESK_CHANGE_EVENT));
  }

  private down(): void {
    this.layout.down();
    this.watcher?.disconnect();
    this.watcher = null;
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
    setDeskMenus(this.doc, null);
    this.doc.body.classList.remove(DESK_CLASS, DESK_POCKET_CLASS, DESK_TOUCH_CLASS);
    this.doc.dispatchEvent(new CustomEvent(DESK_CHANGE_EVENT));
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
    const pressed = deskTaskResult(w.minimized, w === this.active);
    // The pocket tower fills the screen and has no Minimize, so its button only brings it to the front.
    const result = this.pocket && id === "tower" && pressed === "min" ? "front" : pressed;
    trackDeskTask(id, result);
    if (result === "restore") this.bringUp(id);
    else if (result === "min") w.minimize();
    else this.focus(w);
  }

  private changed(id: DeskWindowId, what: DeskChange): void {
    this.layout.changed(id, what);
    if (this.layout.restoring) return;
    if (what !== "move" || !this.movedOnce.has(id)) trackDeskWindow(id, what);
    if (what === "move") this.movedOnce.add(id);
    if (what === "min") this.focusNext();
    else if (what === "restore" || what === "max" || what === "unmax") this.focus(this.wins.get(id) ?? null);
    else this.refresh();
  }

  /** Rebuild the taskbar and the tower's title from the windows' state. */
  private refresh(): void {
    this.setTowerTitle?.(this.towerTitleText());
    const entries: TaskEntry[] = [];
    for (const id of ORDER) {
      const w = this.wins.get(id);
      if (!w || !w.spec.isOpen()) continue;
      entries.push({ id, label: w.spec.label(), active: w === this.active, minimized: w.minimized });
    }
    this.taskbar?.render(entries);
    const pocketMap = this.pocket ? this.doc.getElementById("overview-map") : null;
    const checks: Record<string, MenuEntryState> = {};
    for (const item of this.doc.querySelectorAll<HTMLElement>("[data-desk-win]")) {
      const id = item.dataset.deskWin as DeskWindowId;
      checks[item.id] = { checked: pocketMap && id === "map" ? !pocketMap.hidden : !!this.wins.get(id)?.spec.isOpen() };
    }
    setMenuState(checks, this.doc);
    this.taskbar?.syncSound();
    this.syncControl?.();
  }

  /** Hear the game open and close its windows, rename the tower and switch
   *  the sound, and keep the taskbar in step. */
  private watch(els: ReadonlyArray<HTMLElement | null>): void {
    const watcher = new MutationObserver((records) => {
      for (const r of records) {
        const target = r.target as HTMLElement;
        if (r.type !== "attributes") continue;
        const id = [...this.wins].find(([, w]) => w.spec.el === target)?.[0];
        if (!id) continue;
        const w = this.wins.get(id);
        if (!w) continue;
        // A window the game just opened comes up in front, unminimized. On the
        // pocket desk the Bulletin covers the tower, so news the game posts
        // waits on the taskbar until the player asks for it.
        const opened =
          w.spec.isOpen() &&
          (r.oldValue?.includes(PALETTE_COLLAPSED_CLASS) || (r.attributeName === "hidden" && r.oldValue !== null));
        if (opened && this.pocket && id === "bulletin" && this.asked !== id) w.minimize();
        else if (opened) this.bringUp(id);
        else if (!w.spec.isOpen() && w === this.active) this.focusNext();
      }
      this.asked = null;
      this.refresh();
    });
    for (const el of els)
      if (el) watcher.observe(el, { attributes: true, attributeFilter: ["hidden", "class"], attributeOldValue: true });
    const name = this.doc.getElementById("sb-tower");
    if (name) watcher.observe(name, { childList: true, characterData: true, subtree: true });
    const sound = this.doc.getElementById("mb-sound");
    if (sound) watcher.observe(sound, { attributes: true, attributeFilter: ["aria-checked"] });
    this.watcher = watcher;
  }

  // ---------- the tower's name ----------

  /** The tower's name from the status bar ("Tower One · Classic"). */
  private towerName(): string {
    const text = this.doc.getElementById("sb-tower")?.textContent ?? "";
    return text.split(" · ")[0]?.trim() || "Verticopolis";
  }

  /** The tower window's title, in the period's "Document - Program" form. */
  private towerTitleText(): string {
    const name = this.towerName();
    return name === "Verticopolis" ? name : `${name} - Verticopolis`;
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
