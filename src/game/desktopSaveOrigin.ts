import type { SaveScopeToken } from "../platform/saveStore";
import { isSaveSlotId } from "../storage/saveMigration";
import type { SaveAddress } from "../storage/saveStoreSession";

/**
 * The live tower's ORIGIN: which stored address it was loaded from, or nothing
 * for a tower that has never been stored (a new game, an import). Split out of
 * `desktopSaveStore.ts` at the 500-line guard; that module remains the only
 * production consumer.
 *
 * Module state rather than a value threaded through call sites because there
 * is exactly one live tower, and a second source of truth for "which tower is
 * loaded" is how the two get to disagree.
 */

let loadedFrom: SaveAddress | undefined;

/** Whether {@link loadedFrom}'s scope was the shared one, remembered at the
 *  moment it was resolved so the question survives the session going away. */
let loadedFromShared = false;

/** Where each hydrated slot came from, keyed by slot id. Captured during
 *  hydration, the one moment the store's answer and localStorage are known to
 *  agree. */
const hydratedOrigins = new Map<string, SaveAddress>();

export function towerOrigin(): SaveAddress | undefined {
  return loadedFrom;
}

export function towerOriginShared(): boolean {
  return loadedFromShared;
}

/** Record where the live tower came from; `sharedScope` is the session's, so
 *  shared-ness is remembered alongside the address. */
export function noteTowerOrigin(address: SaveAddress | undefined, sharedScope: SaveScopeToken | undefined): void {
  loadedFrom = address;
  loadedFromShared = address !== undefined && address.scope === sharedScope;
}

/** Adopt an origin ONLY when none exists (a first save of an origin-less
 *  tower). Guarded on absence: an unconditional assignment once overwrote the
 *  id, so a tower opened from slot-2 reported `auto` after one autosave. */
export function adoptOriginIfUnset(address: SaveAddress, shared: boolean): void {
  if (loadedFrom === undefined) {
    loadedFrom = address;
    loadedFromShared = shared;
  }
}

/** Replace the hydrated-origin map wholesale (hydration success only). */
export function recordHydratedOrigins(origins: ReadonlyMap<string, SaveAddress>): void {
  hydratedOrigins.clear();
  for (const [id, address] of origins) hydratedOrigins.set(id, address);
}

/** The hydrated origin for a slot id, or undefined. */
export function hydratedOriginFor(id: string): SaveAddress | undefined {
  return hydratedOrigins.get(id);
}

/**
 * Note the live tower's origin from the slot it was LOADED from, or clear it
 * for a tower with no stored origin. For "auto", falls back to the
 * `auto-legacy` record when the store holds no `auto` record, mirroring
 * `loadResult`'s own key fallback (the present-but-corrupt-primary gap is
 * documented in the D3 story and deferred with the write-routing work).
 */
export function noteTowerOriginForSlot(
  slot: number | "auto" | undefined,
  sharedScope: SaveScopeToken | undefined,
): void {
  if (slot === undefined) {
    noteTowerOrigin(undefined, sharedScope);
    return;
  }
  if (slot === "auto") {
    noteTowerOrigin(hydratedOrigins.get("auto") ?? hydratedOrigins.get("auto-legacy"), sharedScope);
    return;
  }
  const id = `slot-${slot}`;
  // Membership-tested rather than cast: a slot number outside the closed list
  // maps to no id and therefore to no origin, never to a synthesized one.
  noteTowerOrigin(isSaveSlotId(id) ? hydratedOrigins.get(id) : undefined, sharedScope);
}

/** Test seam, mirrored by `resetSaveStoreForTests`. */
export function resetOriginForTests(): void {
  loadedFrom = undefined;
  loadedFromShared = false;
  hydratedOrigins.clear();
}
