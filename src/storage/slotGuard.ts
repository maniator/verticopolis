/**
 * The Saved Towers overwrite guard's memory: which manual slot holds the tower
 * being played (its "home" slot), and one step of Undo for the last slot that
 * was replaced or deleted.
 *
 * Saves carry no tower identity, and this guard must not add one (the save
 * format is unchanged), so the home slot is remembered by the running page
 * instead: the slot the tower was last loaded from or saved to, plus a
 * fingerprint of the value that was there then. A slot whose value no longer
 * matches (another tab wrote it, an Undo put an older tower back) is not home
 * any more, so saving into it asks first.
 *
 * Both records live in this module's memory, never in storage. A page load
 * boots whatever the shared autosave holds, which another tab may have
 * written, so nothing remembered from before the load can vouch for the tower
 * that booted: after a reload the first save over an occupied slot asks. The
 * Undo copy is one slot's value held in memory, so it never competes with the
 * saves for room.
 */

/** A short, stable fingerprint of a stored slot value: its length and a 32-bit
 *  FNV-1a hash of its UTF-16 code units. It tells "the value we wrote" from
 *  "a value someone else wrote" without keeping the value itself. */
export function slotFingerprint(raw: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < raw.length; i++) {
    hash ^= raw.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${raw.length}:${(hash >>> 0).toString(16)}`;
}

/** Reads a slot's stored value (`SaveGame.slotRaw`), null when it is empty. */
export type SlotReader = (slot: number) => string | null;

interface HomeRecord {
  readonly slot: number;
  readonly print: string;
}

/** What one step of Undo puts back. */
export interface SlotUndo {
  readonly slot: number;
  /** The name the replaced or deleted tower was saved under. */
  readonly towerName: string;
  readonly action: "replaced" | "deleted";
  /** The slot's whole stored value before the action. */
  readonly raw: string;
  /** The fingerprint of what the action left in the slot, null when it left
   *  the slot empty. Undo is offered only while the slot still holds that. */
  readonly left: string | null;
}

let home: HomeRecord | null = null;
let undo: SlotUndo | null = null;

/** Remember `slot` as the live tower's home, holding `raw` now. An empty slot
 *  is no one's home. */
export function rememberHome(slot: number, raw: string | null): void {
  rememberHomePrint(slot, raw === null ? null : slotFingerprint(raw));
}

/** {@link rememberHome} for a caller that already has the slot value's
 *  fingerprint (null for an empty slot), so it is not computed twice. */
export function rememberHomePrint(slot: number, print: string | null): void {
  home = print === null ? null : { slot, print };
}

/**
 * The live tower is another tower now (a new one, an import, any load). No
 * slot is known to hold it, and a replace's Undo is dropped: the slot holds
 * the only copy of the tower that replace saved there, and putting the old
 * one back over it would lose that copy with no way back. A delete's Undo
 * stays, since it only refills a slot that is still empty.
 */
export function forgetLiveTower(): void {
  home = null;
  if (undo?.action === "replaced") undo = null;
}

/** The live tower's home slot, or null when no slot is known to hold it. */
export function homeSlot(readSlot: SlotReader): number | null {
  if (home === null) return null;
  const raw = readSlot(home.slot);
  return raw !== null && slotFingerprint(raw) === home.print ? home.slot : null;
}

/** Keep `step` as the one step of Undo, replacing any earlier one. */
export function keepForUndo(step: SlotUndo): void {
  undo = step;
}

/** Drop the step of Undo (it was used). */
export function dropUndo(): void {
  undo = null;
}

/** The step of Undo, when the slot still holds what the action left. Once the
 *  slot holds anything else, putting the old tower back would destroy that,
 *  so the step is no longer offered. */
export function pendingUndo(readSlot: SlotReader): SlotUndo | null {
  if (undo === null) return null;
  const now = readSlot(undo.slot);
  const holds = now === null ? null : slotFingerprint(now);
  return holds === undo.left ? undo : null;
}

/** Test-only: forget both records, as a fresh page load does. */
export function __resetSlotGuardForTest(): void {
  home = null;
  undo = null;
}
