/**
 * The lobby tool's height (#308): how many stories, 1 to 3, a floor's first
 * lobby rises. The player picks one on the tool card (the only way on a
 * phone), and on a keyboard holds the original's modifiers instead: Ctrl for
 * two stories, Ctrl+Shift for three (Cmd on a Mac). A held modifier wins over
 * the pick while it is held. The engine decides where a lobby may rise and
 * keeps a built lobby's height; this only says what the player is asking for,
 * and the build controller hands it to the engine before each lobby command.
 */

/** The height a build with `tool` asks the engine for: the choice for the
 *  Lobby tool, and one story for every other tool, so the Floor tool's ground
 *  lobby and a room never rise from a height picked on the Lobby card or a
 *  modifier held for something else. */
export function lobbyHeightFor(tool: string, height: number): number {
  return tool === "lobby" ? height : 1;
}

/** The height a held modifier asks for: Ctrl (or Cmd) for 2 stories, with
 *  Shift for 3; 1 when neither is held. */
export function heldLobbyHeight(mods: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }): number {
  if (!mods.ctrlKey && !mods.metaKey) return 1;
  return mods.shiftKey ? 3 : 2;
}

export class LobbyHeightChoice {
  private chosen = 1;
  private held = 1;
  private readonly listeners = new Set<() => void>();

  /** The height the next lobby asks for: a held modifier's, else the pick. */
  get height(): number {
    return this.held > 1 ? this.held : this.chosen;
  }

  /** The height picked on the tool card. */
  get picked(): number {
    return this.chosen;
  }

  /** Pick a height on the tool card; clamped to 1 through 3. */
  pick(height: number): void {
    const h = Number.isFinite(height) ? Math.min(3, Math.max(1, Math.trunc(height))) : 1;
    if (h === this.chosen) return;
    this.chosen = h;
    this.changed();
  }

  /** Read the modifiers off a key or pointer event. */
  hold(mods: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }): void {
    const h = heldLobbyHeight(mods);
    if (h === this.held) return;
    this.held = h;
    this.changed();
  }

  /** Every modifier let go, as when the window loses focus mid-hold. */
  release(): void {
    this.hold({ ctrlKey: false, metaKey: false, shiftKey: false });
  }

  /** Call `fn` whenever {@link height} or the pick changes; answers the unsubscribe. */
  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private changed(): void {
    for (const fn of this.listeners) fn();
  }
}

/** Follow the held modifiers on `target` (the window): key presses and
 *  releases, pointer moves and presses, and a lost focus. Answers the
 *  disposer. */
export function trackLobbyHeightKeys(choice: LobbyHeightChoice, target: Window): () => void {
  const read = (e: KeyboardEvent | PointerEvent) => choice.hold(e);
  const lost = () => choice.release();
  const opts = { capture: true, passive: true } as const;
  target.addEventListener("keydown", read, opts);
  target.addEventListener("keyup", read, opts);
  target.addEventListener("pointermove", read, opts);
  target.addEventListener("pointerdown", read, opts);
  target.addEventListener("blur", lost);
  return () => {
    target.removeEventListener("keydown", read, opts);
    target.removeEventListener("keyup", read, opts);
    target.removeEventListener("pointermove", read, opts);
    target.removeEventListener("pointerdown", read, opts);
    target.removeEventListener("blur", lost);
  };
}
