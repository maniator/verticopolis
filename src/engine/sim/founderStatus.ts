import type { SerializedGame } from "../serializedGame";

/**
 * Ground-floor recognition (2.0). A tower predates 2.0 (earns the badge) if it carries an
 * explicit flag (written by a prior 2.0+ re-save) OR its provenance appVersion
 * shows a pre-2.0 build (major below 2). `appVersion` is a file-layer stamp
 * SaveGame adds, not a serialize() field, so it is read off the raw save object.
 * Once detected, deserialize sets `sim.founder`, serialize persists the flag,
 * and a later re-save keeps it even though appVersion restamps to the current
 * build. A tower founded in 2.0+ has neither signal and is not a Founder.
 */
export function detectFounder(raw: SerializedGame): boolean {
  if ((raw as { founder?: unknown }).founder === true) return true;
  const appVer = (raw as { appVersion?: unknown }).appVersion;
  return typeof appVer === "string" && Number.parseInt(appVer, 10) < 2;
}

/**
 * File-load recognition of the OLDEST founding towers: a tower loaded from a
 * save FILE or storage slot with NO appVersion stamp predates the stamp itself
 * (added in v1.23.0) and so predates 2.0. It earns the badge here.
 *
 * This lives at the load-from-storage boundary on purpose, NOT in the shared
 * `detectFounder`/`deserialize`: an in-session `serialize()` snapshot (undo/redo,
 * crash report) is also stamp-free, so treating "no appVersion" as founding down
 * in deserialize would flip a brand-new 2.0 tower to Founder on the first undo
 * and then persist that on the next save. Only genuine file/slot loads
 * (loadResult, loadSlot, import) call this; undo snapshots never pass through
 * them, so a 2.0-born tower is never mislabeled. Idempotent and additive: it
 * only ever promotes to true, never clears an already-earned flag.
 */
export function markFounderFromLoadedFile(sim: { founder: boolean }, raw: { appVersion?: unknown }): void {
  if (!sim.founder && raw.appVersion === undefined) sim.founder = true;
}
