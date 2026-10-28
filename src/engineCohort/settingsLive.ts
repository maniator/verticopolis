import { html, render } from "lit-html";
import { activeEngine } from "../wasmhost/engineLabel";
import type { EngineBootState } from "../wasmhost/engineBoot";
import { RUST_ONLY_BY_CHOICE } from "./config";
import { currentSelection } from "./current";
import { clearRustCrashes, tabStore } from "./crashReload";
import { clearSafety, readPreference, setPreference, suppressionApplies, type Preference, type Selection } from "./policy";
import { browserStore, readSafety, remove, writeChecked, type KeyValueStore, type SafetyRecord } from "./records";

import { engineSettingsView, type EngineOption, type EngineSettingsView } from "./settingsView";

/**
 * The live side of the Settings "Game engine" section (#1197): reads what is
 * stored and running now, and wires the radio group and the retry button.
 * Picking a choice stores it and updates the status line; it never reloads
 * the page, since a reload could lose unsaved play.
 */

interface LiveSources {
  store: KeyValueStore | null;
  running: () => "ts" | "wasm";
  boot: () => EngineBootState | undefined;
}

const PROBE_KEY = "vc.engineProbe";

/** A retry in this page life, kept across reopening Settings. */
let retriedThisPage = false;

/** @internal Tests only: forget a retry. */
export function forgetRetry(): void {
  retriedThisPage = false;
}

const browserSources = (): LiveSources => ({
  store: browserStore(),
  running: () => activeEngine(),
  boot: () => (globalThis as { __vcEngineBoot?: EngineBootState }).__vcEngineBoot,
});

/** Whether storage can keep a choice: a probe write that reads back. */
function storable(store: KeyValueStore | null): boolean {
  if (!writeChecked(store, PROBE_KEY, 1)) return false;
  remove(store, PROBE_KEY);
  return true;
}

/** The suppression in force: a record that applies to this build, or a
 *  corrupt one (the boot treated it as a fault), so a retry is offered. */
function suppressionNow(store: KeyValueStore | null, selection: Selection | null): SafetyRecord | null {
  const safety = readSafety(store);
  if (safety.ok) return suppressionApplies(safety.value, __APP_SHA__) ? safety.value : null;
  if (safety.why !== "corrupt") return null;
  return selection?.suppression ?? { v: 1, scope: "fault", reason: "corrupt", stage: "none", sha: __APP_SHA__, at: 0 };
}

export function liveEngineSettings(src: LiveSources = browserSources()): EngineSettingsView {
  const boot = src.boot();
  const selection = currentSelection();
  return engineSettingsView({
    selection,
    running: src.running(),
    preference: readPreference(src.store),
    suppression: suppressionNow(src.store, selection),
    pageFallback: boot?.failure && boot.build === "switchable" ? boot.failure.reason : null,
    retried: retriedThisPage,
    storable: storable(src.store),
    rustOnlyByChoice: RUST_ONLY_BY_CHOICE,
  });
}

const PREFERENCE_OF: Record<EngineOption, Preference> = { auto: "auto", rust: "wasm", typescript: "ts" };

function renderStatus(el: HTMLElement, view: EngineSettingsView, onRetry: () => void): void {
  render(
    html`<p>Running now: <b>${view.running}</b>${view.testHost ? " (a test setup is selected)" : ""}.</p>
      ${view.note ? html`<p>${view.note}</p>` : ""}
      ${view.retry ? html`<p><button class="btn" type="button" data-engine-retry @click=${onRetry}>Try the Rust engine again</button></p>` : ""}
      ${view.restart ? html`<p><b>Restart the game to switch engines.</b> Your choice is saved and takes effect next time the game starts.</p>` : ""}
      ${view.storable ? "" : html`<p>This browser cannot save a new choice right now.</p>`}`,
    el,
  );
}

/** Wire the section inside an open Settings dialog. */
export function wireEngineSection(box: ParentNode, src: LiveSources = browserSources()): void {
  const status = box.querySelector<HTMLElement>("#set-engine-status");
  if (!status) return;
  const refresh = () => renderStatus(status, liveEngineSettings(src), retry);
  const radios = [...box.querySelectorAll<HTMLInputElement>('input[name="set-engine"]')];
  const retry = () => {
    clearSafety(src.store);
    clearRustCrashes(tabStore());
    retriedThisPage = true;
    refresh();
    // The button is gone now; keep keyboard focus in the section.
    radios.find((r) => r.checked)?.focus();
  };
  const choose = (radio: HTMLInputElement) => {
    if (!radio.checked) return;
    const wanted = PREFERENCE_OF[radio.value as EngineOption];
    if (readPreference(src.store) === wanted) return refresh();
    if (!setPreference(src.store, wanted)) {
      // Not saved: show the choice that is stored, and say why.
      const kept = liveEngineSettings(src).choice;
      for (const r of radios) r.checked = r.value === kept;
      renderStatus(status, { ...liveEngineSettings(src), storable: false }, retry);
      return;
    }
    refresh();
  };
  for (const radio of radios) {
    radio.addEventListener("change", () => choose(radio));
    // A tester's stored test host shows as Rust already checked, so picking
    // Rust fires no change; the click still replaces it with plain Rust.
    radio.addEventListener("click", () => choose(radio));
  }
  refresh();
}
