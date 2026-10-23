import type { Selection } from "./policy";

/**
 * The engine selection this page life booted with, recorded by boot so the
 * Settings section can say which choice is in effect, why, and whether a
 * changed choice needs a restart. Null before boot picks (and in pages that
 * never boot the game, such as the standalone help).
 */
let selection: Selection | null = null;

export function setCurrentSelection(s: Selection | null): void {
  selection = s;
}

export function currentSelection(): Selection | null {
  return selection;
}
