/**
 * A held Enter's repeats go only to the element that had focus when Enter went
 * down (#1842). A button activates on every Enter keydown, repeats included,
 * so a dialog that closes on Enter hands focus back to the control that opened
 * it, and the next repeat would press that control and open the dialog again.
 * The control that got the press keeps its repeats. An Enter first seen as
 * repeats (held as the page got focus) is left alone, as other keys are.
 */
export interface HeldEnter {
  /** Note a keydown. True for an Enter repeat that reaches an element focused since the press. */
  withholds(e: KeyboardEvent): boolean;
  /** Note a keyup: Enter's release ends its press. */
  keyUp(e: KeyboardEvent): void;
  /** Forget the press, as when the page loses focus and the release goes unseen. */
  forget(): void;
}

export function heldEnter(focused: () => Element | null = () => document.activeElement): HeldEnter {
  // What had focus when Enter went down, or null while no press is on record.
  let press: { target: Element | null } | null = null;
  return {
    withholds(e) {
      if (e.key !== "Enter") return false;
      if (!e.repeat) {
        press = { target: focused() };
        return false;
      }
      return press !== null && focused() !== press.target;
    },
    keyUp(e) {
      if (e.key === "Enter") press = null;
    },
    forget() {
      press = null;
    },
  };
}
