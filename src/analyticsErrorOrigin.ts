/**
 * Whether an uncaught error came from a browser extension rather than the game.
 *
 * Extensions such as wallet injectors run their own scripts inside every page
 * they visit, and an unhandled rejection from one reaches the game's `window`
 * listeners like any other. The game cannot fix those errors, and their class
 * names are the extension's own minified ones (MetaMask's "Failed to connect"
 * error reported as type `i`), so they only add noise to the error report.
 *
 * The rule is deliberately narrow: an error is the extension's only when the
 * browser names an extension script as its source, or when its stack has at
 * least one frame and every frame points at an extension script. One frame from
 * the game's own code, or one whose location the check cannot place (a `blob:`
 * worker, `<anonymous>`), keeps the report, and so does a stack with no frames at
 * all (a cross-origin "Script error.", a thrown string), because nothing in it
 * proves where it came from.
 */

/** URL schemes browsers give extension scripts (Chromium, Firefox, Safari, and
 *  legacy Edge). */
const EXTENSION_SCHEMES: ReadonlySet<string> = new Set([
  "chrome-extension",
  "moz-extension",
  "safari-extension",
  "safari-web-extension",
  "ms-browser-extension",
]);

/** The script location of one stack frame line, or null when the line is
 *  not a frame. Two formats: V8's `at fn (location)` and `at location`, anchored
 *  to the line start so a URL inside V8's leading `Type: message` line is not
 *  read as a frame, and Gecko/WebKit's `fn@location`. Any frame line counts,
 *  whatever its location looks like (`blob:`, `<anonymous>`, `native`), so a
 *  frame the check cannot place keeps the report. */
function frameLocation(line: string): string | null {
  const v8 = /^\s*at\s+(.*)$/.exec(line);
  if (v8) {
    // An eval frame (`at eval (eval at f (origin), <anonymous>:1:1)`) names
    // where the eval was called, not what ran, so its location is unplaced.
    if (v8[1].includes("eval at ")) return v8[1];
    const open = v8[1].lastIndexOf("(");
    return open >= 0 ? v8[1].slice(open + 1) : v8[1];
  }
  const at = line.indexOf("@");
  return at >= 0 ? line.slice(at + 1) : null;
}

/** The URL scheme of a script location, lower-cased, or null when it has none. */
function schemeOf(location: string): string | null {
  const match = /^([a-z][a-z0-9+.-]*):\/\//i.exec(location.trim());
  return match ? match[1].toLowerCase() : null;
}

/** True when `location` is a script served by a browser extension. */
function isExtensionLocation(location: string): boolean {
  const scheme = schemeOf(location);
  return scheme !== null && EXTENSION_SCHEMES.has(scheme);
}

/**
 * True when the error belongs to a browser extension: the `error` event names an
 * extension script as its `source`, or the stack has frames and all of them sit
 * in extension scripts. See the module comment for why the rule keeps anything
 * with a frame it cannot place as an extension's.
 */
export function isBrowserExtensionError(stack: string, source?: string): boolean {
  if (source && isExtensionLocation(source)) return true;
  let frames = 0;
  for (const line of stack.split("\n")) {
    const location = frameLocation(line);
    if (location === null) continue;
    frames += 1;
    if (!isExtensionLocation(location)) return false;
  }
  return frames > 0;
}
