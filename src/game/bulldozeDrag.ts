import type { FacilityKind } from "../shared/types";

/**
 * What a bulldoze drag clears. By default a drag removes only the kind of
 * thing it first touched (#644), so a sweep along a floor leaves the
 * elevators and rooms it crosses. The player can lift that limit on the
 * Bulldoze card (or the phone's strip) so one drag clears everything it
 * crosses. A single click removes anything either way.
 */
export type DragClears = "one kind" | "everything";

/** Whether a drag that clears `clears`, locked to `locked` (the kind it first
 *  touched), removes a thing of `kind`. */
export function dragRemoves(clears: DragClears, locked: FacilityKind | undefined, kind: FacilityKind): boolean {
  return clears === "everything" || locked === undefined || locked === kind;
}

export class BulldozeDragChoice {
  private chosen: DragClears = "one kind";
  private readonly listeners = new Set<() => void>();

  /** What the next drag clears. */
  get clears(): DragClears {
    return this.chosen;
  }

  /** Pick on the Bulldoze card or the phone's strip. */
  pick(clears: DragClears): void {
    if (clears === this.chosen) return;
    this.chosen = clears;
    for (const fn of this.listeners) fn();
  }

  /** Call `fn` whenever the pick changes; answers the unsubscribe. */
  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}
