import type { UI } from "./UI";
import { settingsTemplate } from "./templates/settings";
import { trackAppAction } from "../analytics";
import { IS_DESKTOP_BUILD } from "../desktopConsent";
import { wireDesktopAnalyticsToggle } from "./uiDesktopAnalytics";

/**
 * The Settings dialog controller, split out of `uiDialogs.ts` at the
 * readable-size ceiling when the desktop privacy switch landed (issue #781).
 * `uiDialogs` re-exports it, so `UI.showSettings` and the native shell's
 * `settings` menu command are unchanged.
 */

/** The Settings dialog: sound levels, the presentation toggles, and (on a
 *  desktop build) the analytics switch. */
export function showSettings(ui: UI): void {
  trackAppAction("settings_open");
  // Same build constant the splash and Help's About line show; masked to a fixed
  // placeholder in screenshots (see pgMaskVersion, which keys on `.app-version`).
  const version = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "dev";
  // The Building section (the bridging toggle) is Modern-only; Classic never
  // renders it (bridging is forced on and can't be toggled there).
  const modern = ui.cb.getMode() === "modern";
  // The Privacy section is desktop-only. `IS_DESKTOP_BUILD` folds to a literal at
  // build time, so a browser session renders no row and wires no switch. It does
  // not drop them from the bundle: `settingsTemplate` takes `showAnalytics` as an
  // ordinary parameter, so the row's markup rides inside a shared template a web
  // build still ships and never renders (see `desktopConsent.ts` for what does
  // fold).
  const box = ui.openModalTemplate(settingsTemplate(version, modern, IS_DESKTOP_BUILD), { displaceable: true });
  // Volume sliders: initialize from the live levels, apply on every input tick
  // (persistence is debounced by the onSetVolume handler in main.ts), and keep
  // the percent readout in step. Mute is independent; sliders never touch it.
  const vols = ui.cb.getVolumes();
  const wireVolume = (id: string, kind: "music" | "ambience" | "sfx", initial: number) => {
    const input = box.querySelector<HTMLInputElement>(`#${id}`)!;
    const readout = box.querySelector<HTMLElement>(`[data-vol-val="${id}"]`)!;
    const show = (v: number) => (readout.textContent = `${Math.round(v * 100)}%`);
    input.value = String(Math.round(initial * 100));
    show(initial);
    input.addEventListener("input", () => {
      const v = Number(input.value) / 100;
      ui.cb.onSetVolume(kind, v);
      show(v);
    });
  };
  wireVolume("vol-music", "music", vols.music);
  wireVolume("vol-ambience", "ambience", vols.ambience);
  wireVolume("vol-sfx", "sfx", vols.sfx);
  // Both switches show the LIVE state and re-read it from the callback's return
  // after every toggle, so a stuck pref can never desync the UI.
  const sc = box.querySelector<HTMLInputElement>("#set-steady-clock")!;
  sc.checked = ui.cb.isSteadyClock();
  sc.addEventListener("change", () => (sc.checked = ui.cb.onToggleSteadyClock()));
  const rm = box.querySelector<HTMLInputElement>("#set-reduce-motion")!;
  // When the OS forces reduced motion on, the user pref can't override it: show
  // the switch on, disable it (so it isn't a silent no-op), and say why.
  const osForced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  rm.checked = osForced || document.documentElement.classList.contains("reduce-motion");
  rm.disabled = osForced;
  if (osForced) rm.closest("label")!.querySelector("span")!.textContent = "Reduced motion (system)";
  rm.addEventListener("change", () => (rm.checked = ui.cb.onToggleReducedMotion()));
  // Modern-only bridging toggle: it shows the live state and re-reads the
  // callback's return after every toggle. Always available in Modern (rooms
  // auto-lay their floor regardless; this only controls the between-things
  // bridge), whatever was chosen at founding.
  if (modern) {
    const ab = box.querySelector<HTMLInputElement>("#set-auto-bridge")!;
    ab.checked = ui.cb.isAutoBridge();
    ab.addEventListener("change", () => (ab.checked = ui.cb.onToggleAutoBridge()));
  }
  // Desktop-only analytics switch, wired the same live-state way. It does not go
  // through `ui.cb`: the consent value is owned by `desktopConsent.ts` and needs
  // nothing from `GameApp`, so routing it through the callback seam would add
  // four indirections around a module-level read.
  //
  // Turning it ON is the player's permission, and until the shell stage of this
  // epic lands it is only that: the packaged shell refuses every outbound
  // request today, so a consented desktop build still sends nothing (see
  // `analyticsRelay.ts`). Turning it OFF is complete on its own, since the gate
  // it closes is in this bundle.
  wireDesktopAnalyticsToggle(box, IS_DESKTOP_BUILD);
  // The controller wires every stateful control above; the plain Close action is
  // the one [data-act] button, so wireActions binds it (its loud lookup throws at
  // open if the button is ever dropped).
  ui.wireActions(box);
}
