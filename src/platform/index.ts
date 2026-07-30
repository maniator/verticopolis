import type { PlatformPort } from "./types";
import { browserPlatform } from "./browser";

/** A wrapper injection is untrusted input: accept it only when it carries the
 *  full port surface, so a shell bug degrades to the browser path instead of
 *  crashing export or the help dialog. The flag must be literally `true`; an
 *  injected port that claims not to be a wrapper is a contract violation
 *  (types.ts), not a third mode.
 *
 *  The command members are checked as OPTIONAL on purpose. Shells built against
 *  the three-member revision of this contract (the iOS Capacitor shell) must
 *  keep validating: demanding a fourth would demote them here, silently, and
 *  take their native file save with them. Present-but-not-callable is still a
 *  malformed injection, since the game would throw on it at boot. */
function isPlatformPort(value: unknown): value is PlatformPort {
  if (typeof value !== "object" || value === null) return false;
  // Even the property reads are untrusted: a throwing getter or revoked Proxy
  // must degrade like any other malformed injection, not throw out of boot.
  try {
    const port = value as Record<string, unknown>;
    const optionalFn = (v: unknown) => v === undefined || typeof v === "function";
    return (
      port.isNativeWrapper === true &&
      typeof port.saveFile === "function" &&
      typeof port.openExternal === "function" &&
      optionalFn(port.onHostCommand) &&
      optionalFn(port.setCommandsAvailable)
    );
  } catch {
    return false;
  }
}

/** True for builds meant to run inside a wrapper shell rather than a browser
 *  tab: `--mode native` (the iOS Capacitor shell) and `--mode desktop` (the
 *  Electron shell). Wrapped builds skip service-worker registration and the
 *  update poll (updates come from the store or the wrapper's own channel),
 *  offer no PWA install affordance, keep the telemetry host gate closed, and
 *  may bind an injected platform port. Pure so every gate that consults it is
 *  unit-testable without faking the build mode. */
export function isWrappedMode(mode: string): boolean {
  return mode === "native" || mode === "desktop";
}

/**
 * The same question answered at BUILD time, so wrapper-only code can be dropped
 * from a browser bundle entirely rather than shipped and skipped.
 *
 * Written as literal comparisons on purpose. Vite statically replaces
 * `import.meta.env.MODE`, so this folds to `false` in a browser build and
 * Rollup eliminates every `if (IS_WRAPPED_BUILD)` branch, which in turn leaves
 * `src/game/hostCommands.ts` unreferenced and drops it from the graph.
 * `isWrappedMode(import.meta.env.MODE)` would NOT fold: Rollup does not inline
 * a cross-module call to decide a branch is dead, so the module would ship to
 * every browser player and merely do nothing.
 *
 * The duplicated literals are pinned against the predicate in
 * `platform.test.ts`, so the two cannot drift.
 */
export const IS_WRAPPED_BUILD = import.meta.env.MODE === "native" || import.meta.env.MODE === "desktop";

/** Resolution order: only a wrapped bundle may bind a wrapper port, and only
 *  through a well-formed `__VC_PLATFORM__` global; everything else gets the
 *  browser default. Both wrapped modes bind through this one path, per the
 *  mobile-distribution arch §2. Pure so the order is unit-testable without
 *  faking the build mode. */
export function resolvePlatform(mode: string, injected: unknown): PlatformPort {
  if (!isWrappedMode(mode)) return browserPlatform;
  if (!isPlatformPort(injected)) {
    // A wrapped bundle (native or desktop) that carries a broken injection is
    // a wrapper-shell bug; say so where the shell author will look (a bare
    // wrapped bundle with no injection at all is a legitimate preview, so
    // stay quiet for undefined).
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
