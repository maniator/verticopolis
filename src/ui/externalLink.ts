import { getPlatform } from "../platform";

/**
 * Route an outbound anchor through the platform port inside a native wrapper.
 * Only inside a wrapper: the link must not navigate the shell's WebView away,
 * so hand it to the system browser through `openExternal`. Browser builds
 * attach nothing, keeping the anchor's middle-click and context-menu
 * semantics untouched. Shared by the Help dialog's report link and the crash
 * screen's bug-report link so the two can't drift.
 *
 * ADDING AN OUTBOUND ORIGIN IS A CROSS-REPO CHANGE. A wrapper shell decides for
 * itself which origins `openExternal` will actually open, and it re-checks in its
 * own privileged process because nothing the renderer says is trusted there. Those
 * allow-lists are derived from the set of origins this function is reached with,
 * which today is `https://github.com` only (the report and bug-report links).
 *
 * So a new outbound link to a different origin will be REFUSED by a wrapper, and
 * the refusal is quiet from the player's side: the `fallback` below runs, logs, and
 * opens a window, which on desktop is a window the shell then declines to open. The
 * link reads as dead and nothing points at the cause. When you add one, update the
 * wrapper allow-lists in the private distribution repo in the same change.
 */
export function routeExternalInWrapper(link: HTMLAnchorElement): void {
  if (!getPlatform().isNativeWrapper) return;
  const fallback = (err: unknown) => {
    // The default is already cancelled; a failing wrapper hook must not
    // leave the link dead, so fall back to the browser behavior.
    console.error("[platform] openExternal failed:", err);
    window.open(link.href, "_blank", "noopener,noreferrer");
  };
  const routeExternal = (e: Event) => {
    e.preventDefault();
    // Promise.resolve folds an async wrapper hook's rejection (Capacitor's
    // Browser.open returns a Promise) into the same fallback as a sync
    // throw; either way the tap must still open the page somewhere.
    try {
      void Promise.resolve(getPlatform().openExternal(link.href)).catch(fallback);
    } catch (err) {
      fallback(err);
    }
  };
  link.addEventListener("click", routeExternal);
  // Middle-button activation fires auxclick, not click; route it the same
  // way (other buttons keep their defaults, e.g. the context menu).
  link.addEventListener("auxclick", (e) => {
    if (e.button === 1) routeExternal(e);
  });
}
