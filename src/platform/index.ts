import type { PlatformPort } from "./types";
import { browserPlatform } from "./browser";

/** A wrapper injection is untrusted input: accept it only when it carries the
 *  full port surface, so a shell bug degrades to the browser path instead of
 *  crashing export or the help dialog. */
function isPlatformPort(value: unknown): value is PlatformPort {
  if (typeof value !== "object" || value === null) return false;
  const port = value as Record<string, unknown>;
  return (
    typeof port.isNativeWrapper === "boolean" &&
    typeof port.saveFile === "function" &&
    typeof port.openExternal === "function"
  );
}

/** Resolution order (mobile-distribution arch §2): only the native bundle may
 *  bind a wrapper port, and only through a well-formed `__VC_PLATFORM__`
 *  global; everything else gets the browser default. Pure so the order is
 *  unit-testable without faking the build mode. */
export function resolvePlatform(mode: string, injected: unknown): PlatformPort {
  if (mode !== "native" || !isPlatformPort(injected)) return browserPlatform;
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
