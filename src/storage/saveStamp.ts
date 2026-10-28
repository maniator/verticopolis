import type { SaveText } from "./SaveGame";

/** Write-time provenance: when the save was written and by which build. */
export interface SaveStamp {
  savedAt: number;
  appVersion: string;
}

function nowMs(): number {
  // Date is unavailable in the deterministic engine, but the storage layer is
  // UI-side, so a wall-clock stamp here is fine.
  return typeof Date !== "undefined" ? Date.now() : 0;
}

/**
 * Stamp a save's text for writing. The engine never emits the stamp
 * (serialize() is stamp-free); every write path (localStorage and .vctower
 * alike) stamps here, so the values always describe THIS file, never a
 * previous device's.
 *
 * The two keys are written at the end of the object, where stamping the
 * parsed save and printing it again put them, so a save is stamped without a
 * parse of the whole tower. A text that already carries either key, or is no
 * object with keys, takes that parse instead.
 */
export function stampText(text: SaveText): { json: string; stamp: SaveStamp } {
  const stamp: SaveStamp = { savedAt: nowMs(), appVersion: typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "dev" };
  const keys = `"savedAt":${JSON.stringify(stamp.savedAt)},"appVersion":${JSON.stringify(stamp.appVersion)}`;
  const body = text.trimEnd();
  const spliceable =
    body.startsWith("{") && body.endsWith("}") && !/^\{\s*\}$/.test(body) && !body.includes('"savedAt"') && !body.includes('"appVersion"');
  if (spliceable) return { json: `${body.slice(0, -1)},${keys}}`, stamp };
  return { json: JSON.stringify(Object.assign(JSON.parse(text) as object, stamp)), stamp };
}
