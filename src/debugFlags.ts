/**
 * Debug flags read from the page URL (#645): `?debug=fps` turns on the frame
 * statistics overlay, and `?debug=all` turns on every flag. Several flags go
 * comma-separated (`?debug=fps,other`). Nothing here runs per frame; the boot
 * reads the flags once.
 */

/** One named constant per debug flag, as it is spelled in the URL. */
export const DEBUG_FLAG = {
  /** The frame statistics overlay (`src/debugHud.ts`). */
  fps: "fps",
} as const;

export type DebugFlag = (typeof DEBUG_FLAG)[keyof typeof DEBUG_FLAG];

/** The URL value that turns on every flag. */
export const DEBUG_ALL = "all";

/** Whether `flag` is on in the query string `search` (`location.search`). */
export function debugFlagOn(search: string, flag: DebugFlag): boolean {
  const raw = new URLSearchParams(search).get("debug") ?? "";
  const flags = raw.split(",").map((f) => f.trim().toLowerCase());
  return flags.includes(flag) || flags.includes(DEBUG_ALL);
}
