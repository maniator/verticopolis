import type { SaveText } from "./SaveGame";

/** Write-time provenance: when the save was written and by which build. */
export interface SaveStamp {
  savedAt: number;
  appVersion: string;
}

/** The stamp a file written now carries: the time and this build's version. */
export function currentStamp(): SaveStamp {
  return { savedAt: nowMs(), appVersion: typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "dev" };
}

function nowMs(): number {
  // Date is unavailable in the deterministic engine, but the storage layer is
  // UI-side, so a wall-clock stamp here is fine.
  return typeof Date !== "undefined" ? Date.now() : 0;
}

/** Whether `body` has `word` (quotes included) as a key at any depth: its
 *  opening quote has an even run of backslashes before it, so it opens a
 *  string instead of sitting escaped inside one, and a colon follows the
 *  closing quote. In valid JSON a string with a colon after it is a key. A
 *  nested key never clashes with the top-level stamp, so taking the parse for
 *  one costs time and nothing else. Each hit is checked where `indexOf` finds
 *  it, so a save with no hit costs the one scan it always did. */
function hasKey(body: string, word: string): boolean {
  for (let at = body.indexOf(word); at >= 0; at = body.indexOf(word, at + 1)) {
    let slashes = 0;
    while (at - slashes - 1 >= 0 && body.charCodeAt(at - slashes - 1) === BACKSLASH) slashes++;
    if (slashes % 2 !== 0) continue;
    let next = at + word.length;
    while (next < body.length && /\s/.test(body[next])) next++;
    if (body[next] === ":") return true;
  }
  return false;
}

const BACKSLASH = 0x5c;

/**
 * Stamp a save's text for writing. The engine never emits the stamp
 * (serialize() is stamp-free); every write path (localStorage and .vctower
 * alike) stamps here, so the values always describe THIS file, never a
 * previous device's.
 *
 * The two keys are written at the end of the object, where stamping the
 * parsed save and printing it again put them, so a save is stamped without a
 * parse of the whole tower. A text that already carries either key, or is no
 * object with keys, takes that parse instead. Only a key counts: a tower name,
 * label or log line that spells `"savedAt"` sits inside a string, where its
 * quotes are escaped or no colon follows them, so it keeps the splice (#1443).
 */
export function stampText(text: SaveText): { json: string; stamp: SaveStamp } {
  const stamp = currentStamp();
  const keys = `"savedAt":${JSON.stringify(stamp.savedAt)},"appVersion":${JSON.stringify(stamp.appVersion)}`;
  const body = text.trimEnd();
  const spliceable =
    body.startsWith("{") &&
    body.endsWith("}") &&
    !/^\{\s*\}$/.test(body) &&
    !hasKey(body, '"savedAt"') &&
    !hasKey(body, '"appVersion"');
  if (spliceable) return { json: `${body.slice(0, -1)},${keys}}`, stamp };
  const data = JSON.parse(text) as Partial<SaveStamp>;
  data.savedAt = stamp.savedAt;
  data.appVersion = stamp.appVersion;
  return { json: JSON.stringify(data), stamp };
}
