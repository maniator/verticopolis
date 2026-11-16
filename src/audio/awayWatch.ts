/** The page the watch reads: its window's focus events and its document. */
export interface AwayWatchTarget {
  readonly win: Pick<Window, "addEventListener" | "removeEventListener">;
  readonly doc: Pick<Document, "addEventListener" | "removeEventListener" | "hasFocus"> & {
    readonly visibilityState: DocumentVisibilityState;
  };
}

/**
 * Report when the player leaves the game and when they come back. They are
 * away while the tab is hidden (another tab, a minimized window, a phone app
 * in the background) or while the page has lost focus (another app or window
 * in front of an installed app or a visible tab).
 *
 * `onChange` hears the state at once and then each time it flips. Returns a
 * function that stops the watch.
 */
export function watchAway(target: AwayWatchTarget, onChange: (away: boolean) => void): () => void {
  const { win, doc } = target;
  const isAway = (): boolean => doc.visibilityState !== "visible" || !doc.hasFocus();
  let away = isAway();
  onChange(away);
  const check = (): void => {
    const now = isAway();
    if (now === away) return;
    away = now;
    onChange(away);
  };
  win.addEventListener("blur", check);
  win.addEventListener("focus", check);
  doc.addEventListener("visibilitychange", check);
  return () => {
    win.removeEventListener("blur", check);
    win.removeEventListener("focus", check);
    doc.removeEventListener("visibilitychange", check);
  };
}
