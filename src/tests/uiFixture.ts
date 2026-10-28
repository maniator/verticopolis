import { vi } from "vitest";
import { catalogFor } from "../engine/catalog";
import { UI, type UICallbacks } from "../ui/UI";

/**
 * A real `UI` over a hand-written DOM fixture that lists the ids the `UI`
 * constructor looks up, for tests that drive the shared `<dialog>` (the dialog
 * suites, the frame loop's dialog ordering). Importing this file installs the
 * happy-dom dialog polyfills.
 */

// The test DOM (happy-dom) may not fully implement HTMLDialogElement's
// showModal()/close(); polyfill (guarded) the minimal semantics the UI relies
// on: `open` reflects the `open` attribute, and close() fires a "close" event.
if (typeof HTMLDialogElement.prototype.showModal !== "function") {
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.open = false;
    this.dispatchEvent(new Event("close"));
  };
}

// If the test DOM doesn't implement matchMedia, stub it: showHelp() reads it to
// decide whether the OS is forcing reduced motion. Reporting "not forced" is enough.
if (typeof window.matchMedia !== "function") {
  window.matchMedia = (media: string) =>
    ({
      media,
      matches: false,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList;
}

/** Minimal fixture with every id the UI constructor looks up (non-null!). */
export function mountAppDom(): void {
  document.body.innerHTML = `
    <span id="stat-money"></span><span id="stat-pop"></span><span id="stat-star"></span>
    <span id="stat-time"></span><span id="stat-date"></span>
    <div id="speed">
      <button class="btn" data-speed="0">⏸</button>
      <button class="btn" data-speed="1">▶</button>
      <button class="btn" data-speed="2">▶▶</button>
      <button class="btn" data-speed="3">▶▶▶</button>
      <button id="btn-update" hidden>Update</button>
    </div>
    <button id="audio-toggle">🔊</button>
    <button id="btn-undo"></button><button id="btn-redo"></button>
    <button id="panel-toggle"></button><button id="panel-close"></button><div id="scrim"></div>
    <select id="overlay-mode"><option value=""></option><option value="congestion">c</option></select>
    <div id="a11y-live"></div>
    <div id="palette-tabs"></div>
    <div id="palette-scroll"></div>
    <div id="tool-info"></div>
    <input id="tower-name" />
    <button id="btn-mode" class="mode-badge is-classic btn">This tower: Classic</button>
    <div id="tower-stats"></div>
    <button id="btn-stats"></button>
    <div id="log"></div>
    <button id="btn-load"></button>
    <button id="btn-save-top"></button>
    <button id="btn-settings"></button>
    <button id="btn-new"></button><button id="btn-help"></button>
    <div id="inspector" class="win hidden"></div>
    <div id="editor" class="win hidden"></div>
    <div id="toast-wrap"></div>
    <input id="import-file" type="file" hidden />
    <dialog id="modal"></dialog>`;
}

export function makeUI(overrides: Partial<UICallbacks> = {}): { ui: UI; cb: UICallbacks } {
  const classic = catalogFor("classic"); // one object, as a tower's catalog is, so the palette redraws only on a change
  const cb: UICallbacks = {
    getCatalog: vi.fn(() => classic),
    onSelectTool: vi.fn(),
    onSpeed: vi.fn(),
    getSpeed: vi.fn(() => 1),
    onSave: vi.fn(),
    onLoad: vi.fn(),
    onExport: vi.fn(),
    onImport: vi.fn(),
    onImportLegacy: vi.fn(),
    onExportLegacy: vi.fn(),
    getMode: vi.fn(() => "classic" as const),
    onNew: vi.fn(),
    onToggleAudio: vi.fn(() => true),
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    onEditAction: vi.fn(),
    onToggleReducedMotion: vi.fn(() => true),
    onToggleSteadyClock: vi.fn(() => true),
    isSteadyClock: vi.fn(() => false),
    onToggleAutoBridge: vi.fn(async () => true),
    isAutoBridge: vi.fn(() => true),
    isMuted: vi.fn(() => false),
    getVolumes: vi.fn(() => ({ music: 1, ambience: 1, sfx: 1 })),
    onSetVolume: vi.fn(),
    onReplayOnboarding: vi.fn(),
    onRenameTower: vi.fn(),
    onShowStats: vi.fn(),
    onSetOverlay: vi.fn(),
    onShowSaves: vi.fn(),
    onInspectorClose: vi.fn(),
    onSaveSlot: vi.fn(),
    onLoadSlot: vi.fn(),
    onDeleteSlot: vi.fn(),
    ...overrides,
  };
  return { ui: new UI(cb), cb };
}
