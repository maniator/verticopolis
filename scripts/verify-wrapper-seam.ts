/**
 * Build-time guard for the wrapper command seam (see `src/game/hostCommands.ts`
 * and `IS_WRAPPED_BUILD` in `src/platform/index.ts`).
 *
 * The property being protected lives in the built artifact, where a source test
 * cannot see it. `hostCommands.ts` exists to serve a native shell's application
 * menu, so a browser bundle should not carry it at all: every player who loads
 * the web game would otherwise download a module that can never do anything.
 * `IS_WRAPPED_BUILD` is `false` under vitest whatever the source says, which
 * proves nothing about whether Rollup eliminated the branches and dropped the
 * module.
 *
 * So this greps the emitted JS, in both directions, because a one-sided check
 * is worthless: a browser bundle must NOT contain the seam, and a wrapped
 * bundle MUST. Without the positive case, a typo that eliminated the module
 * from every build would pass silently and the desktop menu would do nothing.
 *
 * Usage: `node scripts/verify-wrapper-seam.ts <browser|desktop|native>`
 *   browser  the seam must be absent  (wired into `postbuild`)
 *   desktop  the seam must be present (wired into `build:desktop`)
 *   native   the seam must be present
 *
 * Detection uses the seam's player-facing refusal copy, because minifiers
 * preserve string literals while mangling every identifier around them. If that
 * copy is ever reworded, this guard fails loudly and the markers below need
 * updating, which is the right failure direction for a guard.
 *
 * Keep this file ERASABLE (see screenshot-env.ts) so `node` runs it directly.
 */
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const DIST = resolve(dirname(fileURLToPath(import.meta.url)), "..", "dist");

/** Every emitted script under the dist, at any depth. Recursive on purpose: a
 *  flat `readdir` of `dist/assets` would silently narrow the scan the moment a
 *  chunk lands in a subdirectory, and the browser direction of this check fails
 *  OPEN (finding nothing reads as "correct"), so a narrowed scan would look like
 *  a pass. `.html` is included because an inlined script is still shipped code. */
function scripts(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...scripts(full));
    else if (/\.(js|mjs|cjs|html)$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** Literals that exist only inside the command seam. */
const MARKERS = [
  "Start or load a tower first",
  "Close the open window first",
  "Not available right now",
  "Finish what you are doing first",
  "Ignoring unknown host command",
];

function fail(msg: string): never {
  console.error(`verify-wrapper-seam: ${msg}`);
  process.exit(1);
}

const arg = process.argv[2];
if (arg !== "browser" && arg !== "desktop" && arg !== "native") {
  fail(`expected one of browser|desktop|native as the first argument; got ${arg === undefined ? "nothing" : `"${arg}"`}`);
}
const shouldBePresent = arg !== "browser";

let files: string[];
try {
  files = scripts(DIST);
} catch (e) {
  fail(`could not read ${DIST} (run the build first): ${e instanceof Error ? e.message : String(e)}`);
}
if (files.length === 0) fail(`no scripts under ${DIST}; did the build output format change?`);

// Read each file once and test every marker against it, rather than re-reading
// the whole dist per marker.
const found = new Set<string>();
for (const file of files) {
  const text = readFileSync(file, "utf8");
  for (const marker of MARKERS) if (text.includes(marker)) found.add(marker);
}

if (shouldBePresent && found.size !== MARKERS.length) {
  const missing = MARKERS.filter((m) => !found.has(m));
  fail(
    `a "${arg}" build must CONTAIN the command seam, but ${missing.length} of ${MARKERS.length} markers are missing ` +
      `(${missing.map((m) => JSON.stringify(m)).join(", ")}). Either the seam was eliminated from a wrapped build, ` +
      `which would leave the native menu doing nothing, or the refusal copy changed and MARKERS needs updating.`,
  );
}

if (!shouldBePresent && found.size > 0) {
  fail(
    `a browser build must NOT contain the command seam, but found ${[...found].map((m) => JSON.stringify(m)).join(", ")}. ` +
      `Two ways to get here. If you meant to build a wrapper bundle, use \`npm run build:desktop\` rather than ` +
      `\`npm run build -- --mode desktop\`, because the plain build's postbuild checks for a BROWSER bundle. ` +
      `Otherwise a new unguarded caller of src/game/hostCommands.ts has pulled it back into every player's bundle: ` +
      `the IS_WRAPPED_BUILD guards in appBoot.ts and frameLoop.ts are what let Rollup drop it.`,
  );
}

console.log(
  `verify-wrapper-seam: ${arg} build is correct (command seam ${shouldBePresent ? "present" : "absent"}, ` +
    `${files.length} file${files.length === 1 ? "" : "s"} scanned)`,
);
