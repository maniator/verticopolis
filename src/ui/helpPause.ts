/**
 * Help never costs the player elevator time. Every Help action pauses the
 * tower, and the pause ends exactly once, at the speed the player had:
 *
 * - In-game Help (the Help menu, How to play, What's new, About this game, the
 *   Classic vs Modern comparison) ends it when its dialog closes, by any
 *   route. Moving from one Help dialog to the next keeps the one pause.
 * - Help in a new tab ends it when the game tab is visible and focused again,
 *   after it was first left, so the click that opens the tab never counts as
 *   a return.
 *
 * The pause only restores what it took. A tower that was already paused stays
 * paused, and a player who picked a speed while Help was open keeps that
 * speed. The speed toolbar and the live region say "Paused while Help is open"
 * and then "Back at <speed>".
 *
 * Pure apart from the ports, so the unit test drives it with spies.
 */

/** What the pause reads and writes in the game. */
export interface HelpPausePorts {
  /** The live speed index (0 paused, 1 slow, 2 medium, 3 fast). */
  getSpeed(): number;
  setSpeed(speed: number): void;
  /** Say a line in the screen-reader live region. */
  announce(text: string): void;
  /** Mark the speed toolbar's Pause button as held by Help, or clear it. */
  markToolbar(heldByHelp: boolean): void;
}

/** The window and document the new-tab return watch listens on. */
export interface ReturnWatchTarget {
  win: Pick<Window, "addEventListener" | "removeEventListener">;
  doc: Pick<Document, "addEventListener" | "removeEventListener" | "hasFocus"> & { readonly visibilityState: DocumentVisibilityState };
}

export const PAUSED_FOR_HELP = "Paused while Help is open";

/** The speed index the toolbar's Pause button sets. */
const PAUSED = 0;

/** The words for each running speed, as the toolbar names them. */
const SPEED_NAMES: Readonly<Record<number, string>> = { 1: "slow speed", 2: "medium speed", 3: "fast speed" };

export function backAt(speed: number): string {
  return `Back at ${SPEED_NAMES[speed] ?? `speed ${speed}`}`;
}

export class HelpPause {
  /** The speed Help took the tower from, while a pause is held; null otherwise. */
  private prev: number | null = null;
  /** Set while one Help dialog hands the screen to the next, so the outgoing
   *  dialog's displaced hook does not end the pause. */
  private swapping = false;
  /** Removes the new-tab return listeners, while a watch is armed. */
  private stopWatch: (() => void) | null = null;

  constructor(private readonly ports: HelpPausePorts) {}

  /** Whether a Help pause is held. */
  get held(): boolean {
    return this.prev !== null;
  }

  /** Start a Help pause, or keep the one already held (a second Help action,
   *  or Help reopened while a new-tab watch waits, keeps the first speed). */
  begin(): void {
    this.clearWatch();
    if (this.prev !== null) return;
    const speed = this.ports.getSpeed();
    this.prev = speed;
    if (speed === PAUSED) return;
    this.ports.setSpeed(PAUSED);
    this.ports.markToolbar(true);
    this.ports.announce(PAUSED_FOR_HELP);
  }

  /** End the Help pause, once. Restores the prior speed only when the tower
   *  is still at the pause Help set. */
  end(): void {
    this.clearWatch();
    const prev = this.prev;
    if (prev === null) return;
    this.prev = null;
    if (prev === PAUSED) return;
    this.ports.markToolbar(false);
    if (this.ports.getSpeed() !== PAUSED) return; // the player chose a speed meanwhile
    this.ports.setSpeed(prev);
    this.ports.announce(backAt(prev));
  }

  /** The player picked a speed while Help held the pause (the toolbar or a
   *  speed key, with Help in another tab that never took focus): Help lets go
   *  and keeps their speed. */
  release(): void {
    this.clearWatch();
    if (this.prev === null) return;
    const wasRunning = this.prev !== PAUSED;
    this.prev = null;
    if (wasRunning) this.ports.markToolbar(false);
  }

  /** Run `open`, which replaces one Help dialog with another, keeping the pause. */
  swap(open: () => void): void {
    this.swapping = true;
    try {
      open();
    } finally {
      this.swapping = false;
    }
  }

  /** A Help dialog lost the screen to another dialog: the pause ends, unless
   *  the newcomer is the next Help dialog ({@link swap}). */
  displaced(): void {
    if (!this.swapping) this.end();
  }

  /** The shared dialog closed by a route Help did not wire (another part of
   *  the game called closeModal). Ends the pause, unless Help went to a new
   *  tab, where the pause waits for the player's return instead. */
  closed(): void {
    if (this.stopWatch === null) this.end();
  }

  /**
   * Help opened in a new tab: keep the pause until the player comes back. The
   * watch first waits to see the game tab hidden or unfocused, then ends the
   * pause the first time the tab is visible and focused again.
   */
  untilReturn(target: ReturnWatchTarget): void {
    this.clearWatch();
    if (this.prev === null) return;
    const { win, doc } = target;
    let left = false;
    const check = () => {
      const here = doc.visibilityState === "visible" && doc.hasFocus();
      if (!here) left = true;
      else if (left) this.end();
    };
    win.addEventListener("blur", check);
    win.addEventListener("focus", check);
    doc.addEventListener("visibilitychange", check);
    this.stopWatch = () => {
      win.removeEventListener("blur", check);
      win.removeEventListener("focus", check);
      doc.removeEventListener("visibilitychange", check);
    };
  }

  private clearWatch(): void {
    const stop = this.stopWatch;
    this.stopWatch = null;
    stop?.();
  }
}
