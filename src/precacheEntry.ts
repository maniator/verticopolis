/**
 * Pure helpers for scripts/verify-precache.ts, kept apart so a unit test
 * (precacheEntry.test.ts) can pin them without a build. Node only (the build
 * check imports it); never imported by the app.
 *
 * Keep this file ERASABLE (see scripts/screenshot-env.ts) so `node` runs it
 * directly.
 */
import { isAbsolute, relative, resolve } from "node:path";

/**
 * The file under `dist` that a precache manifest URL names. The manifest is
 * generated, but it is still input: a URL that is absolute (a scheme, a
 * leading slash or backslash), escapes with `..`, or does not decode is
 * refused rather than resolved, so the size and presence checks can never
 * read outside the build.
 */
export function precacheFile(dist: string, url: string): string {
  const path = url.split(/[?#]/)[0];
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    throw new Error(`precache entry ${url} is not a valid URL path`);
  }
  if (decoded === "" || /^[a-z][a-z0-9+.-]*:/i.test(decoded) || /^[\\/]/.test(decoded) || decoded.includes("\\")) {
    throw new Error(`precache entry ${url} is not a relative path inside dist/`);
  }
  if (decoded.split("/").includes("..")) throw new Error(`precache entry ${url} climbs out of dist/`);
  const file = resolve(dist, decoded);
  const within = relative(dist, file);
  if (within === "" || within.startsWith("..") || isAbsolute(within)) {
    throw new Error(`precache entry ${url} resolves outside dist/`);
  }
  return file;
}

/** The opt-in a build without the engine package must set, so a TypeScript-only
 *  build is always a decision someone made, never a missing step. */
export const ALLOW_NO_ENGINE = "VC_ALLOW_NO_ENGINE";

/** Whether this build may ship without the engine package. Every build must
 *  carry it (whatever hosts it) unless the opt-in is set to exactly "1". */
export function engineOptional(env: Record<string, string | undefined>): boolean {
  return env[ALLOW_NO_ENGINE] === "1";
}
