/**
 * In-place recovery orchestration for a lost WebGL context. The loss handler
 * calls `preventDefault()`, which tells the browser we own recovery and makes
 * it fire `webglcontextrestored` once the GPU is usable again. This module
 * waits for that signal, then asks the app to rebuild the renderer (a fresh
 * canvas element plus a fresh Excalibur engine over the same in-memory sim),
 * and reports a single boolean outcome to the caller.
 *
 * Timeout policy: waiting forever would strand the player on a dead canvas
 * with no explanation, so recovery gives up after {@link DEFAULT_TIMEOUT_MS}
 * of VISIBLE time. The countdown only runs while the tab is visible: Android
 * routinely evicts a backgrounded tab's GL context and restores it on return
 * to the foreground, which can be minutes later, and the crash screen must
 * not appear (and burn the session) while nobody is looking.
 *
 * Pure orchestration with injected ports so the whole state machine is unit
 * testable without a GPU: the caller supplies the restored-signal
 * subscription and the rebuild action.
 */
export interface ContextRecoveryDeps {
  /** Subscribe to the browser's context-restored signal. Returns the
   *  unsubscribe. Called exactly once, before any timer is armed. */
  onRestored(cb: () => void): () => void;
  /** Tear down the dead engine and build a fresh one. Resolves when the new
   *  engine is running; a throw or rejection means recovery failed. */
  rebuild(): Promise<void>;
  /** Visibility source, injectable for tests. Defaults to `document`. */
  doc?: Pick<Document, "hidden" | "addEventListener" | "removeEventListener">;
  /** Visible-time budget before giving up. Defaults to {@link DEFAULT_TIMEOUT_MS}. */
  timeoutMs?: number;
}

/** How long (visible time) to wait for the browser to restore the context
 *  before falling back to the crash screen. Restoration after a GPU process
 *  restart typically lands well under a second; several seconds of visible
 *  silence means the GPU is genuinely wedged. */
export const DEFAULT_TIMEOUT_MS = 8000;

/**
 * Run one recovery attempt. `done` is called exactly once: `true` when the
 * rebuilt engine is running, `false` when the rebuild failed or the restored
 * signal never came inside the visible-time budget.
 */
export function attemptContextRecovery(deps: ContextRecoveryDeps, done: (recovered: boolean) => void): void {
  const doc = deps.doc ?? document;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let settled = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let unsubscribe: (() => void) | null = null;

  const finish = (ok: boolean): void => {
    if (settled) return;
    settled = true;
    if (timer !== null) clearTimeout(timer);
    timer = null;
    doc.removeEventListener("visibilitychange", onVisibility);
    unsubscribe?.();
    done(ok);
  };

  const arm = (): void => {
    if (timer === null && !doc.hidden) timer = setTimeout(() => finish(false), timeoutMs);
  };
  const disarm = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  const onVisibility = (): void => {
    if (doc.hidden) disarm();
    else arm();
  };

  unsubscribe = deps.onRestored(() => {
    if (settled) return;
    // The GPU is back. Stop the countdown before the (possibly slow) rebuild
    // so a timeout can't fire mid-rebuild and stack the crash screen on top
    // of a healthy new engine.
    disarm();
    let started: Promise<void>;
    try {
      started = deps.rebuild();
    } catch {
      finish(false);
      return;
    }
    started.then(
      () => finish(true),
      () => finish(false),
    );
  });
  doc.addEventListener("visibilitychange", onVisibility);
  arm();
}
