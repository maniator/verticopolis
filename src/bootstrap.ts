import { html, nothing, render, type TemplateResult } from "lit-html";
import { registerPWA, type UpdateInfo } from "./pwa";
import { injectVercelTelemetry } from "./telemetry";
import { startGameplaySession } from "./analytics";

/**
 * Boot entry split out of `main.ts` (the `GameApp` composition root). Keeps the
 * WebGL capability probe, the telemetry gate, and the service-worker
 * registration next to the DOM-ready trigger, so `main.ts` stays the class
 * shell. `bootGame` takes a factory rather than importing `GameApp`, so there is
 * no runtime import cycle: `main.ts` calls `bootGame(() => new GameApp())` after
 * the class is defined.
 */

/** The slice of the app `bootGame` touches: it publishes the handle and wires
 *  the PWA update prompt. Structural, so `bootstrap.ts` need not import `GameApp`. */
interface BootApp {
  onUpdateAvailable(activate: () => Promise<void>, info?: UpdateInfo): void;
}

/** The renderer needs WebGL; some in-app file viewers don't provide it. */
export function hasWebGL(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

/** Remove the static boot cover (index.html) once the app has something real to
 *  show: the mounted splash, the resumed tower, or a boot-fallback message. It
 *  is idempotent, so every boot outcome can call it without coordinating. */
export function hideBootCover(): void {
  document.getElementById("boot-cover")?.remove();
}

export function showBootMessage(content: TemplateResult | string, withReload = false): void {
  // A boot-fallback message (no WebGL, a boot error) must never be trapped
  // behind the cover, so drop it unconditionally, before the #stage guard.
  // The splash and onboarding surfaces sit ABOVE the stage overlay (fixed,
  // higher z-index) and can already be mounted when a boot error lands after
  // runBootFlow, so drop those too: a fatal message behind a stuck title
  // screen is the same invisible-failure class this function exists to end.
  hideBootCover();
  document.getElementById("splash")?.remove();
  document.getElementById("onboard")?.remove();
  const stage = document.getElementById("stage");
  if (!stage) return;
  // Render through lit-html (the app's renderer): an interpolated string is
  // escaped to a text node, so a dynamic value (a caught boot error's message)
  // can never inject markup, while a caller that needs formatting passes a lit
  // template. No innerHTML.
  //
  // The message is an overlay because flow content cannot be trusted here:
  // lit appends its part AFTER the stage's static children (the canvas, the
  // hint), and #stage clips without scrolling, so a statically-positioned
  // message lands below the fold behind the dead canvas and the player sees
  // an unexplained empty page (the live Firefox no-WebGL report this fixes).
  // Longhand top/right/bottom/left instead of the `inset` shorthand on
  // purpose: this path serves old and hardened engines, exactly the crowd a
  // newer shorthand can strand at static position, which would resurrect the
  // very bug. The stage's own position is pinned here too, so a future CSS
  // reshuffle of #stage cannot quietly re-anchor the overlay to an ancestor.
  stage.style.position = "relative";
  render(
    html`<div
      style="position:absolute;top:0;right:0;bottom:0;left:0;z-index:10;background:#1c2030;overflow:auto;display:flex;flex-direction:column;gap:16px;align-items:center;justify-content:center;padding:24px;text-align:center;color:#cdd3da;font:15px/1.5 system-ui,sans-serif"
    >
      <div>${content}</div>
      ${withReload
        ? html`<button style="padding:8px 24px;font:inherit;cursor:pointer" @click=${() => location.reload()}>Reload</button>`
        : nothing}
    </div>`,
    stage,
  );
}

/** Boot the game once the DOM is ready. `create` builds the app instance (a
 *  `() => new GameApp()` thunk from `main.ts`), kept as a factory so this module
 *  imports no `GameApp` value and stays cycle-free. */
export function bootGame(create: () => BootApp): void {
  if (typeof document === "undefined") return;
  const boot = () => {
    // Report Core Web Vitals and page views through the shared, host-gated
    // helper (the same inject the gallery and the /help page use), so a
    // telemetry hiccup can never throw past this line and suppress the WebGL
    // fallback below.
    injectVercelTelemetry();
    if (!hasWebGL()) {
      // The copy leads with the remedy (every current browser, Firefox
      // included, runs WebGL once hardware acceleration is on; most real hits
      // here are acceleration turned off, a driver blocklist, or a hardened
      // profile, all fixable in place) and keeps another browser or device as
      // the honest last resort. The reload button closes the loop after the
      // setting flips.
      showBootMessage(
        html`This browser can't use WebGL right now, and Verticopolis needs it to
          draw the tower.<br /><br />Enable <b>hardware acceleration</b> (or WebGL) in your
          browser's settings and reload. If that doesn't help, another browser or
          device should run it.`,
        true,
      );
      return;
    }
    // Start the gameplay session clock (foreground time + funnel state) only once
    // we know the game will actually run: a no-WebGL visitor bails above, so its
    // session never opens and can't dilute the length signal. Host-gated inside,
    // like the page-view inject just above.
    startGameplaySession();
    try {
      const app = create();
      // Expose for screenshot tooling / debugging.
      (window as unknown as { game: BootApp }).game = app;
      // Register the service worker so the game is installable and offline-ready.
      // On a new build: prompt the player (never force a reload), see
      // GameApp.onUpdateAvailable.
      registerPWA({ onUpdateAvailable: (activate, info) => app.onUpdateAvailable(activate, info) });
    } catch (err) {
      // A non-Error throw (a string, say) has no `.message`, so derive the text
      // defensively rather than render "undefined"; the original error is still
      // rethrown untouched.
      const message = err instanceof Error ? err.message : String(err);
      showBootMessage("Something went wrong starting the game: " + message);
      throw err;
    }
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
}
