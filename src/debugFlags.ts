/**
 * Debug flags (#645): `?debug=fps` in the page URL turns on the frame
 * statistics overlay, and `?debug=all` turns on every flag. Several flags go
 * comma-separated (`?debug=fps,other`).
 *
 * On a preview or staging deploy, and on the dev server, the same list can
 * also sit in localStorage under {@link DEBUG_STORAGE_KEY}, so a tester turns
 * the overlay on once (`localStorage.setItem("vc-debug", "fps")`) and keeps it
 * across reloads and links without the query string. Production ignores the
 * stored key, so a player's leftover storage never shows the overlay; the URL
 * flag works everywhere. Nothing here runs per frame; the boot reads the
 * flags once.
 */

/** One named constant per debug flag, as it is spelled in the URL. */
export const DEBUG_FLAG = {
  /** The frame statistics overlay (`src/debugHud.ts`). */
  fps: "fps",
} as const;

export type DebugFlag = (typeof DEBUG_FLAG)[keyof typeof DEBUG_FLAG];

/** The value that turns on every flag. */
export const DEBUG_ALL = "all";

/** The localStorage key that holds a stored flag list (preview, staging and
 *  dev only). */
export const DEBUG_STORAGE_KEY = "vc-debug";

function flagList(raw: string): string[] {
  return raw.split(",").map((f) => f.trim().toLowerCase());
}

/**
 * Whether `flag` is on in the query string `search` (`location.search`) or in
 * `stored`, a flag list read by {@link storedDebugFlags} (empty where stored
 * flags are not honored).
 */
export function debugFlagOn(search: string, flag: DebugFlag, stored = ""): boolean {
  const flags = [...flagList(new URLSearchParams(search).get("debug") ?? ""), ...flagList(stored)];
  return flags.includes(flag) || flags.includes(DEBUG_ALL);
}

/**
 * The stored flag list, or "" when stored flags are not honored here
 * (`honored` false: a production build) or storage cannot be read (a private
 * window or blocked site data throws on access).
 */
export function storedDebugFlags(honored: boolean): string {
  if (!honored) return "";
  try {
    return localStorage.getItem(DEBUG_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}
