/**
 * Why the Saved Towers dialog is being drawn (#2161). The player opening it
 * (the game panel's Saves… button) counts as a `saves_open`; the dialog
 * drawing itself again after a slot save, a delete, an Undo or a refused save
 * does not, so one visit counts once.
 */
export const SAVES_DRAW = {
  /** The player opened the dialog. */
  open: "open",
  /** The open dialog redraws its list after a change inside it. */
  redraw: "redraw",
} as const;

export type SavesDraw = (typeof SAVES_DRAW)[keyof typeof SAVES_DRAW];
