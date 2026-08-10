import { anyDebugOn, loadDebugFlags } from "./debugFlags";
import { publishDebugStub } from "./consoleStub";

/**
 * The boot entry for the developer debug surface (metrics HUD, geometry draw,
 * `window.vcdebug`; see DEBUGGING.md). One call from `runBootFlow`, so the boot
 * path carries a single line rather than the policy behind it.
 *
 * Lives in the MAIN bundle alongside `debugFlags`, `simTimer` and
 * `consoleStub`. Everything heavier sits behind the dynamic `import("./index")`
 * below, which is what keeps the surface off a normal session's critical path.
 */
export function startDebugSurface(app: unknown): void {
  // Published unconditionally so `vcdebug` ANSWERS mid-session: the hitch you
  // want to measure has already happened by the time you open devtools, and
  // reloading with `?debug=` destroys the state that caused it. Loads nothing
  // until asked.
  publishDebugStub(app);
  // The full surface starts at boot only when this session actually asked for
  // it. The flags are RESOLVED rather than the parameter merely spotted,
  // because `?debug=off` HAS the parameter but asks for nothing: spotting it
  // fetched the chunk and switched on per-frame sim timing for a session that
  // had explicitly turned debug off. Resolved once and handed to installDebug,
  // so the URL and storage are read a single time.
  const flags = loadDebugFlags();
  if (!anyDebugOn(flags)) return;
  // Fire-and-forget: a developer tool must never be able to take boot down.
  // The two failure modes are reported separately because they call for
  // completely different responses: a rejected import is a missing or
  // unreachable chunk, while a throw from installDebug is a real wiring bug
  // that would otherwise masquerade as a network problem.
  void import("./index")
    .then((m) => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        m.installDebug(app as any, flags);
      } catch (err) {
        console.error("[vcdebug] the debug surface failed to start (this is a bug, not a load failure):", err);
      }
    })
    .catch((err) => console.warn("[vcdebug] could not load the debug surface chunk:", err));
}
