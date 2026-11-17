import { trackAppAction } from "../analytics";

/**
 * A finger held on a row of the Open or Save As list opens the row's
 * right-click menu. Android's browsers turn a held finger into a
 * `contextmenu` event of their own, but Safari on an iPhone or iPad never
 * does, and Previous versions… is only on that menu.
 *
 * One hold opens the menu once. Whichever comes first, this timer or the
 * browser's own `contextmenu`, opens it, and the other is dropped. The click
 * a browser may send when the finger lifts is dropped as well: it would
 * otherwise select the row, which closes the menu, or press the menu item
 * that is now under the finger.
 *
 * Analytics (`docs/analytics-data-map.md`): `app_action` `file_menu`, with
 * `pointer` for a right-click, `hold` for a held finger and `key` for the
 * context menu key or Shift+F10.
 */

/** How long a finger holds still on a row before the menu opens: about the
 *  time phones take for their own touch and hold. */
export const ROW_HOLD_MS = 500;
/** How far a finger may drift (screen pixels, across plus down) and still be
 *  holding. Past this it is scrolling the list. */
export const ROW_HOLD_SLOP = 10;
/** After the finger lifts, how long a click or `contextmenu` can still belong
 *  to the hold that opened the menu. */
export const AFTER_LIFT_MS = 800;

/** How a menu was asked for, as the `file_menu` analytics detail. */
export type FileMenuHow = "pointer" | "hold" | "key";

/** Listeners for the whole window, bound in the capture phase so they see a
 *  press or a click before the row or menu item under it does. */
export interface PressWatch {
  handleEvent(e: Event): void;
  readonly capture: true;
}

/** A press in the row's rename box is the player's to edit text with: a
 *  hold there selects or pastes, as in any text box. */
const inTextBox = (e: Event): boolean => e.target instanceof Element && e.target.closest("input, textarea") !== null;

export interface RowPress {
  /** A press on a row: a finger arms the hold. */
  down(id: string, e: PointerEvent): void;
  /** The row's `contextmenu`: a right-click, or a browser's own hold. */
  contextMenu(id: string, e: MouseEvent): void;
  /** The context menu key or Shift+F10 opened the menu (analytics only). */
  key(): void;
  /** For the window: any new press, the held finger's moves and lift, and
   *  the click that comes after a hold opened the menu. */
  readonly watch: PressWatch;
}

/** The hold for one window's list. `open` places the menu for row `id` at a
 *  screen point; `now` is the clock, for tests. */
export function rowPress(open: (id: string, x: number, y: number) => void, now: () => number = Date.now): RowPress {
  let timer: ReturnType<typeof setTimeout> | null = null;
  /** The finger holding a row, while it is down. */
  let finger: number | null = null;
  let downX = 0;
  let downY = 0;
  /** The menu opened during this finger's hold. */
  let opened = false;
  /** When that finger lifted, while the menu it opened may still get its
   *  click or a late `contextmenu`. */
  let liftedAt: number | null = null;

  const stop = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  const reset = () => {
    stop();
    finger = null;
    opened = false;
    liftedAt = null;
  };
  const justLifted = () => opened && liftedAt !== null && now() - liftedAt < AFTER_LIFT_MS;

  function lift(e: PointerEvent): void {
    if (e.pointerId !== finger) return;
    stop();
    finger = null;
    if (opened) liftedAt = now();
  }

  function move(e: PointerEvent): void {
    if (e.pointerId !== finger || timer === null) return;
    if (Math.abs(e.clientX - downX) + Math.abs(e.clientY - downY) > ROW_HOLD_SLOP) stop();
  }

  const watch: PressWatch = {
    capture: true,
    handleEvent(e: Event): void {
      if (e.type === "pointerdown") reset();
      else if (e.type === "pointermove") move(e as PointerEvent);
      else if (e.type === "pointerup" || e.type === "pointercancel") lift(e as PointerEvent);
      // A click from the keyboard (Enter on a menu item) has no detail and
      // is never the finger's.
      else if (e.type === "click" && (e as MouseEvent).detail > 0 && justLifted()) {
        opened = false;
        liftedAt = null;
        e.preventDefault();
        e.stopPropagation();
      }
    },
  };

  return {
    down(id: string, e: PointerEvent): void {
      // The window's watch has already ended any earlier hold. A mouse opens
      // the menu with its right button, and a second finger is a pinch.
      if (e.pointerType === "mouse" || !e.isPrimary || inTextBox(e)) return;
      finger = e.pointerId;
      downX = e.clientX;
      downY = e.clientY;
      timer = setTimeout(() => {
        timer = null;
        opened = true;
        open(id, downX, downY);
        trackAppAction("file_menu", "hold");
      }, ROW_HOLD_MS);
    },
    contextMenu(id: string, e: MouseEvent): void {
      if (inTextBox(e)) return;
      e.preventDefault();
      const holding = finger !== null;
      // The hold already opened the menu: this is the browser's own hold
      // arriving late, and the menu stays as it is.
      if (opened && (holding || justLifted())) return;
      if (holding) {
        stop();
        opened = true;
      }
      open(id, e.clientX, e.clientY);
      trackAppAction("file_menu", holding ? "hold" : "pointer");
    },
    key: () => trackAppAction("file_menu", "key"),
    watch,
  };
}
