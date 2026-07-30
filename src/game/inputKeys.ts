import type { GameApp } from "../main";
import { isCrashed, isSplashUp, isDialogOpen } from "./interactionState";
import { flushPrefsSave } from "./audioPrefs";

/**
 * Keyboard play + audio-kick + pagehide wiring, split out of the `GameApp`
 * class. `bindKeys(app)` installs the window listeners once at construction; it
 * reaches the live `app.engine`/`app.keyboard` per event (never captured).
 * Behavior unchanged from the former `GameApp.bindKeys`.
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

export function bindKeys(app: GameApp): void {
  window.addEventListener("keydown", (e) => {
    // The crash screen owns all input while it is up: the renderer is dead
    // and the tower was just flushed, so game shortcuts (undo especially)
    // must not silently mutate the sim behind the card. Checked before the
    // undo/redo block below, which deliberately runs ahead of the #modal
    // guard and would otherwise stay live.
    if (isCrashed()) return;
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
          return app.undo();
        }
        if ((k === "z" && e.shiftKey) || k === "y") {
          e.preventDefault();
          return app.redo();
        }
      }
    }
    // Never hijack other browser/OS shortcuts (Ctrl/Cmd/Alt + key).
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    // Typing controls swallow every game key.
    const ae = document.activeElement as HTMLElement | null;
    if (isTypingTarget(ae)) return;
    // A focused button / palette item owns Enter/Space activation, don't ALSO
    // fire the build cursor on those keys. Movement/zoom/bulldoze keys still get
    // through, so keyboard play flows right after picking a tool from the palette.
    const onControl = !!ae && (ae.tagName === "BUTTON" || ae.tagName === "A" || ae.getAttribute("role") === "button");
    const activationKey = e.key === "Enter" || e.key === " " || e.key === "Spacebar";
    if (onControl && activationKey) return;
    if (isDialogOpen()) return;
    // Don't let game keys run the paused engine behind the first-run splash.
    if (isSplashUp()) return;
    if (e.key >= "0" && e.key <= "3") {
      app.setSpeed(Number(e.key));
      return;
    }

    // Keyboard play (F50–52): a virtual build cursor moved with arrows/WASD,
    // committed with Enter, bulldozed with Delete/X, full mouse-free play.
    const step = e.shiftKey ? 10 : 1;
    switch (e.key) {
      case "ArrowLeft": case "a": case "A": app.keyboard.moveCursor(-step, 0); break;
      case "ArrowRight": case "d": case "D": app.keyboard.moveCursor(step, 0); break;
      case "ArrowUp": case "w": case "W": app.keyboard.moveCursor(0, step); break;
      case "ArrowDown": case "s": case "S": app.keyboard.moveCursor(0, -step); break;
      case "Enter": case " ": case "Spacebar": app.keyboard.commitCursor(); break;
      case "Delete": case "Backspace": case "x": case "X": app.keyboard.bulldozeCursor(); break;
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
    e.preventDefault(); // consumed a movement/commit/bulldoze key
  });
  // First interaction starts audio (browser autoplay policy). Gated on the
  // crash screen the same way the keydown handler is: a stray key or tap behind
  // the crash card must not start the audio bed. A gesture that lands behind the
  // card is ignored WITHOUT removing the listeners, so the first real gesture
  // still unlocks audio; this holds no matter how the card is later dismissed.
  const kick = () => {
    if (isCrashed()) return;
    app.audio.start();
    window.removeEventListener("pointerdown", kick);
    window.removeEventListener("keydown", kick);
  };
  window.addEventListener("pointerdown", kick);
  window.addEventListener("keydown", kick);
  // Don't let a pending debounced pref write die with the page.
  window.addEventListener("pagehide", () => flushPrefsSave(app));
}
