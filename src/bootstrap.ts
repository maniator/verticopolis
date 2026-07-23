import { html, nothing, render, type TemplateResult } from "lit-html";
import { registerPWA, type UpdateInfo } from "./pwa";
import { injectVercelTelemetry } from "./telemetry";
import { startGameplaySession, trackAppActionOnce } from "./analytics";
import { installErrorTracking } from "./analyticsErrors";
import { initPwaInstall } from "./pwaInstall";

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
  hideBootCover();
  // The stage check stays as the "is this the app page" gate, but the overlay
  // mounts in its OWN host under <body>: rendered inside #stage, its fixed
  // positioning would be hostage to any future transformed or filtered
  // ancestor (CSS makes such an ancestor the containing block for fixed
  // descendants, quietly shrinking "full viewport" to the stage box). A
  // direct child of <body> has no ancestors to capture it. Reused across
  // calls, so a second boot failure re-renders the same host.
  const stage = document.getElementById("stage");
  if (!stage) return;
  let host = document.getElementById("boot-fallback-host");
  if (!host) {
    host = document.createElement("div");
    host.id = "boot-fallback-host";
    document.body.appendChild(host);
  }
  // Render through lit-html (the app's renderer): an interpolated string is
  // escaped to a text node, so a dynamic value (a caught boot error's message)
  // can never inject markup, while a caller that needs formatting passes a lit
  // template. No innerHTML.
  //
  // The message is a FIXED full-viewport overlay above everything, because
  // nothing weaker can be trusted here. Flow content sinks below the fold
  // behind the dead canvas (the live Firefox no-WebGL report). A stage-local
  // absolute overlay loses to the splash on the boot-error path (a boot
  // throw after runBootFlow leaves the title screen mounted at z-index 40),
  // and REMOVING the splash is worse: its controller keeps a document
  // keydown listener, the autosave interval gates on the splash node's
  // presence, and the game chrome behind it would become reachable around a
  // fatal message. Covering everything at z-index 100 (the stylesheet tops
  // out at 50) leaves every owner's state intact while the player sees only
  // the message. Longhand top/right/bottom/left instead of the `inset`
  // shorthand on purpose: this path serves old and hardened engines, exactly
  // the crowd a newer shorthand can strand at static position. The inner
  // wrapper centers itself with margin:auto rather than justify-content, so
  // copy taller than a short viewport scrolls from its first line instead of
  // clipping unreachably above the scroll origin.
  // The id is a stable hook: the screenshot runner's boot-fallback scenes and
  // the tests wait on it (there is no `window.game` to wait for on this path).
  render(
    html`<div
      id="boot-fallback"
      style="position:fixed;top:0;right:0;bottom:0;left:0;z-index:100;background:#1c2030;overflow:auto;display:flex;flex-direction:column;align-items:center;padding:24px;text-align:center;color:#cdd3da;font:15px/1.5 system-ui,sans-serif"
    >
      <div
        style="margin:auto;max-width:100%;overflow-wrap:anywhere;display:flex;flex-direction:column;gap:16px;align-items:center"
      >
        <div>${content}</div>
        ${withReload
          ? html`<button style="padding:8px 24px;font:inherit;cursor:pointer" @click=${() => location.reload()}>Reload</button>`
          : nothing}
      </div>
    </div>`,
    host,
  );
}

/** Boot the game once the DOM is ready. `create` builds the app instance (a
 *  `() => new GameApp()` thunk from `main.ts`), kept as a factory so this module
 *  imports no `GameApp` value and stays cycle-free. */
export function bootGame(create: () => BootApp): void {
  if (typeof document === "undefined") return;
  const boot = () => {
    // Install the cookieless error listeners first, so an uncaught throw during
    // the rest of boot is captured (a throw during module eval, before this line,
    // is inherently out of reach). Host-gated per report (nothing is sent on a
    // dark host), never-throw, and only two passive listeners, so it is safe to
    // run before anything else.
    installErrorTracking();
    // Bind the PWA install capture as early as boot runs: `beforeinstallprompt`
    // can fire during initial load, before the game constructs and the install
    // affordance controller wires its callbacks, so catch an early event into
    // the module now. The install analytics latch rides here too, so an
    // `appinstalled` on ANY page (including the no-WebGL fallback, which returns
    // before the game constructs) still records the fact once; the controller
    // re-inits with its UI callbacks later and the listeners bind once.
    // (SPEC-pwa-install CAP-2 / CAP-4.)
    initPwaInstall({ onInstalled: () => trackAppActionOnce("install_app") });
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
