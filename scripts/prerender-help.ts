/**
 * Post-build prerender for the standalone `/help` page (no-JS crawler
 * visibility). Runs as the second half of `npm run build` (which is exactly
 * what Vercel runs at deploy), after `vite build` has written `dist/`.
 *
 * How it works, and why this shape:
 *   1. It imports the BUILT help entry chunk (`dist/assets/help-*.js`) under a
 *      happy-dom document, so the exact code a browser would run renders the
 *      page: every Vite transform is already applied (the hashed
 *      `assets/help-media/<name>-<hash>.png` image URLs, the `__APP_VERSION__`
 *      define, minification). Rendering the source template in plain Node
 *      instead would fail on the `.png` imports and would not know the hashed
 *      asset names; rendering via a dev-server module loader would bake dev
 *      URLs. The built chunk is the only artifact that carries the real ones.
 *   2. The chunk's own `main()` renders `helpPageTemplate()` into `#app` and
 *      sets `window.helpReady`, the same readiness flag the screenshot tooling
 *      uses. No game code is involved; `/help` is fully static.
 *   3. Vite emits asset URLs in JS as `new URL(..., import.meta.url)`, which
 *      under Node resolve to `file://` URLs inside `dist/`. Those are rewritten
 *      to the `./assets/...` form `help.html` (served from the dist root) needs.
 *   4. The serialized markup replaces the whole `#app` contents in
 *      `dist/help.html`, including the noscript fallback: with the real guide
 *      prose present, the "needs JavaScript" note would be false. The SOURCE
 *      `src/help.html` keeps its noscript, so `vite dev` and any build that
 *      skips this step still degrade the way they always did.
 *
 * The client script still runs on load and re-renders the same template over
 * the container (see `src/helpPage.ts`, which removes the prerendered children
 * after a successful render so lit-html does not leave a duplicate, while a
 * render error keeps the prerendered guide on screen). The markup is
 * identical, so the swap is not visible; there is no hydration and none is
 * needed.
 *
 * This step needs only happy-dom, which is already a devDependency (it is the
 * vitest test environment), so the build gains no new dependency and stays
 * runnable in Vercel's browserless build container.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { Window } from "happy-dom";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = resolve(root, "dist");
const helpHtmlPath = resolve(distDir, "help.html");

function fail(msg: string): never {
  console.error(`prerender-help: ${msg}`);
  process.exit(1);
}

const helpHtml = readFileSync(helpHtmlPath, "utf8");

// The page's module entry, e.g. ./assets/help-CXcNic-V.js.
const entryMatch = helpHtml.match(/<script[^>]*type="module"[^>]*src="\.\/(assets\/help-[^"]+\.js)"/);
if (!entryMatch) fail("could not find the help entry chunk in dist/help.html");
const entryPath = resolve(distDir, entryMatch[1]);

// A DOM for the chunk to render into. The URL keeps the telemetry host gate
// closed (localhost is outside the allowed hosts), so nothing is injected.
const window = new Window({ url: "http://localhost/help" });
const { document } = window;
document.body.innerHTML = '<div id="app"></div>';

// lit-html's browser build reads `document` at module scope, so the globals
// must be in place before the chunk is imported.
const g = globalThis as unknown as Record<string, unknown>;
g.window = window;
for (const key of ["document", "navigator", "location", "history", "customElements", "HTMLElement", "Element", "Node", "MutationObserver", "CustomEvent", "Event", "localStorage", "sessionStorage"] as const) {
  // Installed via defineProperty because Node 22 exposes some of these
  // (navigator) as getter-only globals that plain assignment cannot replace.
  Object.defineProperty(g, key, {
    value: (window as unknown as Record<string, unknown>)[key],
    configurable: true,
    writable: true,
  });
}

await import(pathToFileURL(entryPath).href);

// A synchronous flag check, deliberately with no wait: the chunk's main() runs
// at module top level and renders synchronously, so helpReady is set by the
// time the import resolves. If this ever fails, either main() bailed (no #app)
// or someone deferred it (DOMContentLoaded, rAF); both need a script change
// here, so failing fast with a precise message beats polling.
if (!(window as unknown as { helpReady?: boolean }).helpReady) {
  fail("the help entry did not set window.helpReady synchronously; main() bailed or its render was deferred");
}

const app = document.getElementById("app");
if (!app) fail("#app disappeared during render");
let markup: string = app.innerHTML;

// `new URL(asset, import.meta.url)` resolved against the chunk's file URL;
// map those back to dist-root-relative URLs, the same shape help.html uses
// for its own stylesheet and script.
const chunkDirUrl = pathToFileURL(dirname(entryPath)).href;
markup = markup.replaceAll(`${chunkDirUrl}/`, "./assets/");
if (markup.includes("file://")) fail("a file:// URL survived the asset rewrite");

// Sanity: the guide prose must actually be there. These needles couple the
// build to the guide copy on purpose; they are the drift guard, so a reword of
// either sentence updates this list in the same change.
for (const needle of ["Floors first", "pixel-faithful to 1994"]) {
  if (!markup.includes(needle)) fail(`prerendered markup is missing "${needle}"`);
}

// Every figure must resolve to a real emitted file, and the count must match
// the compareFigures shortlist (5 pairs), so one broken or missing image
// cannot ship as long as another happens to be fine.
const EXPECTED_FIGURES = 10;
const srcs = [...markup.matchAll(/<img[^>]*\bsrc="([^"]*)"/g)].map((m) => m[1]);
if (srcs.length !== EXPECTED_FIGURES) {
  fail(`expected ${EXPECTED_FIGURES} figure images, found ${srcs.length}`);
}
for (const src of srcs) {
  if (!src.startsWith("./assets/help-media/")) fail(`figure src is not a hashed help-media URL: "${src}"`);
  try {
    readFileSync(resolve(distDir, src));
  } catch {
    fail(`figure src does not resolve to an emitted file: "${src}"`);
  }
}

// Swap the prerendered markup in as the whole #app contents (this replaces the
// noscript fallback; see the header comment). Match the closing </div> by
// scanning nested divs rather than trusting the current fallback's shape.
const open = '<div id="app">';
const start = helpHtml.indexOf(open);
if (start < 0) fail('could not find <div id="app"> in dist/help.html');
let depth = 1;
let i = start + open.length;
const tag = /<div\b|<\/div>/g;
tag.lastIndex = i;
let end = -1;
for (let m = tag.exec(helpHtml); m; m = tag.exec(helpHtml)) {
  depth += m[0] === "</div>" ? -1 : 1;
  if (depth === 0) {
    end = m.index;
    break;
  }
}
if (end < 0) fail('could not find the closing </div> of #app in dist/help.html');

const out = helpHtml.slice(0, start + open.length) + markup + helpHtml.slice(end);
writeFileSync(helpHtmlPath, out);

const kib = (markup.length / 1024).toFixed(1);
console.log(`prerender-help: injected ${kib} KiB of prerendered guide markup into dist/help.html`);
try {
  // Teardown only; the output is already written, so a teardown rejection must
  // not fail a build whose artifact is correct.
  await window.happyDOM.abort();
} catch {
  // ignored
}
process.exit(0);
