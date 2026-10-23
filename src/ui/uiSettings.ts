import type { UI } from "./UI";
import { settingsTemplate } from "./templates/settings";
import { trackAppAction } from "../analytics";
import { engineSuffix } from "../wasmhost/engineLabel";
import { liveEngineSettings, wireEngineSection } from "../engineCohort/settingsLive";

/**
 * The Settings dialog controller, split out of `uiDialogs.ts` at the
 * readable-size ceiling. `uiDialogs` re-exports it, so `UI.showSettings` is
 * unchanged.
 */

/** The Settings dialog: sound levels and the presentation toggles. */
export function showSettings(ui: UI): void {
  trackAppAction("settings_open");
  // Same build constant the splash and Help's About line show; masked to a fixed
  // placeholder in screenshots (see pgMaskVersion, which keys on `.app-version`).
  const version = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "dev";
  // The Building section (the bridging toggle) is Modern-only; Classic never
  // renders it (bridging is forced on and can't be toggled there).
  const modern = ui.cb.getMode() === "modern";
  // The Game engine section (#1197) exists only where the build has a choice:
  // a wasm-only build has no TypeScript engine to pick.
  const engineView = __WASM_ONLY__ ? null : liveEngineSettings();
  const box = ui.openModalTemplate(settingsTemplate(version, modern, engineSuffix(), engineView), { displaceable: true });
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
    // The switch shows what the engine answered; on a fault it falls back to the live preference.
    ab.addEventListener("change", () => void ui.cb.onToggleAutoBridge().then((on) => (ab.checked = on), () => (ab.checked = ui.cb.isAutoBridge())));
  }
  // The controller wires every stateful control above; the plain Close action is
  // the one [data-act] button, so wireActions binds it (its loud lookup throws at
  // open if the button is ever dropped).
  if (engineView) wireEngineSection(box);
  ui.wireActions(box);
}
