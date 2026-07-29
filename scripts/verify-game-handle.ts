/**
 * Build-time guard for the `window.game` tooling gate (see bootstrap.ts and
 * the `__TOOLING_BUILD__` define in vite.config.ts). The security property of
 * this feature lives in the BUILT artifact: a production bundle must carry no
 * `window.game` publish (players could otherwise cheat from the console), and
 * a tooling bundle must carry it (e2e, screenshots, and perf all drive the
 * app through it, and would otherwise time out mutely). Source-level tests
 * cannot see whether Vite's define + minify actually dead-code-eliminated the
 * branch, so this runs from postbuild and asserts the dist matches the mode
 * of the build that just produced it: with VC_TOOLING=1 the handle must be
 * present, without it the handle must be absent. Every `npm run build` (local
 * and every CI lane, the Vercel deploy included) fails loudly on a mismatch.
 *
 * Detection greps the emitted JS for a `.game=`/`.game =` property assignment
 * (minifiers keep property names). Nothing else in the app assigns a `.game`
 * property; if that ever changes, this guard fails loudly and the pattern
 * below needs narrowing, which is the right failure direction for a guard.
 *
 * Keep this file ERASABLE (see screenshot-env.ts) so `node` runs it directly.
 */
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const ASSETS = resolve(dirname(fileURLToPath(import.meta.url)), "..", "dist", "assets");

function fail(msg: string): never {
  console.error(`verify-game-handle: ${msg}`);
  process.exit(1);
}

const tooling = process.env.VC_TOOLING === "1";

let files: string[];
try {
  files = readdirSync(ASSETS).filter((f) => f.endsWith(".js"));
} catch (e) {
  fail(`could not read ${ASSETS} (run the build first): ${e instanceof Error ? e.message : String(e)}`);
}
if (files.length === 0) fail(`no JS bundles under ${ASSETS}; did the build output format change?`);

// A `.game =` property assignment (not `==`/`===`), the shape the publish in
// bootstrap.ts minifies to. `window.game` is matched too in case a future
// bundler keeps the longhand.
const HANDLE = /\.game\s*=[^=]|window\.game/;
const carriers = files.filter((f) => HANDLE.test(readFileSync(join(ASSETS, f), "utf8")));

if (tooling && carriers.length === 0) {
  fail(
    "VC_TOOLING=1 build, but no bundle publishes window.game; the tooling gate in bootstrap.ts " +
      "or the __TOOLING_BUILD__ define may have regressed. e2e/screenshots/perf would time out against this dist.",
  );
}
if (!tooling && carriers.length > 0) {
  fail(
    `production build, but ${carriers.join(", ")} still publishes window.game; the console handle must ` +
      "never ship to players. Check the __TOOLING_BUILD__ gate in bootstrap.ts and the define in vite.config.ts.",
  );
}
console.log(
  tooling
    ? `verify-game-handle: tooling build publishes window.game (${carriers.join(", ")})`
    : `verify-game-handle: production build ships no window.game handle (${files.length} bundles scanned)`,
);
