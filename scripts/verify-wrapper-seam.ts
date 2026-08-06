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

/**
 * Each seam is a set of literals that exist ONLY inside it. Both are checked in
 * both directions, and a seam is verified independently so a failure names
 * which one moved.
 *
 * Detection uses string literals because minifiers preserve them while mangling
 * every identifier around them.
 */
interface Seam {
  readonly name: string;
  readonly markers: readonly string[];
  /** Appended to the browser-direction failure: what pulled it back in. */
  readonly guardHint: string;
  /**
   * Markers that only ship once a runtime gate opens, checked for ABSENCE in a
   * browser build like any other but not required in a wrapped one yet.
   *
   * Splitting them is what keeps both directions alive on a partly-gated seam.
   * Requiring them failed honestly-correct desktop builds; dropping the whole
   * positive direction stopped watching for a seam that vanished everywhere.
   */
  readonly gatedMarkers?: readonly string[];
  /**
   * Require each marker to be a COMPLETE string literal rather than a substring.
   *
   * Off by default because the command seam's markers are fragments of longer
   * messages (the refusal copy is interpolated: "[platform] Ignoring unknown
   * host command: ${command}"), so demanding a whole literal would fail a
   * correct build. On for seams whose markers really are whole literals, where
   * a bare substring test fails OPEN: "auto-legacy" matched "auto-legacyX", so
   * renaming a marker to a superset kept the check green while the literal it
   * was watching no longer existed.
   */
  readonly wholeLiterals?: boolean;
}

const SEAMS: readonly Seam[] = [
  {
    name: "command seam",
    markers: [
      "Start or load a tower first",
      "Close the open window first",
      "Not available right now",
      "Finish what you are doing first",
      "Ignoring unknown host command",
      // The quit-time flush (story D6): its failure log is the one literal
      // unique to the flush binding, so its presence proves the binding
      // shipped in a wrapped build and its absence proves the browser fold.
      "Quit-time flush failed",
    ],
    guardHint:
      "a new unguarded caller of src/game/hostCommands.ts has pulled it back into every player's bundle: " +
      "the IS_WRAPPED_BUILD guards in appBoot.ts and frameLoop.ts are what let Rollup drop it.",
  },
  {
    name: "save store",
    // Migration outcomes and slot ids that appear nowhere else. `VCZ1` and
    // `simtower-clone-unreadable` are deliberately NOT here: both live in
    // SaveGame.ts, which every build ships.
    //
    // The write path is LIVE (the tripwire is deleted; hydration itself is the
    // gate), so the migration outcomes and the account-isolation refusal must
    // all ship in a wrapped build. `origin-gone` going missing would mean the
    // account-isolation refusal was eliminated, which is the one failure here
    // that costs privacy.
    markers: ["auto-legacy", "already-present", "write-failed", "origin-gone"],
    // These are whole literals (slot ids and outcome names), so they can be
    // matched exactly rather than by substring.
    wholeLiterals: true,
    guardHint:
      "something now imports src/game/desktopSaveStore.ts (or the storage modules under it) outside an " +
      "IS_WRAPPED_BUILD branch, so every web player downloads a save store and a localStorage migration that " +
      "can never run. Note that `if (port.saveStore)` does NOT fold: only IS_WRAPPED_BUILD does, because Vite " +
      "statically replaces import.meta.env.MODE.",
  },
];

/**
 * Whether the emitted JS contains this marker as a WHOLE string literal.
 *
 * A bare `includes` fails OPEN on supersets: `auto-legacy` matched
 * `auto-legacyX`, so renaming a marker to something longer kept the desktop
 * check green while the literal it was watching no longer existed. Minifiers
 * preserve string literals along with their quotes and may pick either style,
 * so both are tried, plus the template form.
 */
function containsLiteral(text: string, marker: string): boolean {
  return ['"', "'", "`"].some((q) => text.includes(q + marker + q));
}

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

// Read each file ONCE and test every marker of every seam against it, rather
// than re-reading the whole dist per marker.
const texts = files.map((f) => readFileSync(f, "utf8"));
const foundBySeam = new Map<string, Set<string>>();
for (const seam of SEAMS) {
  const found = new Set<string>();
  for (const text of texts) {
    for (const marker of [...seam.markers, ...(seam.gatedMarkers ?? [])]) {
      if (seam.wholeLiterals ? containsLiteral(text, marker) : text.includes(marker)) found.add(marker);
    }
  }
  foundBySeam.set(seam.name, found);
}

/**
 * BROWSER-ONLY surfaces: the inverse polarity of SEAMS. The Help dialog's
 * full-page link is withheld from wrapped builds (#720: target=_blank is
 * denied there and /help is an extensionless route the app protocol cannot
 * serve), and the withholding lives in Rollup's constant folding, which no
 * unit test can see: the wrapped-mode test mocks the constant, and a
 * reordered && chain silently stops folding (demonstrated in review by
 * swapping the operands: every test stayed green while the desktop bundle
 * shipped the dead link again). The dist is the only place the property
 * exists, so the dist is where it is checked, in both directions.
 */
const BROWSER_ONLY: readonly { name: string; marker: string; guardHint: string }[] = [
  {
    name: "help full-page link",
    marker: "Open the full help page",
    guardHint:
      "the !IS_WRAPPED_BUILD gate in src/ui/templates/help.ts stopped folding. The constant must LEAD the " +
      "&& chain; in trailing position Rollup keeps the branch, which is exactly how this regressed in review.",
  },
];
for (const item of BROWSER_ONLY) {
  const present = texts.some((t) => t.includes(item.marker));
  if (shouldBePresent && present) {
    fail(`a "${arg}" build must NOT contain the ${item.name} (${JSON.stringify(item.marker)}): ${item.guardHint}`);
  }
  if (!shouldBePresent && !present) {
    fail(
      `a browser build must CONTAIN the ${item.name} (${JSON.stringify(item.marker)}); either the copy was ` +
        `reworded (update BROWSER_ONLY to match) or the surface was eliminated from every build.`,
    );
  }
}

for (const seam of SEAMS) {
  const found = foundBySeam.get(seam.name)!;
  const expectPresent = shouldBePresent;

  // Presence is required only of the UNGATED markers.
  const requiredPresent = seam.markers.filter((m) => !found.has(m));
  if (expectPresent && requiredPresent.length > 0) {
    const missing = requiredPresent;
    fail(
      `a "${arg}" build must CONTAIN the ${seam.name}, but ${missing.length} of ${seam.markers.length} markers ` +
        `are missing (${missing.map((m) => JSON.stringify(m)).join(", ")}). Either it was eliminated from a ` +
        `wrapped build, which would leave the feature silently doing nothing, or one of those literals was ` +
        `reworded and SEAMS needs updating. This positive direction exists because a typo that dropped the ` +
        `module from EVERY build would otherwise pass the browser check silently.`,
    );
  }

  if (!shouldBePresent && found.size > 0) {
    fail(
      `a browser build must NOT contain the ${seam.name}, but found ` +
        `${[...found].map((m) => JSON.stringify(m)).join(", ")}. Two ways to get here. If you meant to build a ` +
        `wrapper bundle, use \`npm run build:desktop\` rather than \`npm run build -- --mode desktop\`, because ` +
        `the plain build's postbuild checks for a BROWSER bundle. Otherwise ${seam.guardHint}`,
    );
  }
}

console.log(
  `verify-wrapper-seam: ${arg} build is correct (` +
    SEAMS.map((s) => {
      if (!shouldBePresent) return `${s.name} absent`;
      const partly = (s.gatedMarkers?.length ?? 0) > 0;
      return `${s.name} present${partly ? " (gated parts not yet expected)" : ""}`;
    }).join(", ") +
    `, ${files.length} file${files.length === 1 ? "" : "s"} scanned)`,
);
