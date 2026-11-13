/**
 * Keep pointer buttons Excalibur cannot name away from its input handler.
 *
 * Excalibur 0.32's pointer receiver maps the DOM `PointerEvent.button` code to
 * its own enum and throws on any code it does not list: it knows "no button"
 * (-1), left (0), middle (1), right (2) and back (3), and calls `fail(button)`
 * for anything else. A mouse's forward side button reports 4 and a pen's
 * eraser reports 5, so pressing either over the tower canvas threw an uncaught
 * `Error: 4` from inside the vendor handler (seen in production after the
 * 2026-11-12 launch traffic). The game gives those buttons no meaning, so the
 * guard swallows the event before Excalibur sees it, except that the last up
 * of a pointer is handed on with no button named, so a press never sticks.
 *
 * It listens in the capture phase on the canvas itself, which Excalibur also
 * listens on (the default `PointerScope.Canvas`), so it runs first and
 * `stopImmediatePropagation` keeps the event from reaching Excalibur's handler.
 * It also prevents the default action, as Excalibur does for every other
 * pointer event on the canvas.
 */

/** The DOM `PointerEvent.button` codes Excalibur's receiver can map. */
export const EXCALIBUR_POINTER_BUTTONS = {
  none: -1,
  left: 0,
  middle: 1,
  right: 2,
  back: 3,
} as const;

const KNOWN_BUTTONS: ReadonlySet<number> = new Set(Object.values(EXCALIBUR_POINTER_BUTTONS));

/** True when Excalibur's pointer receiver can map this DOM button code. */
export function excaliburCanMapButton(button: number): boolean {
  return KNOWN_BUTTONS.has(button);
}

/** The pointer events Excalibur's receiver handles on its target. */
const GUARDED_EVENTS = ["pointerdown", "pointerup", "pointermove", "pointercancel"] as const;

const guarded = new WeakSet<EventTarget>();

/** `PointerEvent.buttons` when no button is held. */
const NO_BUTTONS_HELD = 0;

/** True when this event is the last of its pointer: an up with no button
 *  still held, or a cancel. */
function endsPointer(event: PointerEvent): boolean {
  return event.type === "pointercancel" || (event.type === "pointerup" && event.buttons === NO_BUTTONS_HELD);
}

function swallowUnmappedButton(event: Event): void {
  const pointer = event as PointerEvent;
  if (typeof pointer.button !== "number" || excaliburCanMapButton(pointer.button)) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  // A chord can end on the unmapped button: press left, press forward, let go
  // of left, then of forward. The pointer's only up is then the forward
  // button's, and swallowing it would leave Excalibur holding a press that
  // never ends. Hand on the same up with no button named instead.
  if (endsPointer(pointer) && event.currentTarget) {
    event.currentTarget.dispatchEvent(
      new PointerEvent(event.type, {
        bubbles: true,
        cancelable: true,
        // With a view the browser adds the page scroll to pageX and pageY,
        // which Excalibur reads.
        view: window,
        pointerId: pointer.pointerId,
        pointerType: pointer.pointerType,
        isPrimary: pointer.isPrimary,
        clientX: pointer.clientX,
        clientY: pointer.clientY,
        screenX: pointer.screenX,
        screenY: pointer.screenY,
        button: EXCALIBUR_POINTER_BUTTONS.none,
        buttons: NO_BUTTONS_HELD,
      }),
    );
  }
}

/**
 * Install the guard on the canvas Excalibur reads pointer input from. Call it
 * before the engine is constructed so the guard is registered first. Safe to
 * call again for the same canvas: it installs once.
 */
export function guardPointerButtons(target: EventTarget): void {
  if (guarded.has(target)) return;
  guarded.add(target);
  for (const type of GUARDED_EVENTS) target.addEventListener(type, swallowUnmappedButton, { capture: true });
}
