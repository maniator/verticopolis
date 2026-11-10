import type { GameApp } from "../main";
import { isCrashed, isEngineStopped, isSplashUp, isDialogOpen } from "./interactionState";
import { flushPrefsSave } from "./audioPrefs";
import { isPrimaryPress, noButtonHeld } from "../ui/overviewMapInput";
import { keyId } from "../ui/overviewMapKeys";
import { isSpaceKey, wheelZoomDelta } from "../shared/inputEvents";

/**
 * Keyboard play + audio-kick + pagehide wiring, split out of the `GameApp`
 * class. `bindKeys(app)` installs the window listeners once at construction; it
 * reaches the live `app.engine`/`app.keyboard` per event (never captured).
 */

/** A focused form control that consumes game keys: a game shortcut (speed digit,
 *  cursor move) must yield to it. Covers native INPUT/TEXTAREA/SELECT (arrow keys
 *  and space work the dropdown) and any contentEditable region. */
function isTypingTarget(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (el as HTMLElement).isContentEditable;
}

/** A focused element with its OWN undo history, so Ctrl/Cmd+Z belongs to it, not
 *  the tower: INPUT/TEXTAREA and any contentEditable region. A native SELECT is
 *  deliberately excluded (unlike {@link isTypingTarget}): it has no edit history
 *  and no native Ctrl/Cmd+Z, so suppressing there would just kill undo with a
 *  dropdown focused (e.g. a price-rung picker). The tower undo stays live there. */
function ownsNativeUndo(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || (el as HTMLElement).isContentEditable;
}

/** The input types that act when Space comes up, as a native button does. */
const ACTS_ON_SPACE_RELEASE = new Set(["checkbox", "radio", "button", "submit", "reset", "image", "color", "file"]);

/** The input types that take Space as text (an unknown type reads as "text"). */
const TEXT_ENTRY_TYPES = new Set(["text", "search", "email", "url", "tel", "password", "number", "date", "time", "datetime-local", "month", "week"]);

/** A focused field where Space types or opens something on the press: a text
 *  field, a dropdown or a contentEditable region. The field owns that Space,
 *  so its hold is not the game's to build with or to cancel. A checkbox, a
 *  radio or an input button acts on the release instead, like a button, and a
 *  slider ignores Space: a Space-drag still pans over them, and its release is
 *  canceled like a button's. */
function typesSpace(el: Element | null): boolean {
  if (el instanceof HTMLInputElement) return TEXT_ENTRY_TYPES.has(el.type);
  return isTypingTarget(el);
}

/** Keys that leave a pending Space tap as it was: Shift (Shift + an arrow
 *  jumps the cursor), the locks and Fn. Ctrl, Alt and Cmd drop it like any
 *  other key: they start a shortcut, and while Cmd is held macOS sends no
 *  release for Space, so a tap kept alive past it would build at a later arrow. */
const KEYS_THAT_KEEP_THE_TAP = new Set(["Shift", "CapsLock", "NumLock", "ScrollLock", "FnLock", "SymbolLock", "Fn"]);

/** Keys that open a focused dropdown's popup on some systems, held or fresh:
 *  Alt + Up or Down, F4, a plain Up or Down, or Enter. Each ends the hold on
 *  every system, so a plain Up or Down where it only changes the choice ends
 *  it too. */
const KEYS_THAT_OPEN_A_DROPDOWN = new Set(["ArrowDown", "ArrowUp", "F4", "Enter"]);

/** Whether a press or a key on `el` can open a dropdown's popup, which takes
 *  the keyboard until it closes. Every enabled select counts: a list box opens
 *  none on a desktop, but phones and tablets show it in a picker. */
function opensPopup(el: Element | null): boolean {
  return el instanceof HTMLSelectElement && !el.matches(":disabled");
}

/** A native control that acts on a Space release: a button, or an input
 *  whose type is in `ACTS_ON_SPACE_RELEASE` (a checkbox, a radio, a button
 *  input and the like). */
function isNativeSpaceControl(el: Element | null): el is HTMLButtonElement | HTMLInputElement {
  return el instanceof HTMLButtonElement || (el instanceof HTMLInputElement && ACTS_ON_SPACE_RELEASE.has(el.type));
}

/** Whether `el` acts on a Space release: a native control, or an ARIA button
 *  (a palette item, which draws its own pressed look). */
function actsOnSpaceRelease(el: Element | null): boolean {
  return isNativeSpaceControl(el) || el?.getAttribute("role") === "button";
}

/** Whether a key moves the keyboard build cursor. */
function isCursorKey(key: string): boolean {
  return cursorStep(key, 1) !== null;
}

/** A dialog, the splash, the crash card or the engine-failure card covers the
 *  world: nothing behind it pans, and Space belongs to its controls. */
function worldCovered(): boolean {
  return isDialogOpen() || isSplashUp() || isCrashed() || isEngineStopped();
}

/** The keyboard build cursor's step for a movement key (arrows and W A S D),
 *  or null for any other key. */
function cursorStep(key: string, step: number): [dx: number, dy: number] | null {
  switch (key) {
    case "ArrowLeft": case "a": case "A": return [-step, 0];
    case "ArrowRight": case "d": case "D": return [step, 0];
    case "ArrowUp": case "w": case "W": return [0, step];
    case "ArrowDown": case "s": case "S": return [0, -step];
    default: return null;
  }
}

/** Whether a plain game key (one held without Ctrl, Cmd or Alt) must stay out
 *  of the game right now. Shared by the press and the Space release, so both
 *  apply the same focus, dialog, splash and crash rules. */
function blocksGameKey(e: KeyboardEvent): boolean {
  if (isCrashed() || isEngineStopped()) return true;
  // Never hijack other browser/OS shortcuts (Ctrl/Cmd/Alt + key).
  if (e.ctrlKey || e.metaKey || e.altKey) return true;
  // Typing controls swallow every game key.
  const ae = document.activeElement as HTMLElement | null;
  if (isTypingTarget(ae)) return true;
  // A focused button / palette item owns Enter/Space activation, don't ALSO
  // fire the build cursor on those keys. Movement/zoom/bulldoze keys still get
  // through, so keyboard play flows right after picking a tool from the palette.
  // The Map window's canvas (role "application") counts too: Space held
  // there still pans the world, and it does not commit the build cursor.
  const role = ae?.getAttribute("role");
  const onControl = !!ae && (ae.tagName === "BUTTON" || ae.tagName === "A" || role === "button" || role === "application");
  const activationKey = e.key === "Enter" || isSpaceKey(e);
  if (onControl && activationKey) return true;
  if (isDialogOpen()) return true;
  // Don't let game keys run the paused engine behind the first-run splash.
  return isSplashUp();
}

/** A focused native control that Space pressed (a button, a checkbox, a radio,
 *  a button input and the like) stays drawn pressed when its release is
 *  canceled, since the browser resets that look as part of the release it
 *  would have handled. Moving focus off and straight back resets it and keeps
 *  the keyboard where it was. Only those controls: anything else that is
 *  `:active` is held by the mouse, and a blur would end its gesture (the Map
 *  lets go of the view, a text field commits its edit). */
function liftKeyboardPress(): void {
  const ae = document.activeElement;
  if (!isNativeSpaceControl(ae) || !ae.matches(":active")) return;
  ae.blur();
  ae.focus({ preventScroll: true });
}

/**
 * Install the game's window key listeners for `app`. They stay for the page's
 * life; `signal` lets a caller (the tests) take them down again.
 */
export function bindKeys(app: GameApp, signal?: AbortSignal): void {
  // Space is two keys at once: the build key of keyboard play and the pan key
  // held through a mouse drag (towerInputCamera, which handles a press a frame
  // late and reads the hold as it was when the button went down, so a drag
  // already under way keeps its tool). A pan hold is one with a pointer down at
  // any moment of it, or a wheel turn over the world that the camera reads as a
  // zoom. It does nothing at the keyboard cursor, and its release is canceled so
  // a focused button, checkbox or radio is not clicked either. Any other hold is
  // a tap and builds at the keyboard cursor on release. A cursor key pressed or
  // repeating before Space comes up builds the tap first, where Space went down
  // (fast typing along a row); Shift, the locks and Fn leave it alone, and any
  // other key drops it. Space's own repeats never build. A trackpad's momentum
  // scroll over the world right after a flick can still drop one tap. The
  // camera reads this hold (`spacePanKey`), so a Space the game does not follow
  // (a chord, or one typed into a field) never pans either.
  //
  // The pointers held down, by id, with their kind (mouse, pen or touch).
  const pointersDown = new Map<number, string>();
  // Where the Space hold stands: "up"; "held" with nothing armed (a focused
  // control or a cover took the press, another key dropped the tap, or the
  // hold came only as repeats); "tap", which builds on the release; or "pan",
  // whose release is canceled. Only "up" is not the camera's pan key.
  let space: "up" | "held" | "tap" | "pan" = "up";
  // The Space press now down, followed or not: what had focus and whether the
  // world was covered. A cover that comes up mid-press (an emergency choice,
  // its button focused) or swaps focus under it (one dialog for another) never
  // got this press, so its controls get neither the repeats nor the release;
  // nor does a control that gets focus since (focusTookSpace).
  let spacePress: { target: Element | null; covered: boolean } | null = null;
  const notePress = (): void => {
    spacePress = { target: document.activeElement, covered: worldCovered() };
  };
  // Cmd's release, a native menu or drag, or a dropdown's popup ends the hold
  // while Space may still be down, unseen. Its late release is canceled when
  // the hold was a pan, or when a press or a zooming wheel turn since would
  // have made it one.
  let panReleaseOwed = false;
  let spaceMayBeDown = false;
  const endSpaceHold = (): void => {
    space = "up";
    spacePress = null;
    panReleaseOwed = false;
    spaceMayBeDown = false;
  };
  // The press record stays: Space may still be down, and a cover that comes
  // up before its release did not get the press.
  const dropSpaceHold = (): void => {
    const owed = panReleaseOwed || space === "pan";
    const mayBeDown = spaceMayBeDown || space !== "up";
    const pressed = spacePress;
    endSpaceHold();
    panReleaseOwed = owed;
    spaceMayBeDown = mayBeDown;
    spacePress = pressed;
  };
  const startSpaceHold = (): void => {
    space = pointersDown.size > 0 ? "pan" : "held";
  };
  const usePanKey = (): void => {
    if (space !== "up") space = "pan";
    else if (spaceMayBeDown) panReleaseOwed = true;
  };
  const coverTookSpace = (): boolean =>
    !!spacePress && worldCovered() && (!spacePress.covered || document.activeElement !== spacePress.target);
  // A control that got focus since the press never got the press, as when a
  // narrower window closes the Map and the Map gives its button focus with
  // no key or pointer press in between. Nor did one focused before a Space
  // first seen as repeats. Space's repeats would arm it and the release
  // would press it. A click during a hold the game follows makes the hold a
  // pan, whose release is canceled anyway; after a Space typed into a field
  // or pressed as a chord there is no hold, and this rule alone keeps a
  // clicked button out.
  const focusTookSpace = (): boolean =>
    !!spacePress && document.activeElement !== spacePress.target && actsOnSpaceRelease(document.activeElement);
  // Whether Space was held as each press went down, by its native event. The
  // camera gets a press at its next frame (Excalibur queues them), when Space
  // may have come up or gone down since; it reads this record.
  const spaceAtPress = new WeakMap<Event, boolean>();
  app.spacePanKey = (press) => (press ? spaceAtPress.get(press) : undefined) ?? space !== "up";
  // A Space the game follows: not a chord with Ctrl, Cmd or Alt (a system
  // shortcut, whose release the system may keep), and not typed into a field.
  const followsSpace = (e: KeyboardEvent): boolean =>
    isSpaceKey(e) && !e.ctrlKey && !e.metaKey && !e.altKey && !typesSpace(document.activeElement);
  // Another key settles a pending tap: a cursor key builds it first, where
  // Space went down, and any other key drops it.
  const settleTap = (e: KeyboardEvent): void => {
    if (isCursorKey(e.key) && !blocksGameKey(e)) void app.keyboard.commitCursor();
    space = "held";
  };
  // Other keys pressed while nothing covered the world: a cover that comes up
  // while one is still held (an emergency choice, its button focused) gets none
  // of its repeats, so a held Enter does not press the cover's button.
  const heldUncovered = new Set<string>();
  // A repeat of a key the focused control did not get the press of (a cover
  // that came up mid-press, or a control focused since): neither its default
  // action nor any listener below the window sees it.
  const withholdRepeat = (e: KeyboardEvent): void => {
    e.preventDefault();
    e.stopPropagation();
  };
  const capture = { capture: true, signal };
  // Capture, so a control that stops a key lower down cannot hide it here.
  window.addEventListener("keydown", (e) => {
    // A key on a focused dropdown can open its popup, fresh or repeating, which
    // can take the Space release unseen, as a press on it can.
    if (space !== "up" && opensPopup(document.activeElement) && (KEYS_THAT_OPEN_A_DROPDOWN.has(e.key) || (e.repeat && isSpaceKey(e)))) dropSpaceHold();
    if (!isSpaceKey(e)) {
      if (!e.repeat) {
        if (worldCovered()) heldUncovered.delete(keyId(e));
        else heldUncovered.add(keyId(e));
      } else if (heldUncovered.has(keyId(e)) && worldCovered()) {
        withholdRepeat(e);
      }
    }
    if (e.repeat) {
      if (isSpaceKey(e)) {
        // A Space already down when the page got focus arrives only as repeats:
        // follow that hold too (it can still become the pan key), with no tap.
        // No cover got its press, so one that is up does not get the hold, even
        // a field in it (its repeated spaces are lost).
        if (!spacePress) spacePress = { target: null, covered: false };
        if (space === "up" && followsSpace(e)) startSpaceHold();
        if (coverTookSpace() || focusTookSpace()) withholdRepeat(e);
      } else if (space === "tap" && !KEYS_THAT_KEEP_THE_TAP.has(e.key)) {
        // A key held since before Space went down: its first repeat settles the tap.
        settleTap(e);
      }
      return;
    }
    if (KEYS_THAT_KEEP_THE_TAP.has(e.key)) return;
    // A fresh press of any other key settles a pending tap, and a fresh Space
    // starts a hold of its own.
    if (space === "tap") settleTap(e);
    // A Space chord or a Space typed into a field neither builds nor pans, and
    // it ends a hold whose release was lost.
    if (isSpaceKey(e)) {
      endSpaceHold();
      if (followsSpace(e)) startSpaceHold();
      notePress();
    }
  }, capture);
  window.addEventListener("keydown", (e) => {
    // The crash screen owns all input while it is up: the renderer is dead
    // and the tower was just flushed, so game shortcuts (undo especially)
    // must not silently mutate the sim behind the card. Checked before the
    // undo/redo block below, which deliberately runs ahead of the #modal
    // guard and would otherwise stay live.
    if (isCrashed() || isEngineStopped()) return;
    // Undo / redo (Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z or +Y), handled BEFORE the
    // modifier bail below so it isn't swallowed; yielded to a focused field that
    // keeps its own undo history (INPUT/TEXTAREA/contentEditable, e.g. the rename
    // box). A focused SELECT is NOT yielded to: it has no native undo, so the
    // tower undo stays live there (see ownsNativeUndo).
    {
      // Never mutate the tower behind the first-run splash or an open dialog:
      // this block runs BEFORE the modal/splash guards further down (so Ctrl+Z
      // isn't swallowed by the modifier bail), so it must repeat those two
      // checks itself. A choice-bearing dialog (the Saves picker) must not have
      // builds undone under it, and the splash must stay inert; gating any open
      // #modal is the conservative call and leaves undo fully live in normal
      // play. A field with its own undo history still keeps it (ownsNativeUndo).
      const guardsUndo = isSplashUp() || isDialogOpen();
      if (!guardsUndo && !ownsNativeUndo(document.activeElement) && (e.ctrlKey || e.metaKey)) {
        const k = e.key.toLowerCase();
        if (k === "z" && !e.shiftKey) {
          e.preventDefault();
          void app.undo();
          return;
        }
        if ((k === "z" && e.shiftKey) || k === "y") {
          e.preventDefault();
          void app.redo();
          return;
        }
      }
    }
    if (blocksGameKey(e)) return;
    if (e.key >= "0" && e.key <= "3") {
      app.setSpeed(Number(e.key));
      return;
    }

    // Keyboard play (F50–52): a virtual build cursor moved with arrows/WASD,
    // committed with Enter or Space, bulldozed with Delete/X, full mouse-free
    // play. A held commit or bulldoze key acts once: its repeats land on the
    // same cell, where they could only fail again.
    const move = cursorStep(e.key, e.shiftKey ? 10 : 1);
    if (move) {
      app.keyboard.moveCursor(...move);
      e.preventDefault();
      return;
    }
    if (isSpaceKey(e)) {
      // Builds on the release (the keyup listener below) or at the next
      // cursor key (the capture keydown above), if the hold stays a tap.
      // A Space pressed under a cover never becomes a build tap, even once the
      // cover is gone.
      if (!e.repeat && space === "held" && !spacePress?.covered) space = "tap";
      e.preventDefault(); // repeats too
      return;
    }
    switch (e.key) {
      case "Enter":
        if (!e.repeat) void app.keyboard.commitCursor();
        break;
      case "Delete": case "Backspace": case "x": case "X":
        if (!e.repeat) void app.keyboard.bulldozeCursor();
        break;
      case "+": case "=": app.engine.zoomBy(1.15); return;
      case "-": case "_": app.engine.zoomBy(1 / 1.15); return;
      case "c": case "C": {
        const cur = app.keyboard.cursor();
        if (cur) app.engine.ensureVisible(cur.tile, cur.floor);
        else app.engine.center();
        return;
      }
      case "Escape":
        app.keyboard.resetAnchor();
        app.engine.transportPreview = null;
        app.keyboard.refreshCursorPreview();
        app.announce("Cancelled");
        return;
      default:
        return; // not a game key, let it through
    }
    e.preventDefault(); // consumed a commit or bulldoze key, repeats included
  }, { signal });
  // Capture, ahead of a focused button or palette item, which act on the
  // Space release: the release of a pan-key hold, or of a Space pressed before
  // the control got focus, reaches them already canceled.
  window.addEventListener("keyup", (e) => {
    // While Cmd is held macOS sends no Space release, so Cmd's own release
    // ends the hold; a Space still down starts a new one at its next press or
    // at a repeat the game follows.
    heldUncovered.delete(keyId(e));
    if (e.key === "Meta") dropSpaceHold();
    if (!isSpaceKey(e)) return;
    const hold = panReleaseOwed ? "pan" : space;
    const coverTook = coverTookSpace();
    const focusTook = focusTookSpace();
    endSpaceHold();
    if (worldCovered()) {
      // Nothing behind a cover pans, so a Space pressed on its controls stays
      // theirs; one it did not get the press of is not, and builds nothing.
      if (coverTook) {
        e.preventDefault();
        liftKeyboardPress(); // a cover that left focus where it was
      }
      return;
    }
    if (hold === "pan" || focusTook) {
      e.preventDefault();
      liftKeyboardPress();
      return;
    }
    // Checked again at release: a focused field that came up while Space was
    // held keeps the build out of the tower.
    if (hold === "tap" && !blocksGameKey(e)) void app.keyboard.commitCursor();
  }, capture);
  // Pointers are tracked in the capture phase, so a handler further down that
  // stops the event cannot hide a press from the Space hold.
  window.addEventListener("pointerdown", (e) => {
    // A primary press means no other pointer of its kind is down, so one still
    // on record lost its release (a palm the system rejected, a touch taken by a
    // system gesture) and would make every later Space a pan hold. A mouse press
    // clears touch and pen ids too: the player has moved on to the mouse.
    if (e.isPrimary) {
      for (const [id, kind] of pointersDown) {
        const stale = kind === e.pointerType || e.pointerType === "mouse";
        if (stale && id !== e.pointerId) pointersDown.delete(id);
      }
    }
    pointersDown.set(e.pointerId, e.pointerType);
    usePanKey();
    spaceAtPress.set(e, space !== "up");
    // A dropdown's popup takes the keyboard, so Space can come up inside it,
    // unseen here, and leave the pan key on.
    const dropdown = e.target instanceof Element ? e.target.closest("select") : null;
    if (opensPopup(dropdown) && isPrimaryPress(e)) dropSpaceHold();
  }, capture);
  // A native drag (selected text, a link) takes the keyboard until the drop.
  // One the page canceled took nothing.
  window.addEventListener("dragstart", (e) => {
    if (!e.defaultPrevented) dropSpaceHold();
  }, { signal });
  const pointerGone = (e: PointerEvent): void => {
    pointersDown.delete(e.pointerId);
  };
  window.addEventListener("pointerup", pointerGone, capture);
  window.addEventListener("pointercancel", pointerGone, capture);
  // A move tells what a missed event left wrong: no button held means the
  // release went elsewhere (let go over another window); a button held that is
  // not on record means the press came while the page had no focus.
  window.addEventListener("pointermove", (e) => {
    if (noButtonHeld(e)) {
      pointerGone(e);
    } else if (!pointersDown.has(e.pointerId)) {
      pointersDown.set(e.pointerId, e.pointerType);
      usePanKey();
    }
  }, { capture: true, passive: true, signal });
  // A native context menu or a hidden page can swallow the release; the next
  // move with a button held puts a pointer that is still down back on record.
  // A menu the game kept closed (its own right-click, a touch long-press) took
  // nothing, and the press it came in is still held, so that one is skipped.
  // A native menu takes the keyboard too, so it ends the Space hold as well.
  const forgetPointers = (): void => pointersDown.clear();
  window.addEventListener("contextmenu", (e) => {
    if (e.defaultPrevented) return;
    forgetPointers();
    dropSpaceHold();
  }, { signal });
  // A tap armed before the tab was hidden does not build at the first cursor
  // key after it comes back.
  document.addEventListener("visibilitychange", () => {
    forgetPointers();
    if (document.hidden) endSpaceHold();
  }, { signal });
  // The wheel over the world zooms it, so a hold that turned it there was not a
  // build tap. A wheel that scrolls the palette or a panel, or a sideways swipe
  // the camera ignores, leaves the tap.
  window.addEventListener("wheel", (e) => {
    if (e.target === app.canvas && wheelZoomDelta(e) !== 0) usePanKey();
  }, { capture: true, passive: true, signal });
  // A release the page never sees (focus left mid-hold) must not build later.
  window.addEventListener("blur", () => {
    pointersDown.clear();
    heldUncovered.clear();
    endSpaceHold();
  }, { signal });
  // First interaction starts audio (browser autoplay policy). Gated on the
  // crash screen the same way the keydown handler is: a stray key or tap behind
  // the crash card must not start the audio bed. A gesture that lands behind the
  // card is ignored WITHOUT removing the listeners, so the first real gesture
  // still unlocks audio; this holds no matter how the card is later dismissed.
  const kick = () => {
    if (isCrashed() || isEngineStopped()) return;
    app.audio.start();
    window.removeEventListener("pointerdown", kick);
    window.removeEventListener("keydown", kick);
  };
  window.addEventListener("pointerdown", kick, { signal });
  window.addEventListener("keydown", kick, { signal });
  // Don't let a pending debounced pref write die with the page.
  window.addEventListener("pagehide", () => flushPrefsSave(app), { signal });
}
