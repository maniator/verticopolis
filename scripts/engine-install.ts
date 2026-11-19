/**
 * Copy the engine's browser build from the installed `@verticopolis/engine`
 * package into src/public/engine/, where the game serves it. The engine is
 * built and published from Verticopolis/engine; the game pins a version in
 * package.json and runs that version's bytes, so nothing here compiles Rust.
 *
 * `npm install` runs this (`postinstall`), and so does the Vercel build
 * (scripts/vercel-build.sh), whose cached install skips npm's scripts. The
 * tooling build (`@verticopolis/engine/tooling`, with the binding's tier 3
 * ops) is read in place from node_modules by vite.config.ts and the tests.
 */
import { cpSync, existsSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

let from: string;
try {
  from = join(dirname(require.resolve("@verticopolis/engine/package.json")), "web");
} catch {
  // A partial install (npm ci --omit=dev in a container that never builds the
  // game) has no engine; the build's own package check reports that.
  console.warn("engine-install: @verticopolis/engine is not installed; src/public/engine is left as it is");
  process.exit(0);
}
if (!existsSync(join(from, "BUILD.json"))) throw new Error(`engine-install: ${from} has no BUILD.json; reinstall @verticopolis/engine`);

const to = join(repo, "src/public/engine");
rmSync(to, { recursive: true, force: true });
// The type declarations stay in the package: the page serves only the files
// the engine's record describes.
cpSync(from, to, { recursive: true, filter: (src) => !src.endsWith(".d.ts") });
console.log(`engine-install: src/public/engine now holds ${require("@verticopolis/engine/package.json").version as string}`);
