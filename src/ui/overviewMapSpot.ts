import type { MapLayoutClass } from "./overviewMapPrefs";
import type { Spot } from "./movableWindow";

/**
 * Where the player moved the Map window, per layout class, so a Map dragged
 * out of the way stays there on the next visit. Stored as "x,y" in whole CSS
 * px from the tower view's top-left corner; nothing is stored until the
 * player moves the window, and a double-click on its title bar forgets the
 * spot. Storage that is missing or throws reads as "nothing stored" and a
 * failed write is dropped, the way the open and closed choice works
 * (`overviewMapPrefs.ts`).
 */

export const MAP_SPOT_STORAGE_KEY: Readonly<Record<MapLayoutClass, string>> = {
  desktop: "vc-map-spot-desktop",
  phone: "vc-map-spot-phone",
};

/** "x,y": two whole numbers, neither negative. */
const SPOT_PATTERN = /^(\d{1,5}),(\d{1,5})$/;

/** The stored spot for a layout class, or null when there is none (or
 *  storage cannot be read, or holds something else). */
export function storedMapSpot(storage: Pick<Storage, "getItem"> | null | undefined, layout: MapLayoutClass): Spot | null {
  let raw: string | null = null;
  try {
    raw = storage ? storage.getItem(MAP_SPOT_STORAGE_KEY[layout]) : null;
  } catch {
    return null;
  }
  const match = raw === null ? null : SPOT_PATTERN.exec(raw);
  return match ? { x: Number(match[1]), y: Number(match[2]) } : null;
}

/** Store the spot the player chose, or forget it with null. Returns whether
 *  the write landed. */
export function rememberMapSpot(
  storage: Pick<Storage, "setItem" | "removeItem"> | null | undefined,
  layout: MapLayoutClass,
  spot: Spot | null,
): boolean {
  if (!storage) return false;
  try {
    if (spot) storage.setItem(MAP_SPOT_STORAGE_KEY[layout], `${Math.round(spot.x)},${Math.round(spot.y)}`);
    else storage.removeItem(MAP_SPOT_STORAGE_KEY[layout]);
    return true;
  } catch {
    return false;
  }
}
