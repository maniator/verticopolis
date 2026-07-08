import type { PlatformPort } from "./types";
import { browserPlatform } from "./browser";

/** A wrapper injection is untrusted input: accept it only when it carries the
 *  full port surface, so a shell bug degrades to the browser path instead of
 *  crashing export or the help dialog. The flag must be literally `true`; an
 *  injected port that claims not to be a wrapper is a contract violation
 *  (types.ts), not a third mode. */
function isPlatformPort(value: unknown): value is PlatformPort {
  if (typeof value !== "object" || value === null) return false;
  // Even the property reads are untrusted: a throwing getter or revoked Proxy
  // must degrade like any other malformed injection, not throw out of boot.
  try {
    const port = value as Record<string, unknown>;
    return (
      port.isNativeWrapper === true &&
      typeof port.saveFile === "function" &&
      typeof port.openExternal === "function"
    );
  } catch {
    return false;
  }
}

/** Resolution order (mobile-distribution arch §2): only the native bundle may
 *  bind a wrapper port, and only through a well-formed `__VC_PLATFORM__`
 *  global; everything else gets the browser default. Pure so the order is
 *  unit-testable without faking the build mode. */
export function resolvePlatform(mode: string, injected: unknown): PlatformPort {
  if (mode !== "native") return browserPlatform;
  if (!isPlatformPort(injected)) {
    // A native bundle that carries a broken injection is a wrapper-shell bug;
    // say so where the shell author will look (a bare native bundle with no
    // injection at all is a legitimate preview, so stay quiet for undefined).
    if (injected !== undefined) {
      console.warn("[platform] Ignoring malformed __VC_PLATFORM__ injection; using the browser platform.");
    }
    return browserPlatform;
  }
  return injected;
}

let resolved: PlatformPort | undefined;

/** The game's platform port. Resolved once and cached; the wrapper shell sets
 *  `__VC_PLATFORM__` before any game script runs, so the first call (whenever
 *  it happens) already sees the injection. */
export function getPlatform(): PlatformPort {
  resolved ??= resolvePlatform(import.meta.env.MODE, globalThis.__VC_PLATFORM__);
  return resolved;
}
