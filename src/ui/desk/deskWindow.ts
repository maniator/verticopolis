import { MovableWindow, WITHIN_PARENT, moverOf } from "../movableWindow";
import { resizedTo, type DeskRect, type DeskWindowId, type SizeLimits } from "./deskGeometry";

/**
 * One window on the 1994 desk (option C, owner 2026-11-15): the tower, Info,
 * Tools, the Map, the Bulletin or Tower Info. The desk either builds the
 * window's frame (the tower and Info have none of their own) or takes over a
 * window the game already draws with its own title bar (Tools and the small
 * windows), and then adds what a 1995 window has: minimize, maximize where it
 * is allowed, a size grip where it may resize, and the focus that turns its
 * title bar navy.
 *
 * Cost: nothing runs per frame. A move writes two styles per pointer move (the
 * game's MovableWindow); a resize draws a dotted outline and sets the size
 * once on release, so the tower's canvas resizes once per resize.
 */

/** What the desk tells a window it needs. */
export interface DeskWindowSpec {
  readonly id: DeskWindowId;
  /** The window element: a frame the desk built, or the game's own window. */
  readonly el: HTMLElement;
  /** The name on its taskbar button and in its buttons' labels. */
  readonly label: () => string;
  /** The tower sits below the small windows, so they stay on top of it even
   *  when it is maximized; the small windows stack among themselves. */
  readonly layer: "app" | "tool";
  /** The resize limits, or null for a window of one size. */
  readonly limits: SizeLimits | null;
  /** Tools grows in height only. */
  readonly heightOnly?: boolean;
  readonly canMax: boolean;
  /** Whether the game has the window open (a closed window has no taskbar
   *  button). The game decides: the Map's ✕, Tower > Bulletin and the rest. */
  readonly isOpen: () => boolean;
  /** Open it the game's own way (Options > Map and the rest); absent for a
   *  window that is always open on the desk (the tower, Info, Tools). */
  readonly open?: () => void;
  /** Close it the game's own way (its ✕, File > Close); absent for a window
   *  the desk never closes (Info, Tools). */
  readonly close?: () => void;
  /** Heard after a move, a resize, a minimize or a maximize. */
  readonly changed: (what: DeskChange) => void;
  /** Heard on a press anywhere in the window. */
  readonly pressed: () => void;
}

/** What a window just did, for the taskbar, the saved layout and analytics. */
export type DeskChange = "move" | "resize" | "min" | "restore" | "max" | "unmax";

/** The class a minimized window wears: hidden but still laid out, so the
 *  tower's canvas keeps its size while the window sits on the taskbar. */
export const DESK_MINIMIZED_CLASS = "desk-minimized";
/** The class a maximized window wears. */
export const DESK_MAXIMIZED_CLASS = "desk-maximized";
/** The class the window that has the focus wears. */
export const DESK_ACTIVE_CLASS = "desk-active";

/** The glyphs of the title bar's buttons, drawn in pixels like the 1995 ones. */
const GLYPH: Record<"min" | "max" | "restore" | "close", string> = {
  min: '<svg width="10" height="9" viewBox="0 0 10 9" shape-rendering="crispEdges" aria-hidden="true"><rect x="2" y="7" width="6" height="2"/></svg>',
  max: '<svg width="9" height="9" viewBox="0 0 9 9" shape-rendering="crispEdges" aria-hidden="true"><path d="M0 0h9v9H0zM1 2v6h7V2z" fill-rule="evenodd"/></svg>',
  restore: '<svg width="9" height="9" viewBox="0 0 9 9" shape-rendering="crispEdges" aria-hidden="true"><path d="M2 0h7v6H7V2H2zM0 3h7v6H0zM1 5v3h5V5z" fill-rule="evenodd"/></svg>',
  close: '<svg width="8" height="7" viewBox="0 0 8 7" shape-rendering="crispEdges" aria-hidden="true"><path d="M0 0h2v1h1v1h2V1h1V0h2v1H7v1H6v1H5v1h1v1h1v1h1v1H6V6H5V5H3v1H2v1H0V6h1V5h1V4h1V3H2V2H1V1H0z"/></svg>',
};

/** A title-bar button with a pixel glyph. */
export function titleButton(doc: Document, kind: keyof typeof GLYPH, label: string): HTMLButtonElement {
  const b = doc.createElement("button");
  b.type = "button";
  b.className = `btn xs desk-btn desk-btn-${kind}`;
  b.setAttribute("aria-label", label);
  b.title = label;
  b.innerHTML = GLYPH[kind];
  return b;
}

/** The Verticopolis icon at the left of a desk window's title bar. */
function titleIcon(doc: Document): HTMLImageElement {
  const icon = doc.createElement("img");
  icon.className = "desk-title-icon";
  icon.src = "./favicon.png";
  icon.alt = "";
  icon.width = 16;
  icon.height = 16;
  return icon;
}

/** Build a frame for content that has no window of its own (the tower, Info):
 *  a `.win` with the game's title bar and an empty body. */
export function buildFrame(doc: Document, id: string, title: string): { root: HTMLElement; body: HTMLElement; titleText: HTMLElement } {
  const root = doc.createElement("section");
  root.id = id;
  root.className = "win win-closable desk-win desk-frame";
  const bar = doc.createElement("div");
  bar.className = "win-title";
  const icon = titleIcon(doc);
  const titleText = doc.createElement("span");
  titleText.className = "desk-title-text";
  titleText.id = `${id}-title`;
  titleText.textContent = title;
  bar.append(icon, titleText);
  const body = doc.createElement("div");
  body.className = "desk-body";
  root.setAttribute("aria-labelledby", titleText.id);
  root.append(bar, body);
  return { root, body, titleText };
}

export class DeskWindow {
  minimized = false;
  maximized = false;
  private before: DeskRect | null = null;
  private readonly added: HTMLElement[] = [];
  private readonly ownMover: MovableWindow | null = null;
  /** Stops hearing the moves of a window the game moves itself. */
  private readonly unhear: (() => void) | null = null;
  private readonly maxButton: HTMLButtonElement | null = null;

  constructor(readonly spec: DeskWindowSpec) {
    const { el } = spec;
    const doc = el.ownerDocument;
    el.classList.add("desk-win");
    const bar = el.querySelector<HTMLElement>(":scope > .win-title");
    if (bar) {
      // The game's own windows wear the desk's icon too, while on the desk.
      if (!bar.querySelector(":scope > .desk-title-icon")) {
        const icon = titleIcon(doc);
        this.added.push(icon);
        bar.prepend(icon);
      }
      // Minimize and maximize go before the window's own ✕, as in 1995.
      const close = bar.querySelector<HTMLElement>(":scope > .btn.xs:not(.desk-btn), :scope > .desk-btn-close");
      const min = titleButton(doc, "min", `Minimize ${spec.label()}`);
      min.addEventListener("click", () => this.minimize());
      this.added.push(min);
      bar.insertBefore(min, close);
      if (spec.canMax) {
        const max = titleButton(doc, "max", `Maximize ${spec.label()}`);
        max.addEventListener("click", () => this.toggleMax());
        this.maxButton = max;
        this.added.push(max);
        bar.insertBefore(max, close);
      }
    }
    if (spec.limits) {
      const grip = doc.createElement("div");
      grip.className = "desk-grip";
      grip.setAttribute("aria-hidden", "true");
      el.appendChild(grip);
      this.added.push(grip);
      this.wireGrip(grip);
    }
    // The small windows already move by their title bars; the desk's own
    // frames and Tools get a mover here. Either way it moves inside the desk.
    const gameMover = moverOf(el);
    if (gameMover) this.unhear = gameMover.hear(() => spec.changed("move"));
    else {
      this.ownMover = new MovableWindow({
        win: el,
        title: `#${el.id} > .win-title`,
        within: WITHIN_PARENT,
        placed: () => spec.changed("move"),
        doubleClick: () => (spec.canMax ? this.toggleMax() : undefined),
        canMove: () => !this.maximized,
      });
    }
    el.addEventListener("pointerdown", this.onPress, true);
  }

  private readonly onPress = () => this.spec.pressed();

  /** The window's place and size now, in desk pixels. */
  rect(): DeskRect {
    const el = this.spec.el;
    if (this.maximized && this.before) return this.before;
    return { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight };
  }

  /** Put the window at `rect`; a fixed-size window takes the corner only. */
  place(rect: DeskRect): void {
    const el = this.spec.el;
    if (this.spec.limits) {
      if (!this.spec.heightOnly) el.style.width = `${rect.w}px`;
      el.style.height = `${rect.h}px`;
    }
    const mover = moverOf(el);
    if (mover) mover.moveTo({ x: rect.x, y: rect.y });
    else {
      el.style.left = `${rect.x}px`;
      el.style.top = `${rect.y}px`;
    }
  }

  minimize(): void {
    if (this.minimized) return;
    this.minimized = true;
    this.spec.el.classList.add(DESK_MINIMIZED_CLASS);
    this.spec.changed("min");
  }

  restore(): void {
    if (!this.minimized) return;
    this.minimized = false;
    this.spec.el.classList.remove(DESK_MINIMIZED_CLASS);
    this.spec.changed("restore");
  }

  toggleMax(): void {
    if (!this.spec.canMax) return;
    const el = this.spec.el;
    if (!this.maximized) {
      this.before = this.rect();
      this.maximized = true;
      moverOf(el)?.reset();
      el.classList.add(DESK_MAXIMIZED_CLASS);
      Object.assign(el.style, { left: "0px", top: "0px", width: "100%", height: "100%" });
    } else {
      const back = this.before;
      this.maximized = false;
      this.before = null;
      el.classList.remove(DESK_MAXIMIZED_CLASS);
      if (back) this.place(back);
    }
    if (this.maxButton) {
      const label = `${this.maximized ? "Restore" : "Maximize"} ${this.spec.label()}`;
      this.maxButton.innerHTML = GLYPH[this.maximized ? "restore" : "max"];
      this.maxButton.setAttribute("aria-label", label);
      this.maxButton.title = label;
    }
    this.spec.changed(this.maximized ? "max" : "unmax");
  }

  /** Take the desk's additions off and give the window back to the game's
   *  own layout (the phone, the title screen, or the desk turned off). */
  dispose(): void {
    const el = this.spec.el;
    el.removeEventListener("pointerdown", this.onPress, true);
    for (const a of this.added) a.remove();
    this.ownMover?.dispose();
    this.unhear?.();
    moverOf(el)?.reset();
    el.classList.remove("desk-win", DESK_MINIMIZED_CLASS, DESK_MAXIMIZED_CLASS, DESK_ACTIVE_CLASS);
    el.style.removeProperty("width");
    el.style.removeProperty("height");
    el.style.removeProperty("z-index");
    el.style.removeProperty("left");
    el.style.removeProperty("top");
  }

  /** The size grip: a dotted outline follows the pointer and the window takes
   *  the size on release. */
  private wireGrip(grip: HTMLElement): void {
    const limits = this.spec.limits;
    if (!limits) return;
    grip.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || this.maximized) return;
      e.preventDefault();
      e.stopPropagation();
      const el = this.spec.el;
      const desk = el.parentElement;
      if (!desk) return;
      try {
        grip.setPointerCapture(e.pointerId);
      } catch {
        /* the outline still follows while the pointer stays over the grip */
      }
      const start = this.rect();
      const sx = e.clientX;
      const sy = e.clientY;
      const outline = el.ownerDocument.createElement("div");
      outline.className = "desk-outline";
      desk.appendChild(outline);
      let next = start;
      const draw = (r: DeskRect) => Object.assign(outline.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
      draw(start);
      const move = (ev: PointerEvent) => {
        next = resizedTo(start, ev.clientX - sx, ev.clientY - sy, limits, desk.clientWidth, desk.clientHeight, !!this.spec.heightOnly);
        draw(next);
      };
      const end = () => {
        grip.removeEventListener("pointermove", move);
        grip.removeEventListener("pointerup", end);
        grip.removeEventListener("pointercancel", end);
        outline.remove();
        if (next.w === start.w && next.h === start.h) return;
        this.place(next);
        this.spec.changed("resize");
      };
      grip.addEventListener("pointermove", move);
      grip.addEventListener("pointerup", end);
      grip.addEventListener("pointercancel", end);
    });
  }
}
