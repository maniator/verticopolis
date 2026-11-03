/**
 * Keeping the game's keys out of the world while the overview MAP window has
 * focus (#343, CAP-5). The map stops a key's keydown from reaching the game;
 * this keeps the rest of that key's life away from it too, so the world's
 * key tracker (Excalibur's, which names keys by code and, given a release it
 * never saw pressed, drops whichever key it holds last, Space among them)
 * never sees half a press.
 */

/** A physical key, as the world's key tracker names it (the code, which a
 *  modifier never changes), or the key's name where the code is missing. */
export function keyId(e: Pick<KeyboardEvent, "code" | "key">): string {
  return e.code || e.key;
}

export class MapKeyKeeper {
  /** Fresh keydowns seen anywhere on the page (a held key's repeats are
   *  the same press). */
  private keydownCount = 0;
  /** Keys whose keydown the map kept and whose keyup has not come yet. */
  private readonly kept = new Set<string>();
  private readonly onKeyUp = (e: KeyboardEvent) => {
    if (this.kept.delete(keyId(e))) e.stopPropagation();
  };
  /** A kept key still held after focus left the window: its repeats stay
   *  kept (a held Escape never cancels the world's cursor, a held Enter never
   *  reopens the map), and a fresh press there is the game's again. */
  private readonly onKeyDown = (e: KeyboardEvent) => {
    if (!e.repeat) this.keydownCount++;
    const id = keyId(e);
    if (!this.kept.has(id) || (e.target instanceof Node && this.root.contains(e.target))) return;
    if (!e.repeat) {
      this.kept.delete(id);
      return;
    }
    e.preventDefault();
    e.stopPropagation();
  };

  /** Listen on the page (capture phase) for keys pressed in `root`. */
  constructor(private readonly root: HTMLElement) {
    const doc = root.ownerDocument;
    doc.addEventListener("keyup", this.onKeyUp, true);
    doc.addEventListener("keydown", this.onKeyDown, true);
  }

  /** Keep a keydown from the game, its keyup included. A repeat is not a new
   *  press: a key already held when focus arrived keeps its release for the
   *  game. */
  keep(e: KeyboardEvent): void {
    e.stopPropagation();
    if (!e.repeat) this.kept.add(keyId(e));
  }

  /** How many fresh keydowns the page has seen: a change means a key was
   *  pressed. */
  keydowns(): number {
    return this.keydownCount;
  }

  /** The page lost focus: every held key was let go elsewhere. */
  clear(): void {
    this.kept.clear();
  }

  dispose(): void {
    const doc = this.root.ownerDocument;
    doc.removeEventListener("keyup", this.onKeyUp, true);
    doc.removeEventListener("keydown", this.onKeyDown, true);
    this.kept.clear();
  }
}

/** How long after a press on the map lifts it still claims focus that
 *  arrives (a browser that focuses on the tap's click, which comes after the
 *  release). */
export const MAP_POINTER_FOCUS_MS = 500;

/**
 * Whether focus arriving on the map came from a pointer press there, which
 * never focuses the map: a mouse press is canceled before it can, and this
 * catches a browser that focuses on a tap anyway. A press claims focus while
 * any pointer is down on the map and for `MAP_POINTER_FOCUS_MS` after the last
 * one lifts. A key pressed, a press anywhere else, the page losing focus, or
 * the window focusing the map itself ends the claim at once, so focus that
 * follows a key, or comes once the claim has ended, stays.
 */
export class PointerFocusClaim {
  /** Pointers down on the map, by id, with their kind. */
  private readonly down = new Map<number, string>();
  private until = Number.NEGATIVE_INFINITY;
  private keysAtPress = 0;

  constructor(
    private readonly keys: MapKeyKeeper,
    private readonly now: () => number = () => performance.now(),
  ) {}

  /** A pointer went down on the map. A primary one means no other of its
   *  kind is down, so any id left from a lost release is dropped. */
  pressed(pointerId: number, pointerType: string, primary: boolean): void {
    if (primary) {
      for (const [id, type] of this.down) if (type === pointerType) this.down.delete(id);
    }
    this.down.set(pointerId, pointerType);
    this.keysAtPress = this.keys.keydowns();
  }

  /** A pointer lifted, or its press was canceled, anywhere on the page. */
  released(pointerId: number): void {
    if (!this.down.delete(pointerId) || this.down.size > 0) return;
    this.until = this.now() + MAP_POINTER_FOCUS_MS;
  }

  /** The claim ends at once. */
  forget(): void {
    this.down.clear();
    this.until = Number.NEGATIVE_INFINITY;
  }

  /** Whether focus arriving now is the press's. A key pressed since the
   *  press ends the claim here, for good. */
  claimsNow(): boolean {
    if (this.keys.keydowns() !== this.keysAtPress) this.forget();
    return this.down.size > 0 || this.now() <= this.until;
  }
}
