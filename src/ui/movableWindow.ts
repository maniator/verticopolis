import { isPrimaryPress, noButtonHeld } from "./overviewMapInput";

/**
 * Movable windows: the player drags a closable window (the Map, the facility
 * card, a dialog) by its navy title bar, the way a 1990s desktop window
 * moves, and a double-click on the title bar puts it back where the game
 * keeps it. The window always stays whole inside its bounds (the tower view,
 * or the browser window for a dialog), and when the bounds or the window
 * change size it is pulled back inside.
 *
 * The listeners sit on the window and look for the title bar with `closest`,
 * so a title bar that lit renders again (the facility card's does) keeps
 * working with no rewiring. A press on a control inside the title bar (the
 * close button) never starts a move, and neither does a press below the bar
 * (the Map's View dropdown sits there).
 *
 * Cost: a press measures the window and its bounds once; each move writes two
 * styles and reads nothing; a resize measures once. Nothing runs per frame.
 */

/** A window's top-left corner, in its bounds' coordinates (CSS px). */
export interface Spot {
  readonly x: number;
  readonly y: number;
}

/** A width and a height (CSS px). */
export interface Extent {
  readonly w: number;
  readonly h: number;
}

/** The box a window moves inside, in client coordinates. */
export interface Bounds extends Extent {
  readonly left: number;
  readonly top: number;
}

/** Where a window of `size` may sit inside `bounds`: whole and inside, or, for
 *  a window bigger than its bounds, with its top-left corner (the title bar)
 *  inside. Whole pixels, so a moved window never lands on a half pixel. */
export function clampSpot(spot: Spot, size: Extent, bounds: Extent): Spot {
  const fit = (v: number, room: number) => Math.round(Math.max(0, Math.min(v, room)));
  return { x: fit(spot.x, bounds.w - size.w), y: fit(spot.y, bounds.h - size.h) };
}

/** The controls a title bar holds, which a press works rather than moves. */
const TITLE_CONTROLS = "button, select, input, textarea, a";

/** The title bar's tooltip, so a player who wonders how to move a window
 *  finds out by pointing at its bar. */
export const MOVE_HINT = "Drag to move. Double-click to put it back.";

/** The class a movable window wears, which gives its title bar the move
 *  cursor and keeps a touch on it from scrolling the page. */
export const MOVABLE_CLASS = "win-movable";

export interface MovableWindowOptions {
  /** The window that moves. Positioned (absolute in the stage, or a fixed
   *  dialog), so `left` and `top` place it. */
  readonly win: HTMLElement;
  /** The title bar's selector, matched from the pressed element up to `win`. */
  readonly title: string;
  /** The box the window moves inside: an element's padding box, or the
   *  browser window when null. */
  readonly within: HTMLElement | null;
  /** Whether the window moves now (the docked phone card does not). */
  readonly enabled?: () => boolean;
  /** Heard when a move ends with the spot the player chose, and with null when
   *  a double-click puts the window back. */
  readonly placed?: (spot: Spot | null) => void;
}

/** One move in progress: the pointer, where on the window it grabbed, and the
 *  window's size and bounds, measured once at the press. */
interface Drag {
  readonly pointerId: number;
  readonly grabX: number;
  readonly grabY: number;
  readonly size: Extent;
  readonly bounds: Bounds;
  moved: boolean;
}

export class MovableWindow {
  private spot: Spot | null = null;
  private drag: Drag | null = null;
  private readonly resizeObserver: ResizeObserver | null = null;
  private readonly onViewportResize = () => this.refit();
  private readonly listeners: ReadonlyArray<readonly [string, (e: Event) => void]>;

  constructor(private readonly opts: MovableWindowOptions) {
    const { win } = opts;
    win.classList.add(MOVABLE_CLASS);
    this.listeners = [
      ["pointerdown", (e) => this.down(e as PointerEvent)],
      ["pointermove", (e) => this.move(e as PointerEvent)],
      ["pointerup", (e) => this.end(e as PointerEvent)],
      ["pointercancel", (e) => this.end(e as PointerEvent)],
      ["lostpointercapture", (e) => this.end(e as PointerEvent)],
      ["dblclick", (e) => this.home(e)],
      ["pointerover", (e) => this.hint(e)],
    ];
    for (const [type, fn] of this.listeners) win.addEventListener(type, fn);
    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(() => this.refit());
      this.resizeObserver.observe(win);
      if (opts.within) this.resizeObserver.observe(opts.within);
    }
    if (!opts.within) win.ownerDocument.defaultView?.addEventListener("resize", this.onViewportResize);
  }

  /** Where the player put the window, or null while it sits where the game
   *  keeps it. */
  placedAt(): Spot | null {
    return this.spot;
  }

  /** Whether the player has moved the window from where the game keeps it. */
  isPlaced(): boolean {
    return this.spot !== null;
  }

  /** Put the window at `spot` (a stored place), pulled inside its bounds when
   *  the window has a size to measure; a hidden window is pulled in when it
   *  shows, since showing it resizes it. */
  moveTo(spot: Spot): void {
    this.spot = spot;
    this.write(spot);
    this.refit();
  }

  /** Give the window back to its own layout. Free when it was not moved. */
  reset(): void {
    if (!this.spot && !this.drag) return;
    this.drag = null;
    if (!this.spot) return;
    this.spot = null;
    const s = this.opts.win.style;
    s.left = s.top = s.right = s.bottom = s.margin = "";
  }

  /** Remove the listeners. */
  dispose(): void {
    for (const [type, fn] of this.listeners) this.opts.win.removeEventListener(type, fn);
    this.resizeObserver?.disconnect();
    this.opts.win.ownerDocument.defaultView?.removeEventListener("resize", this.onViewportResize);
  }

  /** The title bar a press landed on, or null for a press anywhere else or on
   *  one of the title bar's own controls. */
  private titleOf(e: Event): HTMLElement | null {
    const target = e.target;
    if (!(target instanceof Element) || target.closest(TITLE_CONTROLS)) return null;
    const title = target.closest<HTMLElement>(this.opts.title);
    return title && this.opts.win.contains(title) ? title : null;
  }

  private down(e: PointerEvent): void {
    // A press by the pointer that holds the drag means its release was lost
    // (the title bar re-rendered under it, say): the new press starts over.
    if ((this.drag && this.drag.pointerId !== e.pointerId) || !isPrimaryPress(e)) return;
    this.drag = null;
    const title = this.titleOf(e);
    if (!title || (this.opts.enabled && !this.opts.enabled())) return;
    const rect = this.opts.win.getBoundingClientRect();
    const bounds = this.bounds();
    this.drag = {
      pointerId: e.pointerId,
      grabX: e.clientX - rect.left,
      grabY: e.clientY - rect.top,
      size: { w: rect.width, h: rect.height },
      bounds,
      moved: false,
    };
    // No text selection and no focus change from a press on the bar.
    e.preventDefault();
    // The moves and the release come to the bar even off the window. A
    // pointer the browser no longer counts as down cannot be captured; the
    // window then still moves while the pointer stays over it.
    try {
      title.setPointerCapture(e.pointerId);
    } catch {
      /* not capturable: see above */
    }
  }

  private move(e: PointerEvent): void {
    const drag = this.drag;
    if (!drag || drag.pointerId !== e.pointerId) return;
    // A mouse or pen that moves with no button held let go somewhere this
    // window never heard: the move is over, and hovering moves nothing.
    if (e.pointerType !== "touch" && noButtonHeld(e)) {
      this.drag = null;
      if (drag.moved && this.spot) this.opts.placed?.(this.spot);
      return;
    }
    const { bounds } = drag;
    const spot = clampSpot({ x: e.clientX - drag.grabX - bounds.left, y: e.clientY - drag.grabY - bounds.top }, drag.size, bounds);
    drag.moved = true;
    this.spot = spot;
    this.write(spot);
  }

  private end(e: PointerEvent): void {
    const drag = this.drag;
    if (!drag || drag.pointerId !== e.pointerId) return;
    this.drag = null;
    if (drag.moved && this.spot) this.opts.placed?.(this.spot);
  }

  /** Name the move on the title bar's tooltip while the window can move, and
   *  drop it while it cannot (the docked phone card). Runs as the pointer
   *  enters an element, never per move. */
  private hint(e: Event): void {
    const title = this.titleOf(e);
    if (!title) return;
    const can = !this.opts.enabled || this.opts.enabled();
    if (can && title.title !== MOVE_HINT) title.title = MOVE_HINT;
    else if (!can && title.title === MOVE_HINT) title.removeAttribute("title");
  }

  /** A double-click on the title bar puts the window back where the game
   *  keeps it. */
  private home(e: Event): void {
    if (!this.spot || !this.titleOf(e)) return;
    if (this.opts.enabled && !this.opts.enabled()) return;
    this.reset();
    this.opts.placed?.(null);
  }

  /** Pull a moved window back inside its bounds after a size change. Reads
   *  layout, so it runs only on a resize or a restore, never per frame. */
  private refit(): void {
    const spot = this.spot;
    if (!spot || this.drag) return;
    const { win } = this.opts;
    // A hidden window has no size to keep inside; it refits when it shows.
    if (win.offsetWidth === 0 && win.offsetHeight === 0) return;
    const next = clampSpot(spot, { w: win.offsetWidth, h: win.offsetHeight }, this.bounds());
    if (next.x === spot.x && next.y === spot.y) return;
    this.spot = next;
    this.write(next);
  }

  /** The bounds in client coordinates: the element's padding box (the space
   *  `left` and `top` count from), or the browser window. */
  private bounds(): Bounds {
    const within = this.opts.within;
    if (!within) {
      const root = this.opts.win.ownerDocument.documentElement;
      return { left: 0, top: 0, w: root.clientWidth, h: root.clientHeight };
    }
    const r = within.getBoundingClientRect();
    return { left: r.left + within.clientLeft, top: r.top + within.clientTop, w: within.clientWidth, h: within.clientHeight };
  }

  /** Place the window's top-left corner. `margin: 0` lets a centered dialog
   *  leave the center; the stage windows have no margin to lose. */
  private write(spot: Spot): void {
    const s = this.opts.win.style;
    s.left = `${spot.x}px`;
    s.top = `${spot.y}px`;
    s.right = "auto";
    s.bottom = "auto";
    s.margin = "0";
  }
}
