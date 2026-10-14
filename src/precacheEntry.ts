/**
 * Pure helpers for scripts/verify-precache.ts, kept apart so a unit test
 * (precacheEntry.test.ts) can pin them without a build. Node only (the build
 * check imports it); never imported by the app.
 *
 * Keep this file ERASABLE (see scripts/screenshot-env.ts) so `node` runs it
 * directly.
 */
import { isAbsolute, relative, resolve, sep } from "node:path";

/**
 * The file under `dist` that a precache manifest URL names. The manifest is
 * generated, but it is still input. A URL that is absolute (a scheme, a
 * leading slash or backslash), escapes with `..`, carries a control
 * character, or does not decode is refused, so the size and presence checks
 * only ever name files inside the build. This check is lexical; the caller
 * also checks the real path (a symlink in dist/ could point anywhere).
 */
export function precacheFile(dist: string, url: string): string {
  const path = url.split(/[?#]/)[0];
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    throw new Error(`precache entry ${url} is not a valid URL path`);
  }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(decoded)) throw new Error(`precache entry ${url} has a control character in its path`);
  if (decoded === "" || /^[a-z][a-z0-9+.-]*:/i.test(decoded) || /^[\\/]/.test(decoded) || decoded.includes("\\")) {
    throw new Error(`precache entry ${url} is not a relative path inside dist/`);
  }
  if (decoded.split("/").includes("..")) throw new Error(`precache entry ${url} climbs out of dist/`);
  const file = resolve(dist, decoded);
  const within = relative(dist, file);
  if (within === "" || within === ".." || within.startsWith(`..${sep}`) || isAbsolute(within)) {
    throw new Error(`precache entry ${url} resolves outside dist/`);
  }
  return file;
}

/** The opt-in for a build that deliberately ships without the engine
 *  package (a checkout with no Rust toolchain, a CI job that only proves the
 *  bundle compiles). */
export const ALLOW_NO_ENGINE = "VC_ALLOW_NO_ENGINE";

/**
 * Why this build must stop for its engine package, or null when it may go on.
 * Every build needs the engine, whatever hosts it. The opt-in (exactly "1")
 * lets a local or CI build skip it, and a deploy (VERCEL=1) refuses the
 * opt-in: what reaches players always carries the engine.
 */
export function missingEngine(env: Record<string, string | undefined>, builtEngine: boolean): string | null {
  if (builtEngine) return null;
  const how = "build it first (npm run wasm:build, or scripts/build-engine-wasm.sh)";
  if (env.VERCEL === "1") {
    return `this deploy has no engine package in dist/, and a deploy must ship the WASM engine (${ALLOW_NO_ENGINE} does not apply to one); ${how}`;
  }
  if (env[ALLOW_NO_ENGINE] === "1") return null;
  const seen = env[ALLOW_NO_ENGINE] === undefined ? "" : ` (${ALLOW_NO_ENGINE} is ${JSON.stringify(env[ALLOW_NO_ENGINE])}, and only "1" opts in)`;
  return `this build has no engine package in dist/, so it would ship without the WASM engine; ${how}, or set ${ALLOW_NO_ENGINE}=1 for a deliberate TypeScript-only build${seen}`;
}
