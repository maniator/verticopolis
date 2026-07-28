import type { GameMode } from "../engine/types";

/**
 * The slot-metadata shape the saves manager and the title screen's tower picker
 * both render from. Types only, so it can be imported from either direction
 * without a runtime cycle. Produced by `infoFrom` in `./SaveGame`, which
 * re-exports this for existing callers.
 */
export interface SlotInfo {
  slot: number | "auto";
  exists: boolean;
  /**
   * RAW presence: the key holds bytes, whether or not they parse. Distinct from
   * {@link exists}, which is false for a corrupt slot. The title screen's picker
   * needs the difference (SPEC-splash-load-tower CAP-2): a present-but-unreadable
   * slot is SHOWN and labeled, since a save from a newer build is unreadable
   * *here* and may be recovered later, the same reasoning `preserveUnreadable`
   * applies to the autosave. Hiding it would claim the tower is gone while the
   * bytes are on disk. Picking a "free" slot to WRITE still uses
   * {@link SaveGame.hasSlot}.
   */
  present: boolean;
  towerName?: string;
  star?: number;
  population?: number;
  funds?: number;
  savedAt?: number;
  /** Rule-set the tower was founded under. Optional only because an empty
   *  slot has no tower; infoFrom sets it on every EXISTING slot (a save
   *  without the field, pre-fork, or with a forged value reads as classic).
   *  The UI renders a missing mode as Classic, which is only correct for
   *  producers that coerce like infoFrom does. */
  mode?: GameMode;
  /** In-game day (1-indexed, from the save's minutes), so the Saves dialog
   *  can show a tower's age. Absent when the save's minutes are malformed:
   *  wrong type, non-finite, negative, or past the ~1,000-year ceiling. */
  day?: number;
}
