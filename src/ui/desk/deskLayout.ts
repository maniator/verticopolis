import {
  defaultLayout,
  fitRect,
  parseLayout,
  type DeskRect,
  type DeskWindowId,
} from "@verticopolis/components/windows/desk/deskGeometry";
import type { DeskChange, DeskWindow } from "@verticopolis/components/windows/desk/deskWindow";
import { read, write, type Store } from "./deskStore";

/** Storage keys: the testing switch, the windows' places, the maximized tower. */
export const DESK_KEY = { enabled: "vc-desk", layout: "vc-desk-places", max: "vc-desk-max" } as const;

/**
 * Where the full desk's windows sit (the pocket desk leaves that to its
 * stylesheet): each where the player left it or in the first layout, pulled
 * back onto the desk when the browser window shrinks, and saved as the player
 * moves them. A maximized tower keeps its menu bar in reach by stepping the
 * small windows over it down.
 */
export class DeskLayout {
  private desk: HTMLElement | null = null;
  private resizeFrame: number | null = null;
  /** Small windows the maximized tower pushed below its menu bar. */
  private readonly steppedDown = new Map<DeskWindowId, { from: DeskRect; to: DeskRect }>();
  /** True while the saved maximize comes back at start, which is not a click. */
  restoring = false;

  constructor(
    private readonly doc: Document,
    private readonly store: Store | null,
    private readonly wins: ReadonlyMap<DeskWindowId, DeskWindow>,
  ) {}

  /** Place every window on `desk` and follow the browser window's size. */
  up(desk: HTMLElement, info: HTMLElement | null): void {
    this.desk = desk;
    const w = desk.clientWidth;
    const h = desk.clientHeight;
    const saved = parseLayout(read(this.store, DESK_KEY.layout));
    // Info's strip takes the width between Tools and the column first, so the
    // tower opens under it at the height the strip really has.
    if (info) info.style.width = `${defaultLayout(w, h).info.w}px`;
    const first = defaultLayout(
      w,
      h,
      info?.offsetHeight || undefined,
      this.wins.get("map")?.spec.el.offsetHeight || undefined,
    );
    for (const [id, win] of this.wins) win.place(fitRect(saved[id] ?? first[id], w, h, win.spec.limits));
    if (read(this.store, DESK_KEY.max) === "tower") {
      this.restoring = true;
      this.wins.get("tower")?.toggleMax();
      this.restoring = false;
    }
    this.doc.defaultView?.addEventListener("resize", this.onResize);
  }

  down(): void {
    this.doc.defaultView?.removeEventListener("resize", this.onResize);
    if (this.resizeFrame !== null) this.doc.defaultView?.cancelAnimationFrame(this.resizeFrame);
    this.resizeFrame = null;
    this.steppedDown.clear();
    this.desk = null;
  }

  /** Keep the places and the maximized tower stored as window `id` changes. */
  changed(id: DeskWindowId, what: DeskChange): void {
    if (!this.desk) return;
    if (what === "move" || what === "resize") this.save();
    if (what === "max" || what === "unmax")
      write(this.store, DESK_KEY.max, what === "max" && id === "tower" ? "tower" : "");
    if (what === "max" && id === "tower") this.clearTowerChrome();
    if (what === "unmax" && id === "tower" && this.steppedDown.size) {
      this.restoreSteppedDown();
      this.save();
    }
  }

  /** The browser window changed size: pull every window back onto the desk,
   *  once per frame at most. A maximized tower already fills it. */
  private readonly onResize = (): void => {
    const view = this.doc.defaultView;
    if (!view || this.resizeFrame !== null) return;
    this.resizeFrame = view.requestAnimationFrame(() => {
      this.resizeFrame = null;
      const desk = this.desk;
      if (!desk) return;
      for (const win of this.wins.values()) {
        if (win.maximized || !win.spec.isOpen()) continue;
        const now = win.rect();
        const fit = fitRect(now, desk.clientWidth, desk.clientHeight, win.spec.limits);
        if (fit.x !== now.x || fit.y !== now.y || fit.w !== now.w || fit.h !== now.h) win.place(fit);
      }
    });
  };

  private save(): void {
    const out: Partial<Record<DeskWindowId, DeskRect>> = {};
    for (const [id, win] of this.wins) if (win.spec.isOpen() && !win.minimized) out[id] = win.rect();
    const old = parseLayout(read(this.store, DESK_KEY.layout));
    write(this.store, DESK_KEY.layout, JSON.stringify({ ...old, ...out }));
  }

  /** A maximized tower keeps its title bar and menus in reach: a small window
   *  over them steps down below the menu bar while the tower is maximized, and
   *  steps back up on restore unless the player has moved it since. */
  private clearTowerChrome(): void {
    const desk = this.desk;
    const bar = this.doc.getElementById("menubar");
    if (!desk || !bar) return;
    const top = bar.getBoundingClientRect().bottom - desk.getBoundingClientRect().top + 2;
    for (const [id, win] of this.wins) {
      if (win.spec.layer !== "tool" || !win.spec.isOpen() || win.minimized) continue;
      const r = win.rect();
      if (r.y >= top) continue;
      const next = fitRect({ ...r, y: top }, desk.clientWidth, desk.clientHeight, win.spec.limits);
      win.place(next);
      this.steppedDown.set(id, { from: r, to: win.rect() });
    }
  }

  /** The tower is back to its size: the small windows it pushed go back up. */
  private restoreSteppedDown(): void {
    for (const [id, { from, to }] of this.steppedDown) {
      const win = this.wins.get(id);
      const now = win?.rect();
      if (win && now && now.x === to.x && now.y === to.y) win.place(from);
    }
    this.steppedDown.clear();
  }
}
