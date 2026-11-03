/**
 * Whether the overview MAP window (#343) is open, per layout class (SPEC,
 * CAP-1). Desktop opens it by default and phone keeps it closed. Only an
 * explicit open or close by the player is stored, never the default, so a
 * player who never touched it keeps following the default if it changes. The
 * two layout classes have separate keys: closing the Map on a phone does not
 * close it on a desktop in the same browser. Storage that is missing or throws
 * (private mode, a full quota, a blocked origin) reads as "nothing stored" and
 * a failed write is dropped, so the page never breaks over a preference. Get
 * the store through `browserStorage()`: on a blocked origin, merely reading
 * `window.localStorage` throws.
 */

/** The game's two layout classes, as `mobileMq` in `src/main.ts` splits them
 *  (the tablet tier counts as desktop). */
export type MapLayoutClass = "desktop" | "phone";

export const MAP_OPEN_STORAGE_KEY: Readonly<Record<MapLayoutClass, string>> = {
  desktop: "vc-map-open-desktop",
  phone: "vc-map-open-phone",
};

/** The stored values: an explicit open and an explicit close. */
export const MAP_OPEN_VALUE = { open: "open", closed: "closed" } as const;

/** The default when the player has made no choice in this layout class. */
export function mapOpenByDefault(layout: MapLayoutClass): boolean {
  return layout === "desktop";
}

/** The browser's local storage, or null where reading it throws or there is
 *  none. */
export function browserStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

type ReadStore = Pick<Storage, "getItem">;
type WriteStore = Pick<Storage, "setItem">;

/** The player's stored choice for a layout class, or null when there is none
 *  (or storage cannot be read, or holds something else). */
export function storedMapOpen(storage: ReadStore | null | undefined, layout: MapLayoutClass): boolean | null {
  let raw: string | null = null;
  try {
    raw = storage ? storage.getItem(MAP_OPEN_STORAGE_KEY[layout]) : null;
  } catch {
    return null;
  }
  if (raw === MAP_OPEN_VALUE.open) return true;
  if (raw === MAP_OPEN_VALUE.closed) return false;
  return null;
}

/** Whether the Map starts open in a layout class: the stored choice, or the
 *  layout's default. */
export function mapStartsOpen(storage: ReadStore | null | undefined, layout: MapLayoutClass): boolean {
  return storedMapOpen(storage, layout) ?? mapOpenByDefault(layout);
}

/** Store an explicit open or close for a layout class. Returns whether the
 *  write landed; a failed write changes nothing on screen. */
export function rememberMapOpen(storage: WriteStore | null | undefined, layout: MapLayoutClass, open: boolean): boolean {
  if (!storage) return false;
  try {
    storage.setItem(MAP_OPEN_STORAGE_KEY[layout], open ? MAP_OPEN_VALUE.open : MAP_OPEN_VALUE.closed);
    return true;
  } catch {
    return false;
  }
}
