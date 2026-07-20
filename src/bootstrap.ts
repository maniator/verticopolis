import { html, nothing, render, type TemplateResult } from "lit-html";
import { registerPWA, type UpdateInfo } from "./pwa";
import { injectVercelTelemetry } from "./telemetry";

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
  const stage = document.getElementById("stage");
  if (!stage) return;
  // Render through lit-html (the app's renderer): an interpolated string is
  // escaped to a text node, so a dynamic value (a caught boot error's message)
  // can never inject markup, while a caller that needs formatting passes a lit
  // template. No innerHTML.
  render(
    html`<div
      style="display:flex;flex-direction:column;gap:16px;align-items:center;justify-content:center;height:100%;padding:24px;text-align:center;color:#cdd3da;font:15px/1.5 system-ui,sans-serif"
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
      showBootMessage(
        html`This viewer can't run WebGL, which Verticopolis needs to draw the
          tower.<br /><br />Open this page in <b>Safari</b>, <b>Chrome</b>, or another full web
          browser to play.`,
      );
      return;
    }
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
