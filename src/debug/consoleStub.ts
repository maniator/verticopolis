/**
 * The always-present `window.vcdebug` entry point.
 *
 * The rest of the debug surface is a dynamic import that only loads when a
 * `?debug=` flag or a persisted spec asks for it, which is what keeps it off a
 * normal session's critical path. But the whole point of a console surface is
 * reaching it MID-SESSION: the stutter you want to measure has usually already
 * happened by the time you think to look, and reloading with `?debug=` destroys
 * the state that produced it.
 *
 * So this tiny stub ships in the main bundle and does one thing: load the real
 * surface on demand. It is a handful of lines and one global, which is the
 * honest price of `vcdebug` answering when someone types it.
 *
 * `on()` is async because a dynamic import is. Devtools consoles allow
 * top-level `await`, so the intended use reads:
 *
 *     await vcdebug.on()
 *     vcdebug.fps()
 *
 * After `on()` resolves, `window.vcdebug` IS the full API (installDebug
 * republishes over this stub), so everything after that is synchronous.
 */

const GLOBAL_KEY = "vcdebug";

/** The minimal shape the stub publishes. `on` resolves to the full console API
 *  (typed `unknown` here so this module pulls in none of the lazy tree). */
export interface DebugStub {
  on(): Promise<unknown>;
  help(): void;
}

/** Whether a full surface has already replaced the stub, so `on()` is a no-op
 *  and repeated calls cannot install twice. */
function installed(): boolean {
  const current = (globalThis as Record<string, unknown>)[GLOBAL_KEY];
  return !!current && !("on" in (current as object));
}

export function publishDebugStub(app: unknown): void {
  try {
    if ((globalThis as Record<string, unknown>)[GLOBAL_KEY]) return; // never clobber a live surface
    // The in-flight load, memoized. Without this, two `on()` calls issued
    // before the import resolves (`vcdebug.on(); vcdebug.on()` pasted as one
    // line) would BOTH pass the installed() check, which runs before the await,
    // and each would install a surface: two rAF loops, of which only the second
    // is reachable to dispose, so the first spins for the life of the page.
    let loading: Promise<unknown> | null = null;
    const stub: DebugStub = {
      on(): Promise<unknown> {
        if (installed()) return Promise.resolve((globalThis as Record<string, unknown>)[GLOBAL_KEY]);
        // The same module the boot path imports, so a flagged session and a
        // console-started one converge on one surface rather than two.
        loading ??= import("./index")
          .then((mod) => {
            // Re-check: the boot path may have finished installing while this
            // import was in flight.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            if (!installed()) mod.installDebug(app as any);
            return (globalThis as Record<string, unknown>)[GLOBAL_KEY];
          })
          .catch((err) => {
            loading = null; // a failed load must not poison later attempts
            throw err;
          });
        return loading;
      },
      help(): void {
        console.log(
          [
            "vcdebug is not started yet (this session carried no ?debug= flag).",
            "",
            "  await vcdebug.on()     load the debug surface, then vcdebug.help()",
            "",
            "Or reload with ?debug=fps to start it at boot. See DEBUGGING.md.",
          ].join("\n"),
        );
      },
    };
    (globalThis as Record<string, unknown>)[GLOBAL_KEY] = stub;
  } catch {
    /* a frozen global is not worth failing boot over */
  }
}
