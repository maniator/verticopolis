// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { html, type TemplateResult } from "lit-html";
import { UI, type UICallbacks } from "../../ui/UI";
import { setMode } from "../../ui/uiStatus";
import { Simulation } from "../../engine/Simulation";
import { CLASSIC_RULES, MODERN_RULES } from "../../engine/gameRules";
import type { ScheduleDialogCtx } from "../../ui/uiElevatorSchedule";
import type { Unit } from "../../engine/types";
import { unitEditorTemplate } from "../../ui/templates/editor";
import { toggleMute } from "../../game/audioPrefs";
import { loadPrefs } from "../../storage/Prefs";
import * as platformModule from "../../platform";

/**
 * Pins the dialog/window wiring contracts in src/ui/UI.ts — the layer where
 * real shipped bugs lived (giant close button, stretched ✕ glyph, dead
 * buttons) with no test coverage:
 *
 *  - wireActions: every [data-act] lookup is LOUD — a handler whose button is
 *    missing from the template throws at wiring time instead of shipping a
 *    dead button; the default close binding is included unless opts.close is
 *    false (confirm/emergency templates render no close button on purpose).
 *  - titleBarClose: every DOM-built ✕ comes from the one shared recipe —
 *    a real <button> with classes "btn xs", aria-label "Close", ✕ glyph — so
 *    the modal ✕ and the inspector ✕ can't drift apart again.
 *  - openModalTemplate: the window grammar (.modal-box.win box, top-level h2 becomes
 *    the .win-title bar, nested h2s are never skinned), the ✕ is appended
 *    AFTER showModal so it's the title bar's last child (keyboard focus lands
 *    on the primary action, not on ✕), and the ✕ routes through the dialog's
 *    cancel path — not closeModal() directly — so modals that override
 *    oncancel (the emergency choice) still resolve when dismissed via ✕.
 *  - renderEditor: lit's binding diff patches value cells in place (buttons
 *    keep identity → no swallowed clicks), and the card's [data-edit] actions
 *    and ✕ dispatch through ONE delegated listener that survives re-renders.
 *    (The diff/identity mechanics are covered by editorPatch.test.ts, the
 *    template structure by templates/editor.test.ts.)
 *  - toast: kind class + text land on the toast element; the stack is capped.
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
function mountAppDom(): void {
  document.body.innerHTML = `
    <span id="stat-money"></span><span id="stat-pop"></span><span id="stat-star"></span>
    <span id="stat-time"></span><span id="stat-date"></span>
    <div id="speed">
      <button class="btn" data-speed="0">⏸</button>
      <button class="btn" data-speed="1">▶</button>
      <button class="btn" data-speed="2">▶▶</button>
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

function makeUI(overrides: Partial<UICallbacks> = {}): { ui: UI; cb: UICallbacks } {
  const cb: UICallbacks = {
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
    onToggleAutoBridge: vi.fn(() => true),
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

const dialog = (): HTMLDialogElement => document.getElementById("modal") as HTMLDialogElement;
const click = (sel: string): void => {
  const el = dialog().querySelector<HTMLElement>(sel);
  expect(el, `expected a "${sel}" element in the open dialog`).not.toBeNull();
  el!.click();
};

/** The Saves dialog is the only entry to export/import: open it, click the
 *  footer action (which closes it and opens the confirm dialog / picker). */
const openExportConfirm = (ui: UI): void => {
  ui.showSaves([]);
  click('[data-act="export"]');
};
const openImportPicker = (ui: UI): void => {
  ui.showSaves([]);
  click('[data-act="import"]');
};

beforeEach(() => {
  mountAppDom();
});

describe("wireActions — the anti-dead-button contract", () => {
  it("binds the default close: [data-act=close] dismisses the modal", () => {
    const { ui } = makeUI();
    ui.showStats(html`<p>lots of numbers</p>`);
    expect(dialog().open).toBe(true);
    click('[data-act="close"]');
    expect(dialog().open).toBe(false);
    expect(dialog().innerHTML).toBe(""); // closeModal also empties the dialog
  });

  it("binds caller-supplied [data-act] handlers (saves dialog export opens the confirm dialog)", () => {
    const { ui, cb } = makeUI();
    ui.showSaves([]);
    click('[data-act="export"]');
    // The handler ran — it swapped the saves dialog for the export confirm —
    // but nothing is exported until the player clicks Export in there.
    expect(cb.onExport).not.toHaveBeenCalled();
    click('[data-act="export"]'); // the confirm dialog's own primary
    expect(cb.onExport).toHaveBeenCalledTimes(1);
  });

  it("throws at wiring time when a handler's [data-act] button is missing", () => {
    // wireActions is private; there is deliberately no public path that pairs a
    // handler with a missing button (that's the bug this guards against), so
    // this one contract is exercised by direct call.
    const { ui } = makeUI();
    const box = document.createElement("div");
    box.innerHTML = '<button data-act="close">Close</button>';
    expect(() => (ui as any).wireActions(box, { apply: () => {} })).toThrow();
  });

  it("throws when the default close button is absent — unless opts.close is false", () => {
    const { ui } = makeUI();
    const box = document.createElement("div"); // no [data-act="close"] anywhere
    expect(() => (ui as any).wireActions(box)).toThrow();
    expect(() => (ui as any).wireActions(box, {}, { close: false })).not.toThrow();
  });

  it("confirmModal renders no close button and wires yes/no without throwing", () => {
    const { ui } = makeUI();
    const onYes = vi.fn();
    ui.confirmModal("Start a new tower?", "This abandons your tower.", onYes);
    expect(dialog().querySelector('[data-act="close"]')).toBeNull(); // close:false template
    click('[data-act="no"]');
    expect(onYes).not.toHaveBeenCalled();
    expect(dialog().open).toBe(false);

    ui.confirmModal("Again?", "…", onYes);
    click('[data-act="yes"]');
    expect(onYes).toHaveBeenCalledTimes(1);
    expect(dialog().open).toBe(false);
  });
});

describe("titleBarClose — the one shared ✕ recipe", () => {
  it("the modal title-bar ✕ is a real button: .modal-x.btn.xs, aria-label Close, ✕ glyph", () => {
    const { ui } = makeUI();
    ui.showStats(html`<p>body</p>`);
    const x = dialog().querySelector<HTMLButtonElement>("h2 > button")!;
    expect(x).not.toBeNull();
    expect(x.tagName).toBe("BUTTON");
    expect(x.type).toBe("button"); // never submits an enclosing form
    expect([...x.classList].sort()).toEqual(["btn", "modal-x", "xs"]);
    expect(x.getAttribute("aria-label")).toBe("Close");
    expect(x.textContent).toBe("✕");
  });

  it("the inspector ✕ uses the same recipe (.insp-close.btn.xs) and routes to onInspectorClose", () => {
    const { ui, cb } = makeUI();
    ui.showInspector(html`<h4>Office 12F</h4><div>occupied</div>`);
    const x = document.querySelector<HTMLButtonElement>("#inspector h4 > button")!;
    expect(x).not.toBeNull();
    expect([...x.classList].sort()).toEqual(["btn", "insp-close", "xs"]);
    expect(x.getAttribute("aria-label")).toBe("Close");
    expect(x.textContent).toBe("✕");
    x.click();
    // Routed through the app (which latches the dismissal), never a local hide.
    expect(cb.onInspectorClose).toHaveBeenCalledTimes(1);
  });

  it("the inspector ✕ survives a same-card lit re-render, is never duplicated, and STAYS LIVE", () => {
    // Hover picks re-render the card every move; the ✕ is a foreign node
    // appended after the h4's lit-managed content (the finishModal pattern),
    // so it must survive a same-shape re-render, and a re-show must not
    // append a second one. The legacy innerHTML path minted a fresh button
    // on every show; the retained button changes that lifecycle, so pin that
    // it still FIRES after a re-render and after a hide/re-show round trip,
    // not merely that it is the same element.
    const { ui, cb } = makeUI();
    // The h4 carries a BINDING like the production card's title (its child
    // part extends to the h4's end, where the appended ✕ sits), so this pins
    // the exact lit behavior the retained ✕ rests on, not a weaker static h4.
    const card = (title: string, status: string) => html`<h4>${title}</h4><div>${status}</div>`;
    ui.showInspector(card("Office 12F", "occupied"));
    const x = document.querySelector<HTMLButtonElement>("#inspector h4 > button")!;
    ui.showInspector(card("Office 14F", "vacating"));
    expect(document.querySelector("#inspector h4")!.textContent).toContain("Office 14F");
    expect(document.querySelector("#inspector div")!.textContent).toBe("vacating");
    const xs = document.querySelectorAll("#inspector h4 > button");
    expect(xs.length).toBe(1);
    expect(xs[0]).toBe(x); // same element: a mid-tap ✕ press can't be swallowed
    x.click();
    expect(cb.onInspectorClose).toHaveBeenCalledTimes(1);

    ui.showInspector(null); // ✕ tap hides; content (and button) stay parked
    ui.showInspector(card("Office 12F", "occupied")); // re-show over the retained DOM
    const again = document.querySelectorAll<HTMLButtonElement>("#inspector h4 > button");
    expect(again.length).toBe(1);
    again[0].click(); // the retained ✕ must still dismiss on the re-shown card
    expect(cb.onInspectorClose).toHaveBeenCalledTimes(2);
  });
});

describe("openModalTemplate — the window grammar", () => {
  // openModalTemplate is private but is THE window factory; its return value and
  // skinning rules are the contract every show* method builds on.
  const open = (ui: UI, content: TemplateResult): HTMLElement => (ui as any).openModalTemplate(content);

  it("wraps content in .modal-box.win and returns that box", () => {
    const { ui } = makeUI();
    const box = open(ui, html`<h2>Title</h2><p>body</p>`);
    expect(box).toBe(dialog().firstElementChild);
    expect(box.classList.contains("modal-box")).toBe(true);
    expect(box.classList.contains("win")).toBe(true);
    expect(dialog().open).toBe(true);
  });

  it("skins only the TOP-LEVEL h2 as .win-title — an h2 nested in body content is untouched", () => {
    const { ui } = makeUI();
    const box = open(ui, html`<h2>Window Title</h2><div><h2>Section heading</h2></div>`);
    const [title, nested] = [...box.querySelectorAll("h2")];
    expect(title.classList.contains("win-title")).toBe(true);
    expect(nested.classList.contains("win-title")).toBe(false);
    expect(nested.querySelector("button")).toBeNull(); // and no ✕ either
  });

  it("points the dialog's aria-labelledby at the title-text span, so a screen reader announces which dialog opened", () => {
    const { ui } = makeUI();
    const box = open(ui, html`<h2>Window Title</h2><p>body</p>`);
    const labelId = dialog().getAttribute("aria-labelledby");
    expect(labelId).toBeTruthy();
    const title = box.querySelector(":scope > h2")!;
    const titleSpan = document.getElementById(labelId!)!;
    expect(titleSpan.tagName).toBe("SPAN"); // labeled at the title-text span, not the h2
    expect(titleSpan.parentElement).toBe(title);
    expect(titleSpan.textContent).toContain("Window Title");
  });

  it("excludes the ✕ button from the accessible name: the labeled span carries the title text alone", () => {
    // Regression guard: finishModal used to label the h2 itself, and the ✕
    // is appended into that same h2, so a screen reader announced the title
    // plus the ✕'s own accessible name ("Close"), e.g. "Settings Close".
    const { ui } = makeUI();
    open(ui, html`<h2>Settings</h2><p>body</p>`);
    const labelId = dialog().getAttribute("aria-labelledby")!;
    const titleSpan = document.getElementById(labelId)!;
    expect(titleSpan.textContent).toContain("Settings");
    expect(titleSpan.textContent).not.toContain("Close");
    expect(titleSpan.querySelector("button")).toBeNull();
  });

  it("never labels the dialog with a nested (non-title-bar) h2", () => {
    const { ui } = makeUI();
    open(ui, html`<h2>Window Title</h2><div><h2>Section heading</h2></div>`);
    const labelId = dialog().getAttribute("aria-labelledby")!;
    expect(document.getElementById(labelId)!.textContent).toContain("Window Title");
    expect(document.getElementById(labelId)!.textContent).not.toContain("Section heading");
  });

  it("leaves a caller-supplied h2 id untouched; aria-labelledby points at the title-text span, not the caller id", () => {
    const { ui } = makeUI();
    open(ui, html`<h2 id="custom-title-id">Titled</h2><p>body</p>`);
    const title = dialog().querySelector<HTMLElement>("h2.win-title")!;
    expect(title.id).toBe("custom-title-id"); // caller id preserved, never read or overwritten
    const labelId = dialog().getAttribute("aria-labelledby");
    expect(labelId).not.toBe("custom-title-id");
    expect(labelId).toBe("verticopolis-modal-title"); // the shared MODAL_TITLE_ID, stamped on the span
    const titleSpan = document.getElementById(labelId!)!;
    expect(titleSpan.tagName).toBe("SPAN");
    expect(titleSpan.parentElement).toBe(title); // nested inside the caller's own h2
    expect(titleSpan.textContent).toContain("Titled");
  });

  it("clears aria-labelledby rather than leaving it dangling when a modal renders no top-level h2", () => {
    const { ui } = makeUI();
    open(ui, html`<p>no title here</p>`);
    expect(dialog().hasAttribute("aria-labelledby")).toBe(false);
  });

  it("appends exactly one ✕, as the LAST child of the title bar (focus lands on the primary action, not ✕)", () => {
    const { ui } = makeUI();
    const box = open(ui, html`<h2>Title</h2><button class="btn primary" data-act="close">OK</button>`);
    const title = box.querySelector(":scope > h2")!;
    const xs = box.querySelectorAll(".modal-x");
    expect(xs.length).toBe(1);
    expect(title.lastElementChild).toBe(xs[0]);
  });

  it("✕ routes through the dialog's cancel path (a cancelable cancel event), not closeModal directly", () => {
    const { ui } = makeUI();
    open(ui, html`<h2>Title</h2>`);
    // Steal the cancel path the way showEventChoice does. If ✕ called
    // closeModal() directly, this handler would be bypassed and the dialog
    // would close anyway.
    let seen: Event | null = null;
    dialog().oncancel = (e) => {
      seen = e;
    };
    click(".modal-x");
    expect(seen).not.toBeNull();
    expect((seen as unknown as Event).cancelable).toBe(true); // same shape as the native Esc cancel
    expect(dialog().open).toBe(true); // our handler didn't close → ✕ didn't either
  });

  it("with the default cancel handler, ✕ and Esc (cancel) both close the modal", () => {
    const { ui } = makeUI();
    open(ui, html`<h2>Title</h2>`);
    click(".modal-x");
    expect(dialog().open).toBe(false);

    open(ui, html`<h2>Title</h2>`);
    dialog().dispatchEvent(new Event("cancel", { cancelable: true })); // what Esc produces
    expect(dialog().open).toBe(false);
  });

  it("a backdrop click (target === dialog) closes the modal", () => {
    const { ui } = makeUI();
    open(ui, html`<h2>Title</h2>`);
    dialog().click();
    expect(dialog().open).toBe(false);
  });

  it("emergency modal: ✕ resolves the pending choice as decline, exactly once", () => {
    const { ui } = makeUI();
    const onResolve = vi.fn();
    ui.showEventChoice("A fire has broken out!", "$50,000", onResolve);
    expect(dialog().querySelector('[data-act="close"]')).toBeNull(); // two choices only
    click(".modal-x");
    expect(onResolve).toHaveBeenCalledExactlyOnceWith("decline");
    expect(dialog().open).toBe(false);
    // A stray second cancel (e.g. Esc racing the close) must not double-resolve.
    dialog().dispatchEvent(new Event("cancel", { cancelable: true }));
    expect(onResolve).toHaveBeenCalledTimes(1);
  });

  it("emergency modal: accept button resolves accept and closes the modal", () => {
    const { ui } = makeUI();
    const onResolve = vi.fn();
    ui.showEventChoice("Bomb threat!", "$100,000", onResolve);
    click('[data-act="accept"]');
    expect(onResolve).toHaveBeenCalledExactlyOnceWith("accept");
    expect(dialog().open).toBe(false); // finish() closed before resolving
  });

  it("emergency modal: a backdrop click resolves decline exactly once and closes", () => {
    const { ui } = makeUI();
    const onResolve = vi.fn();
    ui.showEventChoice("A fire has broken out!", "$50,000", onResolve);
    // showEventChoice overrides finishModal's default backdrop handler with its
    // own decline path; fire a backdrop click (target === the dialog itself).
    dialog().click();
    expect(onResolve).toHaveBeenCalledExactlyOnceWith("decline");
    expect(dialog().open).toBe(false);
  });

  it("emergency modal: a first-action Esc/cancel resolves decline exactly once", () => {
    const { ui } = makeUI();
    const onResolve = vi.fn();
    ui.showEventChoice("A fire has broken out!", "$50,000", onResolve);
    dialog().dispatchEvent(new Event("cancel", { cancelable: true })); // Esc
    expect(onResolve).toHaveBeenCalledExactlyOnceWith("decline");
    expect(dialog().open).toBe(false);
  });

  it("emergency modal: a second button press cannot double-resolve the choice", () => {
    const { ui } = makeUI();
    const onResolve = vi.fn();
    ui.showEventChoice("Bomb threat!", "$100,000", onResolve);
    const accept = dialog().querySelector<HTMLButtonElement>('[data-act="accept"]')!;
    const decline = dialog().querySelector<HTMLButtonElement>('[data-act="decline"]')!;
    accept.click(); // resolves accept, closes the modal, and sets the done latch
    // The decline button is now detached but its @click listener is still live;
    // a racing double-tap must not resolve a second time.
    decline.click();
    expect(onResolve).toHaveBeenCalledExactlyOnceWith("accept");
  });
});

describe("openModalTemplate — the lit mount path shares the window grammar", () => {
  it("wraps a template in .modal-box.win, skins the top-level h2, and shows the dialog", () => {
    const { ui } = makeUI();
    const box = ui.openModalTemplate(html`<h2>Title</h2><p>body</p>`);
    expect(box.classList.contains("modal-box")).toBe(true);
    expect(box.classList.contains("win")).toBe(true);
    expect(box.querySelector(":scope > h2")!.classList.contains("win-title")).toBe(true);
    expect(dialog().open).toBe(true);
  });

  it("appends exactly one ✕ as the LAST child of the title bar, with the shared recipe", () => {
    const { ui } = makeUI();
    const box = ui.openModalTemplate(html`<h2>Title</h2><button class="btn primary">OK</button>`);
    const title = box.querySelector(":scope > h2")!;
    const xs = box.querySelectorAll<HTMLButtonElement>(".modal-x");
    expect(xs.length).toBe(1);
    expect(title.lastElementChild).toBe(xs[0]);
    expect([...xs[0].classList].sort()).toEqual(["btn", "modal-x", "xs"]);
    expect(xs[0].getAttribute("aria-label")).toBe("Close");
  });

  it("the ✕ closes through the dialog's cancel path", () => {
    const { ui } = makeUI();
    ui.openModalTemplate(html`<h2>Title</h2>`);
    expect(dialog().open).toBe(true);
    click(".modal-x");
    expect(dialog().open).toBe(false);
  });

  it("Esc/cancel closes the template modal", () => {
    const { ui } = makeUI();
    ui.openModalTemplate(html`<h2>Title</h2>`);
    dialog().dispatchEvent(new Event("cancel", { cancelable: true }));
    expect(dialog().open).toBe(false);
  });

  it("renders a fresh box per open: reopening leaves exactly one box and one ✕", () => {
    const { ui } = makeUI();
    ui.openModalTemplate(html`<h2>First</h2>`);
    ui.closeModal();
    const box2 = ui.openModalTemplate(html`<h2>Second</h2>`);
    expect(dialog().querySelectorAll(".modal-box").length).toBe(1);
    expect(dialog().querySelectorAll(".modal-x").length).toBe(1);
    expect(box2.querySelector(":scope > h2")!.textContent).toContain("Second");
  });

  it("wires aria-labelledby to the title-text span for the lit mount path too", () => {
    const { ui } = makeUI();
    const box = ui.openModalTemplate(html`<h2>Set all offices</h2><p>body</p>`);
    const labelId = dialog().getAttribute("aria-labelledby");
    expect(labelId).toBeTruthy();
    const title = box.querySelector(":scope > h2")!;
    const titleSpan = document.getElementById(labelId!)!;
    expect(titleSpan.tagName).toBe("SPAN"); // labeled at the span, not the h2
    expect(titleSpan.parentElement).toBe(title);
    expect(titleSpan.textContent).toContain("Set all offices");
  });

  it("relabels cleanly on close/reopen: same shared id, no dangling reference while closed, no duplicate ids", () => {
    const { ui } = makeUI();
    ui.openModalTemplate(html`<h2>First</h2>`);
    const firstId = dialog().getAttribute("aria-labelledby");
    expect(firstId).toBeTruthy();

    ui.closeModal();
    expect(dialog().hasAttribute("aria-labelledby")).toBe(false); // nothing visible to dangle a reference to

    ui.openModalTemplate(html`<h2>Second</h2>`);
    const secondId = dialog().getAttribute("aria-labelledby");
    expect(secondId).toBe(firstId); // the shared id is reused, now naming the new title
    expect(document.getElementById(secondId!)!.textContent).toContain("Second");
    expect(document.querySelectorAll(`#${secondId}`).length).toBe(1); // never two elements sharing the id
  });

  it("stays idempotent if finishModal ever ran twice over the same rendered title bar, without wiping the DOM in between", () => {
    // Regression guard (Copilot review on #405): finishModal's `while
    // (h2.firstChild) …` used to move EVERY child of the h2, including a ✕
    // appended by an earlier run, into a freshly nested span. A second call
    // on the same title bar should reuse the existing span and leave the ✕
    // where it is instead of nesting spans or folding "Close" into the
    // accessible name.
    const { ui } = makeUI();
    const box = ui.openModalTemplate(html`<h2>Settings</h2><p>body</p>`);
    const dlg = dialog();

    // Drive finishModal a second time over the SAME dialog/box DOM: no close,
    // no innerHTML wipe, the exact repeat-mount scenario the review flagged.
    (ui as any).finishModal(dlg, box);

    const titleId = "verticopolis-modal-title"; // the shared MODAL_TITLE_ID (private to UI.ts)
    const spans = box.querySelectorAll(`#${titleId}`);
    expect(spans.length).toBe(1); // exactly one title span, never nested
    const titleSpan = spans[0] as HTMLElement;
    expect(titleSpan.querySelector(`#${titleId}`)).toBeNull(); // not nested inside itself

    expect(titleSpan.textContent).not.toContain("Close");
    expect(titleSpan.textContent).not.toContain("✕");
    expect(titleSpan.textContent).toContain("Settings");

    const labelId = dlg.getAttribute("aria-labelledby");
    expect(labelId).toBe(titleId);
    expect(document.getElementById(labelId!)).toBe(titleSpan);

    expect(box.querySelectorAll(".modal-x").length).toBe(1); // no duplicate close button either
  });
});

describe("confirmModal — lit template mount", () => {
  it("closes the dialog BEFORE running onYes, so the callback sees a torn-down modal", () => {
    const { ui } = makeUI();
    let openWhenCalled: boolean | null = null;
    ui.confirmModal("Start over?", "This abandons your tower.", () => {
      openWhenCalled = dialog().open;
    });
    click('[data-act="yes"]');
    expect(openWhenCalled).toBe(false);
  });

  it("its title-bar ✕ uses the shared recipe and closes via cancel without firing onYes", () => {
    const { ui } = makeUI();
    const onYes = vi.fn();
    ui.confirmModal("Start over?", "This abandons your tower.", onYes);
    const x = dialog().querySelector<HTMLButtonElement>("h2 > .modal-x")!;
    expect(x).not.toBeNull();
    expect([...x.classList].sort()).toEqual(["btn", "modal-x", "xs"]);
    x.click();
    expect(dialog().open).toBe(false);
    expect(onYes).not.toHaveBeenCalled();
  });
});

describe("aria-labelledby across the real dialogs: every modal names itself for a screen reader", () => {
  // Every show* method funnels through finishModal, so this pins the
  // contract end to end (not just the shared primitive) across dialogs with
  // very different wiring: a plain wireActions dialog, a caller-supplied
  // title, and the emergency dialog that overrides oncancel and renders no
  // [data-act="close"] button at all.
  const titleFor = (): Element => {
    const id = dialog().getAttribute("aria-labelledby");
    expect(id, "expected #modal to carry aria-labelledby").toBeTruthy();
    const el = document.getElementById(id!);
    expect(el, `expected an element with id="${id}" in the document`).not.toBeNull();
    return el!;
  };

  it("showStats labels the dialog with the rendered title", () => {
    const { ui } = makeUI();
    ui.showStats(html`<p>numbers</p>`);
    expect(titleFor().textContent).toContain("Tower Statistics");
  });

  it("showHelp labels the dialog with the rendered title", () => {
    const { ui } = makeUI();
    ui.showHelp();
    expect(titleFor().textContent).toContain("How to play");
  });

  it("confirmModal labels the dialog with the caller-supplied title, not a generic string", () => {
    const { ui } = makeUI();
    ui.confirmModal("Start a new tower?", "This abandons your tower.", () => {});
    expect(titleFor().textContent).toContain("Start a new tower?");
  });

  it("showEventChoice (custom oncancel, no [data-act=close]) still labels the dialog", () => {
    const { ui } = makeUI();
    ui.showEventChoice("A fire has broken out!", "$50,000", () => {});
    expect(titleFor().textContent).toContain("Emergency");
  });

  it("swapping from one modal straight into another (saves → export confirm) relabels instead of stacking a stale id", () => {
    const { ui } = makeUI();
    ui.showSaves([]);
    expect(titleFor().textContent).toContain("Saved Towers");
    const labelId = dialog().getAttribute("aria-labelledby")!;
    click('[data-act="export"]');
    expect(titleFor().textContent).toContain("Export tower?");
    // Same shared id, but now only one element in the whole document carries
    // it: the saves dialog's old title node is gone, not orphaned.
    expect(dialog().getAttribute("aria-labelledby")).toBe(labelId);
    expect(document.querySelectorAll(`#${labelId}`).length).toBe(1);
  });
});

describe("renderEditor — lit diff patches in place; delegated actions dispatch", () => {
  const editorEl = (): HTMLElement => document.getElementById("editor")!;

  /** A small built tower with an occupied office, so the card carries the
   *  rename input, the rent adjuster, and live stat cells. Modern, so the
   *  card carries the '+ rent' stepper this identity regression pins (the
   *  Classic card renders the rung picker instead; see editor.test.ts). */
  function officeSim(): { sim: Simulation; office: Unit } {
    const sim = new Simulation(12345, "modern");
    for (let x = 10; x < 30; x++) expect(sim.tower.place("lobby", 1, x).ok).toBe(true);
    for (let x = 10; x < 30; x++) expect(sim.tower.place("floor", 2, x).ok).toBe(true);
    const r = sim.tower.place("office", 2, 12);
    expect(r.ok).toBe(true);
    const office = sim.tower.units.find((u) => u.id === r.unitId)!;
    office.state = "occupied";
    return { sim, office };
  }

  it("a refresh patches changed cells in place; buttons and the rename input keep identity", () => {
    const { ui } = makeUI();
    const { sim, office } = officeSim();
    office.satisfaction = 0.5;
    ui.renderEditor(unitEditorTemplate(sim, office));
    expect(ui.isEditorOpen()).toBe(true);
    const btn = editorEl().querySelector<HTMLElement>('[data-edit="rentUp"]')!;
    const name = editorEl().querySelector<HTMLInputElement>("#ed-name")!;
    const evalCell = editorEl().querySelector('[data-field="eval"]')!;
    expect(evalCell.textContent).toContain("50%");

    office.satisfaction = 0.78;
    ui.renderEditor(unitEditorTemplate(sim, office));
    expect(evalCell.textContent).toContain("78%");
    expect(editorEl().querySelector('[data-edit="rentUp"]')).toBe(btn); // no swallowed click
    expect(editorEl().querySelector("#ed-name")).toBe(name);
  });

  it("a refresh landing between pointerdown and pointerup does not recreate the pressed button (the '+ rent' bug)", () => {
    const { ui, cb } = makeUI();
    const { sim, office } = officeSim();
    ui.renderEditor(unitEditorTemplate(sim, office));
    const btn = editorEl().querySelector<HTMLElement>('[data-edit="rentUp"]')!;

    // Press... the main loop's refresh gate (editorBusy) arms,
    btn.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(ui.isEditorBusy()).toBe(true);
    // ...but even a refresh that slips through mid-click keeps the element:
    office.satisfaction = 0.9;
    ui.renderEditor(unitEditorTemplate(sim, office));
    expect(editorEl().querySelector('[data-edit="rentUp"]')).toBe(btn);
    // ...release, and the click that began before the refresh still lands.
    document.dispatchEvent(new Event("pointerup", { bubbles: true }));
    expect(ui.isEditorBusy()).toBe(false);
    btn.click();
    expect(cb.onEditAction).toHaveBeenCalledExactlyOnceWith("rentUp", editorEl());
  });

  it("[data-edit] clicks dispatch through the delegated listener after any re-render", () => {
    const { ui, cb } = makeUI();
    const { sim, office } = officeSim();
    ui.renderEditor(unitEditorTemplate(sim, office));
    office.state = "gutted"; // shape change: rows restructure
    ui.renderEditor(unitEditorTemplate(sim, office));
    editorEl().querySelector<HTMLElement>('[data-edit="sell"]')!.click();
    expect(cb.onEditAction).toHaveBeenCalledExactlyOnceWith("sell", editorEl());
  });

  it("the Classic rung picker's change event dispatches through the delegated listener, and renderEditor syncs its selection", () => {
    const { ui, cb } = makeUI();
    const sim = new Simulation(); // Classic: the card renders the rung picker
    for (let x = 10; x < 30; x++) expect(sim.tower.place("lobby", 1, x).ok).toBe(true);
    for (let x = 10; x < 30; x++) expect(sim.tower.place("floor", 2, x).ok).toBe(true);
    const r = sim.tower.place("office", 2, 12);
    expect(r.ok).toBe(true);
    const office = sim.tower.units.find((u) => u.id === r.unitId)!;
    office.state = "occupied";
    ui.renderEditor(unitEditorTemplate(sim, office));
    const select = editorEl().querySelector<HTMLSelectElement>("#ed-rung")!;
    expect(select.value).toBe("2"); // renderEditor synced the Average selection post-render
    select.value = "3";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    expect(cb.onEditAction).toHaveBeenCalledExactlyOnceWith("rung", editorEl());
    // An engine-side change re-syncs the picker on the next pump render.
    sim.priceUnit(office, 2_000);
    ui.renderEditor(unitEditorTemplate(sim, office));
    expect(editorEl().querySelector<HTMLSelectElement>("#ed-rung")!.value).toBe("0");
  });

  it("hideEditor clears the card through lit and a later render reopens it", () => {
    const { ui } = makeUI();
    const { sim, office } = officeSim();
    ui.renderEditor(unitEditorTemplate(sim, office));
    ui.hideEditor();
    expect(ui.isEditorOpen()).toBe(false);
    expect(editorEl().textContent?.trim()).toBe("");
    expect(editorEl().querySelector("[data-edit]")).toBeNull();

    ui.renderEditor(unitEditorTemplate(sim, office));
    expect(ui.isEditorOpen()).toBe(true);
    expect(editorEl().querySelector('[data-edit="sell"]')).not.toBeNull();
  });

  it("the editor card's title-bar ✕ hides it via the delegated listener", () => {
    const { ui } = makeUI();
    const { sim, office } = officeSim();
    ui.renderEditor(unitEditorTemplate(sim, office));
    expect(ui.isEditorOpen()).toBe(true);
    editorEl().querySelector<HTMLElement>(".ed-close")!.click();
    expect(ui.isEditorOpen()).toBe(false);
  });
});

describe("export/import — file downloads and the file picker, no copy-paste path", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete (URL as { createObjectURL?: unknown }).createObjectURL;
    delete (URL as { revokeObjectURL?: unknown }).revokeObjectURL;
  });

  it("downloadFile clicks a temporary <a download> at a blob URL of the contents, revoking it only later", () => {
    vi.useFakeTimers();
    const { ui } = makeUI();
    const blobs: Blob[] = [];
    (URL as { createObjectURL?: unknown }).createObjectURL = vi.fn((b: Blob) => {
      blobs.push(b);
      return "blob:vctower";
    });
    const revoke = ((URL as { revokeObjectURL?: unknown }).revokeObjectURL = vi.fn());
    const clicks: { href: string; download: string }[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clicks.push({ href: this.href, download: this.download });
    });

    ui.downloadFile("my-tower.vctower", "VCTOWER1\npayload");
    expect(clicks).toEqual([{ href: "blob:vctower", download: "my-tower.vctower" }]);
    expect(blobs).toHaveLength(1);
    // Revoking in the click's own task can abort the download on engines that
    // resolve blob URLs asynchronously — it must be deferred, then still happen.
    expect(revoke).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(revoke).toHaveBeenCalledExactlyOnceWith("blob:vctower");
    vi.useRealTimers();
  });

  it("downloadFile hands the export to the platform port with the octet-stream MIME", () => {
    const saveFile = vi.fn(() => Promise.resolve());
    vi.spyOn(platformModule, "getPlatform").mockReturnValue({
      isNativeWrapper: true,
      saveFile,
      openExternal: () => {},
    });
    const { ui } = makeUI();
    ui.downloadFile("my-tower.vctower", "VCTOWER1\npayload");
    expect(saveFile).toHaveBeenCalledExactlyOnceWith("my-tower.vctower", "VCTOWER1\npayload", "application/octet-stream");
  });

  it("downloadFile toasts when the port's saveFile rejects (a native real-failure path)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(platformModule, "getPlatform").mockReturnValue({
      isNativeWrapper: true,
      saveFile: () => Promise.reject(new Error("disk full")),
      openExternal: () => {},
    });
    const { ui } = makeUI();
    ui.downloadFile("t.vctower", "payload");
    await vi.waitFor(() => {
      const toasts = [...document.getElementById("toast-wrap")!.children];
      expect(toasts.some((t) => t.className.includes("bad") && t.textContent!.includes("Couldn't save your tower file"))).toBe(true);
    });
  });

  it("downloadFile survives a broken port whose saveFile throws synchronously, and still toasts", async () => {
    // A bridged shell returning undefined or throwing outright is the exact
    // contract slip the port guards against; it must reach the same toast,
    // not become an uncaught TypeError at the export call site.
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(platformModule, "getPlatform").mockReturnValue({
      isNativeWrapper: true,
      saveFile: (() => {
        throw new Error("no bridge");
      }) as unknown as () => Promise<void>,
      openExternal: () => {},
    });
    const { ui } = makeUI();
    expect(() => ui.downloadFile("t.vctower", "payload")).not.toThrow();
    await vi.waitFor(() => {
      const toasts = [...document.getElementById("toast-wrap")!.children];
      expect(toasts.some((t) => t.className.includes("bad") && t.textContent!.includes("Couldn't save your tower file"))).toBe(true);
    });
  });

  it("Export asks first: the file is only built and downloaded after clicking Export in the confirm dialog", () => {
    const { ui, cb } = makeUI();
    openExportConfirm(ui);
    expect(dialog().open).toBe(true);
    expect(cb.onExport).not.toHaveBeenCalled(); // nothing serialized yet
    const primary = dialog().querySelector('[data-act="export"]')!;
    expect(primary.textContent).toBe("Export"); // not a generic "Confirm"
    expect(primary.classList.contains("primary")).toBe(true); // one primary per dialog
    click('[data-act="close"]'); // cancel → still no export
    expect(cb.onExport).not.toHaveBeenCalled();

    openExportConfirm(ui);
    click('[data-act="export"]');
    expect(cb.onExport).toHaveBeenCalledTimes(1);
    expect(dialog().open).toBe(false); // the toast isn't hidden under the modal
  });

  it("the confirm dialog's secondary routes to the 1994 export flow, never the .vctower one", () => {
    const { ui, cb } = makeUI();
    openExportConfirm(ui);
    click('[data-act="legacy"]');
    expect(cb.onExportLegacy).toHaveBeenCalledTimes(1);
    expect(cb.onExport).not.toHaveBeenCalled();
    expect(dialog().open).toBe(false);
  });

  it("the 1994 export is disabled for a Modern tower (Classic only)", () => {
    const { ui, cb } = makeUI({ getMode: () => "modern" as const });
    openExportConfirm(ui);
    const legacy = document.querySelector('[data-act="legacy"]') as HTMLButtonElement;
    expect(legacy.disabled).toBe(true);
    legacy.click(); // a disabled button fires nothing
    expect(cb.onExportLegacy).not.toHaveBeenCalled();
    // the primary .vctower export still works
    click('[data-act="export"]');
    expect(cb.onExport).toHaveBeenCalledTimes(1);
  });

  it("Import (from the Saves dialog) goes straight to the file picker, no textarea, accepting .vctower first", () => {
    const { ui } = makeUI();
    const picker = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});
    openImportPicker(ui);
    expect(picker).toHaveBeenCalledTimes(1);
    expect(dialog().open).toBe(false);
    expect(document.querySelector("textarea")).toBeNull();
    const input = document.getElementById("import-file") as HTMLInputElement;
    expect(input.accept.startsWith(".vctower")).toBe(true);
  });

  it("the Saved Towers dialog closes when the picker launches, and a picked tower file routes to onImport", async () => {
    const { ui, cb } = makeUI();
    vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});
    ui.showSaves([]); // launch the picker from the Saved Towers dialog
    click('[data-act="import"]');
    // The dialog's top layer would paint over any import feedback — it yields
    // to the picker immediately rather than lingering underneath it.
    expect(dialog().open).toBe(false);
    const input = document.getElementById("import-file") as HTMLInputElement;
    const file = new File(["VCTOWER1\npayload"], "tower.vctower");
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    input.onchange!(new Event("change"));
    await vi.waitFor(() => expect(cb.onImport).toHaveBeenCalledExactlyOnceWith("VCTOWER1\npayload"));
  });

  it("a picked .TDT legacy save is read as bytes and routed to onImportLegacy", async () => {
    const { ui, cb } = makeUI();
    vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});
    openImportPicker(ui);
    const input = document.getElementById("import-file") as HTMLInputElement;
    // The accept list offers exactly .vctower + the legacy .tdt extension,
    // pinned in full so no other extension can sneak back in.
    expect(input.accept).toBe(".vctower,application/octet-stream,.tdt,.TDT");
    const file = new File([new Uint8Array([0x00, 0x24, 1, 2])], "MYTOWER.TDT");
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    input.onchange!(new Event("change"));
    await vi.waitFor(() => expect(cb.onImportLegacy).toHaveBeenCalledTimes(1));
    const [buf, name] = vi.mocked(cb.onImportLegacy).mock.calls[0];
    expect(name).toBe("MYTOWER.TDT");
    expect(new Uint8Array(buf)).toEqual(new Uint8Array([0x00, 0x24, 1, 2]));
    expect(cb.onImport).not.toHaveBeenCalled();
  });

  it("a UTF-16 (BOM) .vctower still decodes to the same text, like readAsText did", async () => {
    const { ui, cb } = makeUI();
    vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});
    openImportPicker(ui);
    const input = document.getElementById("import-file") as HTMLInputElement;
    // A save re-saved by an editor as UTF-16LE: BOM FF FE, then 2-byte chars.
    const text = "VCTOWER1\npayload";
    const bytes = new Uint8Array(2 + text.length * 2);
    bytes[0] = 0xff;
    bytes[1] = 0xfe;
    for (let i = 0; i < text.length; i++) bytes[2 + i * 2] = text.charCodeAt(i);
    const file = new File([bytes], "tower.vctower");
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    input.onchange!(new Event("change"));
    await vi.waitFor(() => expect(cb.onImport).toHaveBeenCalledExactlyOnceWith(text));
    expect(cb.onImportLegacy).not.toHaveBeenCalled();
  });

  it("a RENAMED legacy save (wrong extension, 0x2400 magic) still routes to onImportLegacy", async () => {
    const { ui, cb } = makeUI();
    vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});
    openImportPicker(ui);
    const input = document.getElementById("import-file") as HTMLInputElement;
    // DOS-era copies often lost their extension: the header-magic sniff, not
    // the filename, must decide.
    const file = new File([new Uint8Array([0x00, 0x24, 9, 9])], "TOWER1.SAV");
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    input.onchange!(new Event("change"));
    await vi.waitFor(() => expect(cb.onImportLegacy).toHaveBeenCalledTimes(1));
    expect(vi.mocked(cb.onImportLegacy).mock.calls[0][1]).toBe("TOWER1.SAV");
    expect(cb.onImport).not.toHaveBeenCalled();
  });
});

describe("import fidelity report: nothing adopted until the player opens it", () => {
  const report = () => ({
    towerName: "GRAND",
    star: 3,
    money: 1_500_000,
    day: 3,
    floors: 5,
    basements: 1,
    unitsImported: 9,
    broughtOver: ["$1,500,000 in funds and your 3-star rating."],
    couldNotBring: ["Elevators were rebuilt from your floor layout."],
  });

  it("shows the tower facts and both lists; Open tower fires onOpen and closes", () => {
    const { ui } = makeUI();
    const onOpen = vi.fn();
    ui.showImportReport(report(), { onOpen });
    expect(dialog().open).toBe(true);
    // The modal takes focus, but the polite region tells a screen reader WHY a
    // dialog appeared when the file finishes reading.
    expect(document.getElementById("a11y-live")!.textContent).toBe("SimTower import report ready.");
    const text = dialog().textContent!;
    expect(text).toContain("GRAND");
    expect(text).toContain("Brought over");
    expect(text).toContain("Couldn't bring over");
    expect(text).toContain("Elevators were rebuilt from your floor layout.");
    click('[data-act="open"]');
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(dialog().open).toBe(false);
  });

  it("Cancel dismisses without adopting anything", () => {
    const { ui } = makeUI();
    const onOpen = vi.fn();
    ui.showImportReport(report(), { onOpen });
    click('[data-act="close"]');
    expect(onOpen).not.toHaveBeenCalled();
    expect(dialog().open).toBe(false);
  });

  it("report content is escaped: a hostile tower name can't inject markup", () => {
    const { ui } = makeUI();
    const hostile = { ...report(), towerName: "<img src=x onerror=alert(1)>" };
    ui.showImportReport(hostile, { onOpen: vi.fn() });
    expect(dialog().querySelector("img")).toBeNull();
    expect(dialog().textContent).toContain("<img src=x onerror=alert(1)>");
  });

  it("never clobbers a live blocking modal: the report yields with a toast instead", () => {
    // An emergency choice can open while the OS file picker is up (the picker
    // isn't a modal); replacing its DOM would strand its resolve and freeze
    // the sim, so the report must refuse to open over it.
    const { ui } = makeUI();
    const onResolve = vi.fn();
    ui.showEventChoice("A fire has broken out!", "$20,000", onResolve);
    const onOpen = vi.fn();
    ui.showImportReport(report(), { onOpen });
    // The emergency modal survives untouched and can still resolve.
    expect(dialog().textContent).toContain("A fire has broken out!");
    expect(document.getElementById("toast-wrap")!.textContent).toContain("Close the open dialog first");
    click('[data-act="decline"]');
    expect(onResolve).toHaveBeenCalledExactlyOnceWith("decline");
    expect(onOpen).not.toHaveBeenCalled();
  });
});

describe("export fidelity report: nothing downloads until the player confirms", () => {
  const exportReport = () => ({
    towerName: "GRAND",
    filename: "GRAND.TDT",
    star: 3,
    money: 1_500_000,
    floors: 5,
    basements: 1,
    roomsExported: 9,
    comesAlong: ["9 rooms with their occupancy and hotel states."],
    staysBehind: ["The income ledger and finance history start fresh in 1994."],
  });

  it("shows the facts and both lists; Download fires onDownload and closes", () => {
    const { ui } = makeUI();
    const onDownload = vi.fn();
    ui.showExportReport(exportReport(), { onDownload });
    expect(dialog().open).toBe(true);
    expect(document.getElementById("a11y-live")!.textContent).toBe("SimTower export summary ready.");
    const text = dialog().textContent!;
    expect(text).toContain("GRAND");
    expect(text).toContain("Comes along");
    expect(text).toContain("Stays behind");
    expect(text).toContain("GRAND.TDT");
    expect(onDownload).not.toHaveBeenCalled(); // two-step contract
    click('[data-act="download"]');
    expect(onDownload).toHaveBeenCalledTimes(1);
    expect(dialog().open).toBe(false);
  });

  it("Cancel downloads nothing; content is escaped against hostile tower names", () => {
    const { ui } = makeUI();
    const onDownload = vi.fn();
    ui.showExportReport(
      { ...exportReport(), towerName: "<img src=x onerror=alert(1)>" },
      { onDownload },
    );
    expect(dialog().querySelector("img")).toBeNull();
    expect(dialog().textContent).toContain("<img src=x onerror=alert(1)>");
    click('[data-act="close"]');
    expect(onDownload).not.toHaveBeenCalled();
    expect(dialog().open).toBe(false);
  });

  it("never clobbers a live blocking modal: yields with a toast instead", () => {
    const { ui } = makeUI();
    const onResolve = vi.fn();
    ui.showEventChoice("A fire has broken out!", "$20,000", onResolve);
    const onDownload = vi.fn();
    ui.showExportReport(exportReport(), { onDownload });
    expect(dialog().textContent).toContain("A fire has broken out!");
    expect(document.getElementById("toast-wrap")!.textContent).toContain("Close the open dialog first");
    click('[data-act="decline"]');
    expect(onResolve).toHaveBeenCalledExactlyOnceWith("decline");
    expect(onDownload).not.toHaveBeenCalled();
  });
});

describe("toast — kind class and stack cap", () => {
  const wrap = (): HTMLElement => document.getElementById("toast-wrap")!;

  // Each toast schedules a real self-removal timer. Fake the clock so a
  // survivor's ~3.6s timer cannot fire on a detached node after the next test
  // remounts the DOM (the intermittent teardown fire behind #368). The
  // assertions below are all synchronous, so faking the clock changes nothing
  // they observe; clearAllTimers drops any pending toast timer at teardown.
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("stamps the kind class on the toast element (the left-edge color hook)", () => {
    const { ui } = makeUI();
    ui.toast("Office rented!", "good");
    ui.toast("A fire has broken out!", "bad");
    ui.toast("Just so you know");
    const [good, bad, info] = [...wrap().children];
    expect(good.className).toBe("toast good");
    expect(good.textContent).toBe("Office rented!");
    expect(bad.className).toBe("toast bad");
    expect(info.className).toBe("toast info"); // default kind
  });

  it("caps the stack at 5, evicting the oldest first", () => {
    const { ui } = makeUI();
    for (let i = 1; i <= 7; i++) ui.toast(`toast ${i}`);
    expect(wrap().children.length).toBe(5);
    expect(wrap().firstElementChild!.textContent).toBe("toast 3");
    expect(wrap().lastElementChild!.textContent).toBe("toast 7");
  });
});

describe("showHelp — the Report an issue link", () => {
  const CHOOSER = "https://github.com/maniator/verticopolis/issues/new/choose";

  // A leaked getPlatform mock would silently flip later tests into native
  // mode; restore unconditionally, even when an assertion fails mid-test.
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders a chooser link that opens in a new tab with rel=noopener", () => {
    const { ui } = makeUI();
    ui.showHelp();
    const link = dialog().querySelector<HTMLAnchorElement>(`a[href="${CHOOSER}"]`);
    expect(link, "expected a Report-an-issue link to the GitHub chooser").not.toBeNull();
    // A new tab (so the game isn't navigated away), with noopener+noreferrer so
    // the opened page can't reach back through window.opener or see the referrer.
    expect(link!.target).toBe("_blank");
    expect(link!.rel).toContain("noopener");
    expect(link!.rel).toContain("noreferrer");
    // A screen-reader-only cue warns that activating the link changes context to
    // a new tab (WCAG 3.2.5), without altering the visible label.
    const cue = link!.querySelector(".visually-hidden");
    expect(cue?.textContent).toContain("new tab");
  });

  it("routes activation through platform.openExternal inside a native wrapper", () => {
    const openExternal = vi.fn();
    vi.spyOn(platformModule, "getPlatform").mockReturnValue({
      isNativeWrapper: true,
      saveFile: () => Promise.resolve(),
      openExternal,
    });
    const { ui } = makeUI();
    ui.showHelp();
    const link = dialog().querySelector<HTMLAnchorElement>(`a[href="${CHOOSER}"]`)!;
    const click = new MouseEvent("click", { cancelable: true });
    link.dispatchEvent(click);
    // The wrapper's WebView must not navigate away: the anchor's default is
    // cancelled and the URL goes out through the port instead.
    expect(click.defaultPrevented).toBe(true);
    expect(openExternal).toHaveBeenCalledExactlyOnceWith(CHOOSER);
    // Middle-button activation fires auxclick, not click; it routes the same
    // way, while other buttons (e.g. right, whose menu already fired) don't.
    const middle = new MouseEvent("auxclick", { cancelable: true, button: 1 });
    link.dispatchEvent(middle);
    expect(middle.defaultPrevented).toBe(true);
    expect(openExternal).toHaveBeenCalledTimes(2);
    const right = new MouseEvent("auxclick", { cancelable: true, button: 2 });
    link.dispatchEvent(right);
    expect(right.defaultPrevented).toBe(false);
    expect(openExternal).toHaveBeenCalledTimes(2);
  });

  it("keeps the plain anchor in the browser: no interception at all", () => {
    // With the real (browser) platform, nothing intercepts the click,
    // preserving middle-click and context-menu semantics that a delegating
    // handler would break.
    const { ui } = makeUI();
    ui.showHelp();
    const link = dialog().querySelector<HTMLAnchorElement>(`a[href="${CHOOSER}"]`)!;
    // Listeners run in registration order, so this one (attached after
    // showHelp wired anything it was going to wire) observes whether the game
    // cancelled the default, then cancels it itself so happy-dom doesn't
    // actually navigate the test window to GitHub.
    let preventedByGame = true;
    link.addEventListener("click", (e) => {
      preventedByGame = e.defaultPrevented;
      e.preventDefault();
    });
    link.dispatchEvent(new MouseEvent("click", { cancelable: true }));
    expect(preventedByGame).toBe(false);
  });

  it("falls back to window.open when the wrapper's openExternal throws", () => {
    // The handler cancels the default before calling the port, so a throwing
    // wrapper hook must not leave the link dead.
    vi.spyOn(platformModule, "getPlatform").mockReturnValue({
      isNativeWrapper: true,
      saveFile: () => Promise.resolve(),
      openExternal: () => {
        throw new Error("bridge gone");
      },
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const { ui } = makeUI();
    ui.showHelp();
    const link = dialog().querySelector<HTMLAnchorElement>(`a[href="${CHOOSER}"]`)!;
    link.dispatchEvent(new MouseEvent("click", { cancelable: true }));
    expect(open).toHaveBeenCalledExactlyOnceWith(CHOOSER, "_blank", "noopener,noreferrer");
  });

  it("falls back to window.open when an async openExternal rejects (Capacitor-style Promise hook)", async () => {
    // A Promise-returning wrapper hook (Browser.open) that rejects after
    // preventDefault must reach the same fallback as a sync throw.
    vi.spyOn(platformModule, "getPlatform").mockReturnValue({
      isNativeWrapper: true,
      saveFile: () => Promise.resolve(),
      openExternal: () => Promise.reject(new Error("browser plugin failed")),
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const { ui } = makeUI();
    ui.showHelp();
    const link = dialog().querySelector<HTMLAnchorElement>(`a[href="${CHOOSER}"]`)!;
    link.dispatchEvent(new MouseEvent("click", { cancelable: true }));
    await vi.waitFor(() => expect(open).toHaveBeenCalledExactlyOnceWith(CHOOSER, "_blank", "noopener,noreferrer"));
  });

  it("puts the link in the modal BODY, leaving the footer at its two buttons", () => {
    const { ui } = makeUI();
    ui.showHelp();
    const box = dialog().firstElementChild!;
    const actions = box.querySelector(".modal-actions")!;
    // The report link is a body affordance, never a dialog action.
    expect(actions.querySelector('a[href*="/issues/new"]')).toBeNull();
    // Footer stays exactly replay-onboard / close (Got it); the preference
    // toggles live in the Settings dialog now.
    const acts = [...actions.querySelectorAll("[data-act]")].map((b) => b.getAttribute("data-act"));
    expect(acts).toEqual(["replay-onboard", "close"]);
  });

  it("hosts no settings controls: no sliders, no preference toggles", () => {
    const { ui } = makeUI();
    ui.showHelp();
    expect(dialog().querySelector("input[type=range]")).toBeNull();
    expect(dialog().querySelector('[data-act="reduce-motion"]')).toBeNull();
    expect(dialog().querySelector('[data-act="steady-clock"]')).toBeNull();
  });

  it("gives initial focus to the primary 'Got it', not the external link", () => {
    // showModal() focuses the first focusable descendant unless something has
    // autofocus. The report link sits above the footer in DOM order, so without
    // autofocus an Enter/Space reflex on opening Help would fire the external
    // link and pop a GitHub tab. autofocus on the primary keeps focus on the
    // safe dismiss action (and realizes the design-system's stated intent).
    const { ui } = makeUI();
    ui.showHelp();
    const box = dialog().firstElementChild!;
    expect(box.querySelector('[data-act="close"]')!.hasAttribute("autofocus")).toBe(true);
    expect(box.querySelector('a[href*="/issues/new"]')!.hasAttribute("autofocus")).toBe(false);
  });

  it("disables Replay while the title screen is up (replaying the intro is meaningless there)", () => {
    // showHelp reads #splash to gate the button. With the splash mounted the
    // Replay button must render disabled, which is the real production backstop
    // (a browser then suppresses the click) against replaying mid-title.
    const splash = document.createElement("div");
    splash.id = "splash";
    document.body.appendChild(splash);
    try {
      const { ui } = makeUI();
      ui.showHelp();
      const replay = dialog().querySelector<HTMLButtonElement>('[data-act="replay-onboard"]')!;
      expect(replay.disabled).toBe(true);
    } finally {
      splash.remove();
    }
  });

  it("wires Replay to onReplayOnboarding once the splash is gone", () => {
    // Off the splash the button is enabled and its inline @click must reach the
    // callback: this pins the controller closure that replaced the old manual
    // addEventListener wiring.
    const { ui, cb } = makeUI();
    ui.showHelp();
    const replay = dialog().querySelector<HTMLButtonElement>('[data-act="replay-onboard"]')!;
    expect(replay.disabled).toBe(false);
    replay.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(cb.onReplayOnboarding).toHaveBeenCalledTimes(1);
  });
});

describe("newTowerModal — the rule-set picker", () => {
  it("founds Classic by default (the pre-checked mode), with the harmless default calendar", () => {
    const onFound = vi.fn();
    const { ui } = makeUI();
    ui.newTowerModal({ hasSave: false, onFound });
    click('[data-act="found"]');
    expect(onFound).toHaveBeenCalledWith("classic", "realWorld", false);
    expect(dialog().open).toBe(false); // and it closes on commit
  });

  it("founds Modern when that radio is chosen (real-world calendar by default)", () => {
    const onFound = vi.fn();
    const { ui } = makeUI();
    ui.newTowerModal({ hasSave: false, onFound });
    dialog().querySelector<HTMLInputElement>('input[value="modern"]')!.checked = true;
    click('[data-act="found"]');
    expect(onFound).toHaveBeenCalledWith("modern", "realWorld", false);
  });

  it("passes the Modern short-calendar choice when picked", () => {
    const onFound = vi.fn();
    const { ui } = makeUI();
    ui.newTowerModal({ hasSave: false, onFound });
    dialog().querySelector<HTMLInputElement>('input[value="modern"]')!.checked = true;
    dialog().querySelector<HTMLInputElement>('input[name="nt-cal"][value="canon"]')!.checked = true;
    click('[data-act="found"]');
    expect(onFound).toHaveBeenCalledWith("modern", "canon", false);
  });

  it("passes Modern start-unbridged when the no-bridging checkbox is ticked", () => {
    const onFound = vi.fn();
    const { ui } = makeUI();
    ui.newTowerModal({ hasSave: false, onFound });
    dialog().querySelector<HTMLInputElement>('input[value="modern"]')!.checked = true;
    dialog().querySelector<HTMLInputElement>('input[name="nt-unbridged"]')!.checked = true;
    click('[data-act="found"]');
    expect(onFound).toHaveBeenCalledWith("modern", "realWorld", true);
  });

  it("ignores the no-bridging checkbox when founding Classic", () => {
    // The no-bridging option is Modern-only; a Classic founding pins false even
    // if the (Modern-only) checkbox was somehow ticked.
    const onFound = vi.fn();
    const { ui } = makeUI();
    ui.newTowerModal({ hasSave: false, onFound });
    dialog().querySelector<HTMLInputElement>('input[name="nt-unbridged"]')!.checked = true;
    click('[data-act="found"]');
    expect(onFound).toHaveBeenCalledWith("classic", "realWorld", false);
  });

  it("ignores the calendar radio when founding Classic (persists the harmless default)", () => {
    // A Classic save's calendar is derived, not read from the persisted field,
    // so persisting "canon" here would only quietly contradict the contract.
    const onFound = vi.fn();
    const { ui } = makeUI();
    ui.newTowerModal({ hasSave: false, onFound });
    // Classic pre-checked; a user toggles the Modern-calendar radio anyway.
    dialog().querySelector<HTMLInputElement>('input[name="nt-cal"][value="canon"]')!.checked = true;
    click('[data-act="found"]');
    expect(onFound).toHaveBeenCalledWith("classic", "realWorld", false);
  });

  it("cancels without founding anything", () => {
    const onFound = vi.fn();
    const { ui } = makeUI();
    ui.newTowerModal({ hasSave: true, onFound });
    click('[data-act="cancel"]');
    expect(onFound).not.toHaveBeenCalled();
    expect(dialog().open).toBe(false);
  });

  it("folds in the abandon warning only when a tower exists to lose", () => {
    const { ui } = makeUI();
    ui.newTowerModal({ hasSave: true, onFound: vi.fn() });
    expect(dialog().querySelector(".nt-abandon")).not.toBeNull();
    ui.closeModal();
    ui.newTowerModal({ hasSave: false, onFound: vi.fn() });
    expect(dialog().querySelector(".nt-abandon")).toBeNull();
  });
});

describe("event-log toast/bulletin pump (regression: froze at the cap; now a bounded rolling window)", () => {
  const LOG_DOM_CAP = 300; // mirror of the private cap in UI.ts
  beforeEach(() => mountAppDom());
  afterEach(() => vi.restoreAllMocks());

  it("keeps toasting and appending the bulletin past the log cap — never freezes", () => {
    const { ui } = makeUI();
    const sim = Simulation.newGame(1);
    ui.update(sim); // sync the UI cursor past any founding log entry
    const startSeq = sim.logSeq;
    const toastSpy = vi.spyOn(ui, "toast").mockImplementation(() => {});
    // Fire 320 good events (past the 300 buffer cap), pumping the UI each time.
    for (let i = 1; i <= 320; i++) {
      sim.emit(`event ${i}`, "good");
      ui.update(sim);
    }
    // Engine: the buffer is capped, but the cursor stays monotonic.
    expect(sim.log.length).toBe(300);
    expect(sim.logSeq - startSeq).toBe(320);
    // The bug froze toasts at the cap; now every good entry still toasts through 320…
    expect(toastSpy).toHaveBeenCalledTimes(320);
    expect(toastSpy).toHaveBeenLastCalledWith("event 320", "good");
    // …and the newest line is in the bulletin (it never stopped adding), while the
    // oldest was pruned out. Assert per-line node text, not the container's
    // concatenated textContent (adjacent lines have no separator, so a substring
    // check on the whole blob is a false-negative trap).
    const lines = Array.from(document.getElementById("log")!.children, (c) => c.textContent);
    expect(lines).toContain("event 320");
    expect(lines).not.toContain("event 1"); // oldest 20 (events 1..20) rolled off: 320 emits, 300-line DOM cap
  });

  it("holds the DOM node count constant under a long session (mobile-safe, can't crash)", () => {
    const { ui } = makeUI();
    const sim = Simulation.newGame(1);
    for (let i = 1; i <= 1000; i++) {
      sim.emit(`event ${i}`, i % 2 ? "good" : "info");
      if (i % 7 === 0) ui.update(sim); // realistic: UI is throttled, not every emit
    }
    ui.update(sim);
    const logEl = document.getElementById("log")!;
    // 1000 events later the DOM is still bounded to the cap — never unbounded growth.
    expect(logEl.childElementCount).toBeLessThanOrEqual(LOG_DOM_CAP);
    // …and still shows the newest (append + prune, not freeze).
    expect(logEl.textContent).toContain("event 1000");
  });

  it("caps toasts per frame on a catch-up burst but records every line in the bulletin", () => {
    const { ui } = makeUI();
    const sim = Simulation.newGame(1);
    ui.update(sim); // sync the cursor past the founding entry
    const toastSpy = vi.spyOn(ui, "toast").mockImplementation(() => {});
    // Backgrounded-tab / fast-forward: 50 good events flush between two frames.
    for (let i = 1; i <= 50; i++) sim.emit(`burst ${i}`, "good");
    ui.update(sim);
    // Only the newest few pop as toasts (TOAST_MAX=5) — not 50 transient nodes/timers…
    expect(toastSpy).toHaveBeenCalledTimes(5);
    expect(toastSpy).toHaveBeenLastCalledWith("burst 50", "good");
    expect(toastSpy).not.toHaveBeenCalledWith("burst 45", "good"); // 45 is the 6th-newest, past the cap
    // …but the bulletin recorded the whole batch (every line present as its own
    // node — scrollback intact, not just the toasted ones).
    const logEl = document.getElementById("log")!;
    const lines = Array.from(logEl.children, (c) => c.textContent);
    expect(lines).toContain("burst 1");
    expect(lines).toContain("burst 50");
  });

  it("keeps the bulletin line even when toast() throws (line is the durable record)", () => {
    const { ui } = makeUI();
    const sim = Simulation.newGame(1);
    ui.update(sim);
    vi.spyOn(ui, "toast").mockImplementation(() => {
      throw new Error("toast boom");
    });
    // A throwing toast must not drop the line or abort the pump.
    expect(() => {
      sim.emit("resilient line", "bad");
      ui.update(sim);
    }).not.toThrow();
    expect(document.getElementById("log")!.textContent).toContain("resilient line");
  });

  it("rebases the log cursor on a tower swap so old entries don't replay and new ones aren't skipped", () => {
    const { ui } = makeUI();
    const a = Simulation.newGame(1);
    for (let i = 0; i < 3; i++) {
      a.emit(`a${i}`, "good");
      ui.update(a);
    }
    const toastSpy = vi.spyOn(ui, "toast").mockImplementation(() => {});
    // Swap to a fresh tower (what adoptSim does) and rebase the cursor.
    const b = Simulation.newGame(2);
    ui.resetLog(b);
    b.emit("swapped tower event", "bad");
    ui.update(b);
    // Only b's new entry toasts — a's three don't replay, and b's isn't skipped.
    expect(toastSpy).toHaveBeenCalledTimes(1);
    expect(toastSpy).toHaveBeenCalledWith("swapped tower event", "bad");
    expect(document.getElementById("log")!.innerHTML).toContain("swapped tower event");
  });
});

describe("build palette — locked-tier visibility (SimTower parity)", () => {
  const palette = (): HTMLElement => document.getElementById("palette-scroll")!;
  const item = (kind: string): HTMLElement =>
    palette().querySelector<HTMLElement>(`.pal-item[data-kind="${kind}"]`)!;
  // A group's visibility now lives on its section (which wraps the title + items),
  // hidden as a unit when everything beneath is locked, so no dangling header.
  const section = (group: string): HTMLElement =>
    palette().querySelector<HTMLElement>(`.pal-group[data-group="${group}"]`)!;

  it("hides locked facilities and empty group headers at 1★, reveals them at 3★", () => {
    const { ui } = makeUI();
    const sim = Simulation.newGame(1);

    sim.star = 1;
    ui.update(sim);
    // 1★-unlocked kinds are shown; higher-tier kinds carry .locked (-> display:none).
    expect(item("office").classList.contains("locked")).toBe(false);
    expect(item("elevatorStandard").classList.contains("locked")).toBe(false);
    expect(item("hotelSingle").classList.contains("locked")).toBe(true); // 2★
    expect(item("restaurant").classList.contains("locked")).toBe(true); // 3★
    expect(item("cinema").classList.contains("locked")).toBe(true); // 3★
    expect(item("metro").classList.contains("locked")).toBe(true); // 4★
    // Groups with no unlocked member hide their whole section; populated ones stay.
    expect(section("Structure").hidden).toBe(false);
    expect(section("Commercial").hidden).toBe(false);
    expect(section("Leisure").hidden).toBe(true);
    expect(section("Services").hidden).toBe(true);
    expect(section("Special").hidden).toBe(true);

    sim.star = 3;
    ui.update(sim);
    // 2★/3★ kinds now reveal; their group sections appear.
    expect(item("hotelSingle").classList.contains("locked")).toBe(false);
    expect(item("restaurant").classList.contains("locked")).toBe(false);
    expect(item("cinema").classList.contains("locked")).toBe(false);
    expect(section("Leisure").hidden).toBe(false);
    expect(section("Services").hidden).toBe(false);
    // 4★/5★ kinds stay hidden until their tier.
    expect(item("metro").classList.contains("locked")).toBe(true);
    expect(section("Special").hidden).toBe(true);
  });

  it("dirty-gates the lock/afford scan: rescans only on a star or affordability crossing", () => {
    // E5-S3: the ~6 Hz pump must not walk the palette DOM when neither the star
    // nor any kind's affordability changed. The scan is observable through the
    // palette's querySelectorAll walks.
    const { ui } = makeUI();
    const sim = Simulation.newGame(1);
    sim.star = 1;
    // Mid-band funds: the costliest kinds sit at 1M and 3M, so 2M puts every
    // affordability comparison well away from a boundary.
    sim.money = 2_000_000;
    const scans = vi.spyOn(document.getElementById("palette-scroll")!, "querySelectorAll");
    ui.update(sim); // first pump after construction: always scans (2 walks)
    const afterFirst = scans.mock.calls.length;
    expect(afterFirst).toBeGreaterThan(0);
    ui.update(sim); // identical snapshot: skipped
    sim.money -= 1; // moves, but crosses no kind's cost boundary
    ui.update(sim);
    expect(scans.mock.calls.length).toBe(afterFirst);
    sim.money = 100; // crosses (nearly) every affordability boundary
    ui.update(sim);
    const afterCrossing = scans.mock.calls.length;
    expect(afterCrossing).toBeGreaterThan(afterFirst);
    // The DOM caught up with the crossing: offices are now unaffordable.
    expect(item("office").classList.contains("unaffordable")).toBe(true);
    sim.star = 3; // a star crossing rescans too
    ui.update(sim);
    expect(scans.mock.calls.length).toBeGreaterThan(afterCrossing);
    expect(item("restaurant").classList.contains("locked")).toBe(false);
    scans.mockRestore();
  });

  it("renders the tool-info panel through selectTool for every tool shape", () => {
    // Pins the E5-S2 wiring: lit renders into #tool-info on tool select. Covers
    // the boot default (the constructor clears the static placeholder and
    // selects Inspect), a build kind with a capacity row, a zero-population
    // structure kind (the conditional row drops to nothing), the same-template
    // value patch back to a populated kind, and the template-identity swap to
    // the bulldoze body.
    const { ui } = makeUI();
    const info = (): HTMLElement => document.getElementById("tool-info")!;
    // Boot: the constructor's initial selectTool painted the Inspect body. Pin
    // the stable .ti-name header, not the descriptive copy.
    expect(info().querySelector(".ti-name")!.textContent).toBe("Inspect");
    ui.selectTool({ type: "build", kind: "office" });
    expect(info().querySelector(".ti-name")!.textContent).toBe("Office");
    expect(info().textContent).toContain("Cost: $");
    expect(info().textContent).toContain("Capacity:");
    ui.selectTool({ type: "build", kind: "floor" });
    expect(info().textContent).not.toContain("Capacity:"); // zero-pop row gone
    ui.selectTool({ type: "build", kind: "office" });
    expect(info().textContent).toContain("Capacity:"); // and back, same template
    ui.selectTool({ type: "bulldoze" });
    expect(info().querySelector(".ti-name")!.textContent).toBe("Bulldoze");
    expect(info().textContent).not.toContain("Office"); // full body swapped
  });

  it("falls back to Inspect when the active build tool becomes locked after a lower-star swap", () => {
    const { ui, cb } = makeUI();
    const sim = Simulation.newGame(1);

    sim.star = 4;
    ui.update(sim);
    ui.selectTool({ type: "build", kind: "metro" });
    expect(ui.tool).toEqual({ type: "build", kind: "metro" });

    // Swap in a lower-star tower (load / new tower / undo) — Metro is now locked.
    sim.star = 1;
    ui.update(sim);
    expect(ui.tool).toEqual({ type: "inspect" });
    // The engine callback was notified of the reselection, not left stale.
    expect(cb.onSelectTool).toHaveBeenLastCalledWith({ type: "inspect" });
  });

  it("keeps an unlocked-but-unaffordable tool visible (only dimmed), not hidden", () => {
    const { ui } = makeUI();
    const sim = Simulation.newGame(1);
    sim.star = 1;
    sim.money = 0; // can't afford anything
    ui.update(sim);
    // Office is unlocked at 1★: not locked (still visible), just flagged unaffordable.
    expect(item("office").classList.contains("locked")).toBe(false);
    expect(item("office").classList.contains("unaffordable")).toBe(true);
  });
});

describe("wireControls — toolbar buttons route to callbacks (no dead buttons)", () => {
  it("speed buttons set the active highlight (one at a time) and report the speed", () => {
    const { cb } = makeUI();
    const btns = [...document.querySelectorAll<HTMLButtonElement>("#speed button[data-speed]")];
    btns[2].click(); // ▶▶ = speed 2
    expect(cb.onSpeed).toHaveBeenLastCalledWith(2);
    expect(btns[2].classList.contains("active")).toBe(true);
    btns[0].click(); // ⏸ = speed 0
    expect(cb.onSpeed).toHaveBeenLastCalledWith(0);
    expect(btns.filter((b) => b.classList.contains("active"))).toHaveLength(1); // only one active
  });

  it("end-to-end: a toggle persists and a reload shows the same muted topbar, no sync step (CAP-2)", () => {
    // Spans the REAL chain the unit tests only cross through mocks: the real
    // toggleMute command, real prefs persistence, and the real topbar glyph.
    // The topbar and the splash consume toggleMute through DIFFERENT channels:
    // the topbar via the ui.setAudioGlyph SIDE EFFECT, the splash via the
    // RETURN VALUE (Onboarding maps it onto its own button). This test pins
    // BOTH against the real command: the topbar glyph (side effect) and the
    // returned boolean (the splash's input); the splash unit test separately
    // proves the splash maps that boolean to its glyph.
    localStorage.clear();
    const audio = {
      started: true,
      muted: false,
      start() {
        this.started = true;
      },
      setMuted(m: boolean) {
        this.muted = m;
      },
    };
    const app = { audio, prefs: {} as Record<string, unknown>, ui: null as unknown as UI };
    let lastReturn: boolean | undefined;
    const { ui } = makeUI({ onToggleAudio: () => (lastReturn = toggleMute(app as never)), isMuted: () => false });
    app.ui = ui;

    const topbar = () => document.getElementById("audio-toggle")!;
    expect(topbar().textContent).toBe("🔊");
    topbar().click();
    expect(audio.muted).toBe(true);
    expect(topbar().textContent).toBe("🔇"); // topbar view: the setAudioGlyph side effect
    expect(lastReturn).toBe(true); // splash view: the real command returns the new state, not void
    expect(loadPrefs().muted).toBe(true); // persisted for real

    // Reload: a fresh DOM (mountAppDom replaces the body, so exactly one topbar
    // exists) + a fresh UI initialized from persisted prefs shows the muted
    // glyph immediately, no click and no cross-view sync step.
    mountAppDom();
    expect(document.querySelectorAll("#audio-toggle")).toHaveLength(1); // no stale toggle survives the reload
    makeUI({ isMuted: () => loadPrefs().muted === true });
    expect(topbar().textContent).toBe("🔇");
  });

  it("the Settings button opens the Settings dialog", () => {
    makeUI();
    document.getElementById("btn-settings")!.click();
    expect(dialog().open).toBe(true);
    // openModalTemplate appends its ✕ affordance inside the heading; match the title.
    expect(dialog().querySelector("h2")!.textContent).toContain("Settings");
  });

  it("undo / redo / load / stats each route to their callback", () => {
    const { cb } = makeUI();
    document.getElementById("btn-undo")!.click();
    document.getElementById("btn-redo")!.click();
    document.getElementById("btn-load")!.click();
    document.getElementById("btn-stats")!.click();
    expect(cb.onUndo).toHaveBeenCalledOnce();
    expect(cb.onRedo).toHaveBeenCalledOnce();
    expect(cb.onShowSaves).toHaveBeenCalledOnce();
    expect(cb.onShowStats).toHaveBeenCalledOnce();
  });

  it("the top-bar Quick Save button routes to the same onSave callback", () => {
    const { cb } = makeUI();
    document.getElementById("btn-save-top")!.click();
    expect(cb.onSave).toHaveBeenCalledOnce();
  });

  it("the panel toggle opens the mobile drawer; close and scrim shut it", () => {
    makeUI();
    document.getElementById("panel-toggle")!.click();
    expect(document.body.classList.contains("panels-open")).toBe(true);
    document.getElementById("panel-close")!.click();
    expect(document.body.classList.contains("panels-open")).toBe(false);
    document.getElementById("panel-toggle")!.click();
    document.getElementById("scrim")!.click();
    expect(document.body.classList.contains("panels-open")).toBe(false);
  });

  it("the overlay-mode select forwards its value to onSetOverlay", () => {
    const { cb } = makeUI();
    const sel = document.getElementById("overlay-mode") as HTMLSelectElement;
    sel.value = "congestion";
    sel.dispatchEvent(new Event("change"));
    expect(cb.onSetOverlay).toHaveBeenCalledWith("congestion");
  });

  it("renaming the tower forwards a trimmed name; a blank name falls back to Tower One", () => {
    const { cb } = makeUI();
    const name = document.getElementById("tower-name") as HTMLInputElement;
    name.value = "  Skyspire  ";
    name.dispatchEvent(new Event("change"));
    expect(cb.onRenameTower).toHaveBeenLastCalledWith("Skyspire");
    name.value = "   ";
    name.dispatchEvent(new Event("change"));
    expect(cb.onRenameTower).toHaveBeenLastCalledWith("Tower One");
  });
});

describe("showSettings: the Settings dialog", () => {
  it("renders all three sliders at the current volumes with percent readouts", () => {
    const { ui } = makeUI({ getVolumes: vi.fn(() => ({ music: 0.8, ambience: 0.4, sfx: 0.55 })) });
    ui.showSettings();
    const music = dialog().querySelector<HTMLInputElement>("#vol-music")!;
    const ambience = dialog().querySelector<HTMLInputElement>("#vol-ambience")!;
    const sfx = dialog().querySelector<HTMLInputElement>("#vol-sfx")!;
    expect(music.value).toBe("80");
    expect(ambience.value).toBe("40");
    expect(sfx.value).toBe("55");
    expect(dialog().querySelector('[data-vol-val="vol-music"]')!.textContent).toBe("80%");
    expect(dialog().querySelector('[data-vol-val="vol-ambience"]')!.textContent).toBe("40%");
    expect(dialog().querySelector('[data-vol-val="vol-sfx"]')!.textContent).toBe("55%");
  });

  it("slider input reports a 0..1 value to onSetVolume and updates the readout", () => {
    const { ui, cb } = makeUI();
    ui.showSettings();
    const music = dialog().querySelector<HTMLInputElement>("#vol-music")!;
    music.value = "30";
    music.dispatchEvent(new Event("input", { bubbles: true }));
    expect(cb.onSetVolume).toHaveBeenLastCalledWith("music", 0.3);
    expect(dialog().querySelector('[data-vol-val="vol-music"]')!.textContent).toBe("30%");
    const ambience = dialog().querySelector<HTMLInputElement>("#vol-ambience")!;
    ambience.value = "70";
    ambience.dispatchEvent(new Event("input", { bubbles: true }));
    expect(cb.onSetVolume).toHaveBeenLastCalledWith("ambience", 0.7);
    expect(dialog().querySelector('[data-vol-val="vol-ambience"]')!.textContent).toBe("70%");
    const sfx = dialog().querySelector<HTMLInputElement>("#vol-sfx")!;
    sfx.value = "0";
    sfx.dispatchEvent(new Event("input", { bubbles: true }));
    expect(cb.onSetVolume).toHaveBeenLastCalledWith("sfx", 0);
    expect(dialog().querySelector('[data-vol-val="vol-sfx"]')!.textContent).toBe("0%");
  });

  it("keeps sliders and switches in the modal BODY; the footer is exactly Close", () => {
    const { ui } = makeUI();
    ui.showSettings();
    const actions = dialog().querySelector(".modal-actions")!;
    expect(actions.querySelector("input")).toBeNull();
    expect(dialog().querySelectorAll("input[type=range]")).toHaveLength(3);
    // The two boolean prefs render as switches (checkbox with switch
    // semantics), each with a visible explanatory note.
    expect(dialog().querySelectorAll('input[role="switch"]')).toHaveLength(2);
    expect(dialog().querySelectorAll(".set-note")).toHaveLength(2);
    const acts = [...actions.querySelectorAll("[data-act]")].map((b) => b.getAttribute("data-act"));
    expect(acts).toEqual(["close"]);
  });

  it("explains the 1994 breathing clock in the Steady clock note", () => {
    const { ui } = makeUI();
    ui.showSettings();
    const note = document.getElementById("note-steady-clock")!;
    // The note must actually explain the behavior, not just name it.
    expect(note.textContent).toContain("1994");
    expect(note.textContent!.toLowerCase()).toContain("lunch");
    expect(dialog().querySelector("#set-steady-clock")!.getAttribute("aria-describedby")).toBe("note-steady-clock");
    expect(dialog().querySelector("#set-reduce-motion")!.getAttribute("aria-describedby")).toBe("note-reduce-motion");
  });

  it("the Steady clock switch follows the callback's returned state across toggles", () => {
    // A stateful stub (on, then off) makes a stuck switch or a stale-state
    // regression falsifiable; a constant stub would pass either bug.
    let steady = false;
    const toggle = vi.fn(() => (steady = !steady));
    const { ui, cb } = makeUI({ onToggleSteadyClock: toggle, isSteadyClock: vi.fn(() => steady) });
    ui.showSettings();
    const sw = dialog().querySelector<HTMLInputElement>("#set-steady-clock")!;
    // Fresh device: breathing clock on, so the "steady" pref reads off.
    expect(sw.checked).toBe(false);
    sw.click();
    expect(cb.onToggleSteadyClock).toHaveBeenCalledTimes(1);
    expect(sw.checked).toBe(true);
    sw.click();
    expect(sw.checked).toBe(false);
  });

  it("derives the switch's initial state from the live isSteadyClock callback", () => {
    const { ui } = makeUI({ isSteadyClock: vi.fn(() => true) });
    ui.showSettings();
    expect(dialog().querySelector<HTMLInputElement>("#set-steady-clock")!.checked).toBe(true);
  });

  it("wires the Reduced motion switch through onToggleReducedMotion", () => {
    const { ui, cb } = makeUI({ onToggleReducedMotion: vi.fn(() => true) });
    ui.showSettings();
    const sw = dialog().querySelector<HTMLInputElement>("#set-reduce-motion")!;
    expect(sw.checked).toBe(false);
    sw.click();
    expect(cb.onToggleReducedMotion).toHaveBeenCalledTimes(1);
    expect(sw.checked).toBe(true);
  });

  it("omits the Modern bridging switch in a Classic tower", () => {
    const { ui } = makeUI({ getMode: () => "classic" as const });
    ui.showSettings();
    expect(dialog().querySelector("#set-auto-bridge")).toBeNull();
  });

  it("follows the callback across toggles for the Modern bridging switch", () => {
    let on = true;
    const toggle = vi.fn(() => (on = !on));
    const { ui, cb } = makeUI({
      getMode: () => "modern" as const,
      isAutoBridge: vi.fn(() => on),
      onToggleAutoBridge: toggle,
    });
    ui.showSettings();
    const sw = dialog().querySelector<HTMLInputElement>("#set-auto-bridge")!;
    expect(sw.checked).toBe(true); // initial live state
    sw.click();
    expect(cb.onToggleAutoBridge).toHaveBeenCalledTimes(1);
    expect(sw.checked).toBe(false);
    sw.click();
    expect(sw.checked).toBe(true);
  });

  it("disables the Reduced motion switch with a (system) suffix when the OS forces it", () => {
    const original = window.matchMedia;
    window.matchMedia = (media: string) =>
      ({
        media,
        matches: media.includes("prefers-reduced-motion"),
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList;
    try {
      const { ui } = makeUI();
      ui.showSettings();
      const sw = dialog().querySelector<HTMLInputElement>("#set-reduce-motion")!;
      expect(sw.disabled).toBe(true);
      expect(sw.checked).toBe(true); // forced on IS on; the switch must not read off
      // Pin the full relabel string (not just the suffix) so a prefix regression is caught.
      expect(sw.closest("label")!.textContent).toContain("Reduced motion (system)");
    } finally {
      window.matchMedia = original;
    }
  });

  it("the Close button dismisses the Settings dialog", () => {
    const { ui } = makeUI();
    ui.showSettings();
    expect(dialog().open).toBe(true);
    click('[data-act="close"]');
    expect(dialog().open).toBe(false);
  });
});

describe("showSaves — the save-slot manager", () => {
  const slots = [
    { slot: "auto" as const, exists: true, present: true, towerName: "Auto Twr", star: 2, population: 300, funds: 50000, savedAt: 1_700_000_000_000 },
    { slot: 1, exists: true, present: true, towerName: "One", star: 6, population: 15000, funds: 1_000_000, savedAt: 1_700_000_000_000 },
    { slot: 2, exists: false, present: false },
  ];

  it("renders one row per slot with the right actions (auto: no Save/Delete; empty: Save only)", () => {
    const { ui } = makeUI();
    ui.showSaves(slots);
    const rows = dialog().querySelectorAll(".slot");
    expect(rows).toHaveLength(3);
    // Auto row: has Load, but no Save and no Delete.
    const auto = rows[0];
    expect(auto.querySelector("[data-save]")).toBeNull();
    expect(auto.querySelector('[data-load="auto"]')).not.toBeNull();
    expect(auto.querySelector("[data-del]")).toBeNull();
    // Filled numbered slot: Save + Load + Delete, and a 6★ tower reads TOWER.
    const one = rows[1];
    expect(one.querySelector('[data-save="1"]')).not.toBeNull();
    expect(one.querySelector('[data-load="1"]')).not.toBeNull();
    expect(one.querySelector('[data-del="1"]')).not.toBeNull();
    expect(one.textContent).toContain("TOWER");
    // Empty slot: Save only, no Load/Delete, and reads "empty".
    const two = rows[2];
    expect(two.querySelector('[data-save="2"]')).not.toBeNull();
    expect(two.querySelector("[data-load]")).toBeNull();
    expect(two.textContent).toContain("empty");
  });

  it("Save writes the slot and re-opens the manager; Load loads and closes; Delete deletes and re-opens", () => {
    const { ui, cb } = makeUI();
    ui.showSaves(slots);
    dialog().querySelector<HTMLElement>('[data-save="2"]')!.click();
    expect(cb.onSaveSlot).toHaveBeenCalledWith(2);
    expect(cb.onShowSaves).toHaveBeenCalledOnce(); // re-render

    ui.showSaves(slots);
    dialog().querySelector<HTMLElement>('[data-load="1"]')!.click();
    expect(cb.onLoadSlot).toHaveBeenCalledWith(1);
    expect(dialog().open).toBe(false); // Load closes the manager

    ui.showSaves(slots);
    dialog().querySelector<HTMLElement>('[data-del="1"]')!.click();
    expect(cb.onDeleteSlot).toHaveBeenCalledWith(1);
  });

  it("the Auto-save Load routes the special 'auto' slot id", () => {
    const { ui, cb } = makeUI();
    ui.showSaves(slots);
    dialog().querySelector<HTMLElement>('[data-load="auto"]')!.click();
    expect(cb.onLoadSlot).toHaveBeenCalledWith("auto");
  });
});

/**
 * The title screen's load-only tower picker controller
 * (SPEC-splash-load-tower CAP-3 / CAP-5). Row rendering is pinned in
 * `src/ui/templates/towerPicker.test.ts`; this covers the wiring the
 * controller owns.
 */
describe("showTowerPicker — the title-screen load picker", () => {
  const present = [
    { slot: "auto" as const, exists: true, present: true, towerName: "Auto Twr", star: 2, population: 300, funds: 50000, savedAt: 1_700_000_000_000 },
    { slot: 1, exists: false, present: false },
  ];

  it("loads a slot AND closes the dialog: adoption only takes the splash down", () => {
    // Adoption dismisses the title screen, but the shared <dialog> is a
    // separate surface in the top layer. Leaving it open would drop the player
    // onto their tower behind a live modal that also paints over the
    // "Press play to resume" toast.
    const { ui } = makeUI();
    const onLoad = vi.fn(() => true);
    ui.showTowerPicker({ getSlots: () => ({ slots: present, storageBlocked: false }), onLoad });
    dialog().querySelector<HTMLElement>('[data-picker="load"]')!.click();
    expect(onLoad).toHaveBeenCalledWith("auto");
    expect(dialog().open).toBe(false);
  });

  it("re-renders in place on repeated failures, never stacking a second picker", () => {
    const { ui } = makeUI();
    ui.showTowerPicker({ getSlots: () => ({ slots: present, storageBlocked: false }), onLoad: () => false });
    for (let i = 0; i < 3; i++) dialog().querySelector<HTMLElement>('[data-picker="load"]')!.click();
    expect(dialog().querySelectorAll(".modal-box")).toHaveLength(1);
    expect(dialog().querySelectorAll('[data-picker="back"]')).toHaveLength(1);
  });

  it("says storage is BLOCKED rather than claiming nothing is saved", () => {
    // The player may have four towers on this device that the browser will not
    // hand over. Claiming they are gone is the same lie the unreadable-slot row
    // exists to avoid.
    const { ui } = makeUI();
    ui.showTowerPicker({ getSlots: () => ({ slots: [], storageBlocked: true }), onLoad: () => true });
    const line = dialog().querySelector(".picker-none")!.textContent!;
    expect(line).toContain("blocking saved data");
    expect(line).not.toContain("No towers saved");
    expect(dialog().querySelector('[data-picker="file"]')).not.toBeNull(); // still the way in
  });

  it("returns focus to the Load Tower plate when Back closes the picker", () => {
    const { ui } = makeUI();
    document.body.insertAdjacentHTML(
      "beforeend",
      '<div id="splash"><button data-splash="load">Load Tower</button></div>',
    );
    ui.showTowerPicker({ getSlots: () => ({ slots: present, storageBlocked: false }), onLoad: () => true });
    dialog().querySelector<HTMLElement>('[data-picker="back"]')!.click();
    expect(document.activeElement?.getAttribute("data-splash")).toBe("load");
    document.getElementById("splash")!.remove();
  });

  it("re-renders with an inline error, staying open, when a load fails", () => {
    // CAP-5: a failed load must not cost the player the title screen. The
    // reason renders IN the dialog rather than as a toast, because the title
    // screen paints over the toast rail.
    const { ui } = makeUI();
    ui.showTowerPicker({ getSlots: () => ({ slots: present, storageBlocked: false }), onLoad: () => false });
    dialog().querySelector<HTMLElement>('[data-picker="load"]')!.click();
    expect(dialog().open).toBe(true);
    expect(dialog().querySelector(".picker-error")!.textContent).toContain("couldn't be read");
  });

  it("re-reads storage on every render, so a re-render is never stale", () => {
    const { ui } = makeUI();
    const getSlots = vi.fn(() => ({ slots: present, storageBlocked: false }));
    ui.showTowerPicker({ getSlots, onLoad: () => false });
    expect(getSlots).toHaveBeenCalledOnce();
    dialog().querySelector<HTMLElement>('[data-picker="load"]')!.click();
    expect(getSlots).toHaveBeenCalledTimes(2);
  });

  it("the file row closes the dialog and hands off to the OS picker", async () => {
    const { ui, cb } = makeUI();
    // Restored explicitly: this file has no global restoreMocks, so a leaked
    // no-op click() on the prototype would silently break later tests.
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});
    ui.showTowerPicker({ getSlots: () => ({ slots: present, storageBlocked: false }), onLoad: () => true });
    dialog().querySelector<HTMLElement>('[data-picker="file"]')!.click();
    // Same reason the saves manager yields: the .TDT fidelity report refuses to
    // open while another modal is live.
    expect(dialog().open).toBe(false);
    const input = document.getElementById("import-file") as HTMLInputElement;
    expect(input.accept.startsWith(".vctower")).toBe(true);
    const file = new File(["VCTOWER1\npayload"], "tower.vctower");
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    input.onchange!(new Event("change"));
    await vi.waitFor(() => expect(cb.onImport).toHaveBeenCalledExactlyOnceWith("VCTOWER1\npayload"));
    clickSpy.mockRestore();
  });

  it("Back closes the picker and nothing else", () => {
    const { ui } = makeUI();
    const onLoad = vi.fn(() => true);
    ui.showTowerPicker({ getSlots: () => ({ slots: present, storageBlocked: false }), onLoad });
    dialog().querySelector<HTMLElement>('[data-picker="back"]')!.click();
    expect(dialog().open).toBe(false);
    expect(onLoad).not.toHaveBeenCalled();
  });
});

describe("showStats / congratsTower / showUpdateChip — small dialogs & chrome", () => {
  it("showStats opens a modal with the supplied body and a working Close", () => {
    const { ui } = makeUI();
    ui.showStats(html`<p>ninety-nine floors</p>`);
    expect(dialog().open).toBe(true);
    expect(dialog().textContent).toContain("ninety-nine floors");
    click('[data-act="close"]');
    expect(dialog().open).toBe(false);
  });

  it("congratsTower announces the TOWER win and closes cleanly", () => {
    const { ui } = makeUI();
    ui.congratsTower();
    expect(dialog().textContent).toContain("TOWER achieved");
    click('[data-act="close"]');
    expect(dialog().open).toBe(false);
  });

  it("showUpdateChip reveals the hidden Update chip and wires its click", () => {
    const { ui } = makeUI();
    const chip = document.getElementById("btn-update") as HTMLButtonElement;
    expect(chip.hidden).toBe(true);
    const onClick = vi.fn();
    ui.showUpdateChip(onClick);
    expect(chip.hidden).toBe(false);
    chip.click();
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("showUpdateChip clears #a11y-live then re-announces on the next frame, on EVERY call", () => {
    const { ui } = makeUI();
    const live = document.getElementById("a11y-live")!;
    // Capture the rAF callback so the clear (sync) and the re-set (next frame) are
    // both observable, proving an identical message re-fires for screen readers.
    const raf = { cb: null as FrameRequestCallback | null };
    const win = window as unknown as { requestAnimationFrame: (cb: FrameRequestCallback) => number };
    const orig = win.requestAnimationFrame;
    win.requestAnimationFrame = (cb: FrameRequestCallback) => ((raf.cb = cb), 1);
    try {
      live.textContent = "An update is ready."; // pretend a prior announcement is still parked
      ui.showUpdateChip(() => {});
      expect(live.textContent).toBe(""); // cleared synchronously
      raf.cb!(0);
      expect(live.textContent).toBe("An update is ready."); // re-set on the next frame

      // A second call while the chip is already visible must re-announce, not skip.
      ui.showUpdateChip(() => {});
      expect(live.textContent).toBe(""); // cleared again
      raf.cb!(0);
      expect(live.textContent).toBe("An update is ready.");
    } finally {
      win.requestAnimationFrame = orig;
    }
  });
});

describe("showUpdatePrompt — Later / Update now, resolved once", () => {
  const flush = () => new Promise((r) => setTimeout(r, 0)); // let fire-and-forget microtasks settle

  it("renders release notes and a build id when provided", () => {
    const { ui } = makeUI();
    ui.showUpdatePrompt(
      () => {},
      () => {},
      { version: "1.6.0", sha: "abc1234", notes: ["Palette grows with stars", "Faster tests"] },
    );
    expect(dialog().textContent).toContain("Palette grows with stars");
    expect(dialog().textContent).toContain("Build 1.6.0 · abc1234");
  });

  it("drops the 'unknown' sha placeholder from the build line", () => {
    const { ui } = makeUI();
    ui.showUpdatePrompt(() => {}, () => {}, { version: "1.6.0", sha: "unknown", notes: [] });
    expect(dialog().textContent).toContain("Build 1.6.0");
    expect(dialog().textContent).not.toContain("unknown");
  });

  it("Update now closes and fires the update handler exactly once", async () => {
    const onUpdate = vi.fn();
    const onLater = vi.fn();
    const { ui } = makeUI();
    ui.showUpdatePrompt(onUpdate, onLater, null);
    click('[data-act="update"]');
    await flush();
    expect(onUpdate).toHaveBeenCalledOnce();
    expect(onLater).not.toHaveBeenCalled();
    expect(dialog().open).toBe(false);
  });

  it("Later closes the modal and defers (no update fired)", async () => {
    const onUpdate = vi.fn();
    const onLater = vi.fn();
    const { ui } = makeUI();
    ui.showUpdatePrompt(onUpdate, onLater, null);
    click('[data-act="later"]');
    await flush();
    expect(onLater).toHaveBeenCalledOnce();
    expect(onUpdate).not.toHaveBeenCalled();
    expect(dialog().open).toBe(false);
  });

  it("Esc (the dialog cancel path) also resolves as Later, exactly once", async () => {
    const onUpdate = vi.fn();
    const onLater = vi.fn();
    const { ui } = makeUI();
    ui.showUpdatePrompt(onUpdate, onLater, null);
    dialog().dispatchEvent(new Event("cancel")); // Esc / ✕ → oncancel → later()
    await flush();
    expect(onLater).toHaveBeenCalledOnce();
    expect(onUpdate).not.toHaveBeenCalled();
    expect(dialog().open).toBe(false);
    dialog().dispatchEvent(new Event("cancel")); // the single-resolve guard holds
    await flush();
    expect(onLater).toHaveBeenCalledOnce();
  });

  it("a backdrop click also resolves as Later, exactly once", async () => {
    const onUpdate = vi.fn();
    const onLater = vi.fn();
    const { ui } = makeUI();
    ui.showUpdatePrompt(onUpdate, onLater, null);
    dialog().click(); // backdrop: the click's target is the dialog itself
    await flush();
    expect(onLater).toHaveBeenCalledOnce();
    expect(onUpdate).not.toHaveBeenCalled();
    expect(dialog().open).toBe(false);
  });

  it("a mixed second dismissal cannot double-resolve (Update then backdrop)", async () => {
    const onUpdate = vi.fn();
    const onLater = vi.fn();
    const { ui } = makeUI();
    ui.showUpdatePrompt(onUpdate, onLater, null);
    click('[data-act="update"]');
    dialog().click(); // a racing backdrop click after the update; the latch blocks it
    await flush();
    expect(onUpdate).toHaveBeenCalledOnce();
    expect(onLater).not.toHaveBeenCalled();
  });

  it("a throwing Update handler is contained: the modal still closes, no error escapes", async () => {
    const onUpdate = vi.fn(() => {
      throw new Error("update failed");
    });
    const onLater = vi.fn();
    const { ui } = makeUI();
    ui.showUpdatePrompt(onUpdate, onLater, null);
    // fireAndForget wraps the handler in Promise.resolve().then().catch(), so a
    // synchronous throw is contained (never an unhandledrejection) and the click
    // handler does not throw.
    expect(() => click('[data-act="update"]')).not.toThrow();
    await flush();
    expect(onUpdate).toHaveBeenCalledOnce();
    expect(dialog().open).toBe(false);
  });

  it("a rejecting async Update handler is contained: the modal still closes, the rejection is swallowed", async () => {
    // A Promise-returning handler that rejects must reach the same fire-and-forget
    // `.catch(() => {})` as a synchronous throw, so no unhandledrejection escapes
    // and the modal still closes.
    const onUpdate = vi.fn(() => Promise.reject(new Error("update failed async")));
    const onLater = vi.fn();
    const { ui } = makeUI();
    ui.showUpdatePrompt(onUpdate, onLater, null);
    expect(() => click('[data-act="update"]')).not.toThrow();
    await flush();
    expect(onUpdate).toHaveBeenCalledOnce();
    expect(onLater).not.toHaveBeenCalled();
    expect(dialog().open).toBe(false);
  });
});

describe("showBatchPricingDialog — set-all rent/price with a reset confirm", () => {
  const result = { matched: 5, eligible: 5, changed: 3, skippedSold: 0, skippedCustom: 2, customOverwritten: 0, clampedLow: 0, clampedHigh: 0 };
  function open() {
    const { ui } = makeUI();
    const band = { default: 10000, min: 5000, max: 20000, step: 1000 };
    const preview = vi.fn(() => ({ ...result }));
    const apply = vi.fn(() => ({ ...result }));
    const onApplied = vi.fn();
    ui.showBatchPricingDialog(
      { kind: "office", kindLabel: "Office", options: { shape: "band", band } },
      { preview, apply, onApplied },
    );
    return { preview, apply, onApplied };
  }

  it("previews on open, showing the changed/matched counts", () => {
    const { preview } = open();
    expect(preview).toHaveBeenCalled();
    expect(dialog().querySelector("#bp-preview")!.textContent).toContain("Set 3 of 5 offices");
  });

  it("the ± steppers move the price within the band and re-preview", () => {
    const { preview } = open();
    const price = dialog().querySelector("#bp-price") as HTMLInputElement;
    expect(price.value).toBe("10000");
    dialog().querySelector<HTMLElement>('[data-bp="inc"]')!.click();
    expect(price.value).toBe("11000");
    dialog().querySelector<HTMLElement>('[data-bp="dec"]')!.click();
    dialog().querySelector<HTMLElement>('[data-bp="dec"]')!.click();
    expect(price.value).toBe("9000");
    expect(preview.mock.calls.length).toBeGreaterThan(1);
  });

  it("Apply commits and reports a summary, then closes", () => {
    const { apply, onApplied } = open();
    dialog().querySelector<HTMLButtonElement>("#bp-apply")!.click();
    expect(apply).toHaveBeenCalledOnce();
    expect(onApplied).toHaveBeenCalledWith(expect.stringContaining("Set 3 offices"));
    expect(dialog().open).toBe(false);
  });

  it("a bulk Reset-to-default requires a confirming second click", () => {
    const { apply } = open();
    // Select "Reset to default" — set its radio and clear the sibling explicitly
    // (the test DOM doesn't auto-uncheck radio-group peers), then fire change.
    dialog().querySelector<HTMLInputElement>('input[name="bp-mode"][value="set"]')!.checked = false;
    const def = dialog().querySelector<HTMLInputElement>('input[name="bp-mode"][value="default"]')!;
    def.checked = true;
    def.dispatchEvent(new Event("change"));
    const applyBtn = dialog().querySelector<HTMLButtonElement>("#bp-apply")!;
    applyBtn.click(); // arms, does NOT apply yet
    expect(applyBtn.textContent).toBe("Confirm reset");
    expect(apply).not.toHaveBeenCalled();
    applyBtn.click(); // confirms
    expect(apply).toHaveBeenCalledOnce();
  });

  it("an armed reset is disarmed by any subsequent input (reverts to Apply)", () => {
    const { apply } = open();
    const def = dialog().querySelector<HTMLInputElement>('input[name="bp-mode"][value="default"]')!;
    dialog().querySelector<HTMLInputElement>('input[name="bp-mode"][value="set"]')!.checked = false;
    def.checked = true;
    def.dispatchEvent(new Event("change", { bubbles: true }));
    const applyBtn = dialog().querySelector<HTMLButtonElement>("#bp-apply")!;
    applyBtn.click(); // arm
    expect(applyBtn.textContent).toBe("Confirm reset");
    // Any input disarms: toggle the only-default filter.
    const only = dialog().querySelector<HTMLInputElement>("#bp-only")!;
    only.checked = true;
    only.dispatchEvent(new Event("change", { bubbles: true }));
    expect(dialog().querySelector<HTMLButtonElement>("#bp-apply")!.textContent).toBe("Apply");
    // The next Apply arms again rather than applying immediately.
    dialog().querySelector<HTMLButtonElement>("#bp-apply")!.click();
    expect(apply).not.toHaveBeenCalled();
    expect(dialog().querySelector<HTMLButtonElement>("#bp-apply")!.textContent).toBe("Confirm reset");
  });

  it("snaps a typed off-grid price to the step grid on commit (blur/Enter)", () => {
    open();
    const price = dialog().querySelector<HTMLInputElement>("#bp-price")!;
    price.value = "12345";
    price.dispatchEvent(new Event("input", { bubbles: true })); // typing: not snapped yet
    expect(dialog().querySelector<HTMLInputElement>("#bp-price")!.value).toBe("12345");
    price.dispatchEvent(new Event("change", { bubbles: true })); // commit: snaps to the $1,000 grid
    expect(dialog().querySelector<HTMLInputElement>("#bp-price")!.value).toBe("12000");
  });
});

describe("showBatchPricingDialog — the Classic ladder variant (rung picker + armed No Rate)", () => {
  const result = { matched: 12, eligible: 9, changed: 9, skippedSold: 0, skippedCustom: 0, customOverwritten: 0, clampedLow: 0, clampedHigh: 0 };
  function openLadder() {
    const { ui } = makeUI();
    const options = CLASSIC_RULES.priceOptions("office")!;
    const preview = vi.fn(() => ({ ...result }));
    const apply = vi.fn(() => ({ ...result }));
    const onApplied = vi.fn();
    ui.showBatchPricingDialog({ kind: "office", kindLabel: "Office", options }, { preview, apply, onApplied });
    return { preview, apply, onApplied };
  }
  const rung = () => dialog().querySelector<HTMLSelectElement>("#bp-rung")!;
  const applyBtn = () => dialog().querySelector<HTMLButtonElement>("#bp-apply")!;
  const pick = (value: string) => {
    rung().value = value;
    rung().dispatchEvent(new Event("change", { bubbles: true }));
  };

  it("opens on Average (the default rung) with a live rung preview and no number machinery", () => {
    const { preview } = openLadder();
    expect(rung().value).toBe("2");
    expect(dialog().querySelector("#bp-price")).toBeNull();
    expect(preview).toHaveBeenCalledWith(10_000, { onlyDefaultPriced: false });
    expect(dialog().querySelector("#bp-preview")!.textContent).toBe("Set 9 of 12 offices to Average ($10,000).");
  });

  it("picking a rung re-previews with the rung's exact dollars", () => {
    const { preview } = openLadder();
    pick("1");
    expect(preview).toHaveBeenLastCalledWith(5_000, { onlyDefaultPriced: false });
    expect(dialog().querySelector("#bp-preview")!.textContent).toBe("Set 9 of 12 offices to Low ($5,000).");
  });

  it("Apply on a rung commits once and reports the pinned summary", () => {
    const { apply, onApplied } = openLadder();
    pick("3");
    applyBtn().click();
    expect(apply).toHaveBeenCalledWith(15_000, { onlyDefaultPriced: false });
    expect(onApplied).toHaveBeenCalledWith("Set 9 offices to High ($15,000).");
    expect(dialog().open).toBe(false);
  });

  it("batch No Rate is armed: first click relabels to Confirm No Rate, second applies", () => {
    const { apply, onApplied } = openLadder();
    pick("noRate");
    expect(dialog().querySelector("#bp-preview")!.textContent).toBe(
      "Take 9 of 12 offices off the market (No Rate). Occupied offices keep their tenants and charge nothing.",
    );
    applyBtn().click(); // arms
    expect(applyBtn().textContent).toBe("Confirm No Rate");
    expect(apply).not.toHaveBeenCalled();
    applyBtn().click(); // confirms
    expect(apply).toHaveBeenCalledWith("noRate", { onlyDefaultPriced: false });
    expect(onApplied).toHaveBeenCalledWith("Took 9 offices off the market (No Rate).");
  });

  it("any other change disarms a pending No Rate confirm", () => {
    const { apply } = openLadder();
    pick("noRate");
    applyBtn().click(); // arm
    expect(applyBtn().textContent).toBe("Confirm No Rate");
    const only = dialog().querySelector<HTMLInputElement>("#bp-only")!;
    only.checked = true;
    only.dispatchEvent(new Event("change", { bubbles: true }));
    expect(applyBtn().textContent).toBe("Apply"); // disarmed
    expect(apply).not.toHaveBeenCalled();
  });

  it("the only-on-Average filter rides every preview and apply", () => {
    const { preview, apply } = openLadder();
    const only = dialog().querySelector<HTMLInputElement>("#bp-only")!;
    only.checked = true;
    only.dispatchEvent(new Event("change", { bubbles: true }));
    expect(preview).toHaveBeenLastCalledWith(10_000, { onlyDefaultPriced: true });
    applyBtn().click();
    expect(apply).toHaveBeenCalledWith(10_000, { onlyDefaultPriced: true });
  });
});

describe("showElevatorScheduleDialog — the per-shaft Schedule dialog", () => {
  /** A 4-car standard shaft over floors 1..10, lobby at 1, sky lobby at 8. */
  /** A fake in-memory stops port over floors 1..10 with lobbies at 1 and 8:
   *  read() mirrors a live tower's descending rows and the toggles mutate it,
   *  so the dialog's folded-in stops flow is exercised end to end. */
  function fakeStops(top = 10, lobbies: number[] = [1, 8], servedInit?: number[]) {
    const lobbySet = new Set(lobbies);
    let served = new Set(servedInit ?? Array.from({ length: top }, (_, i) => i + 1));
    const port = {
      read: () =>
        Array.from({ length: top }, (_, i) => top - i).map((floor) => ({
          floor,
          served: served.has(floor),
          lobby: lobbySet.has(floor),
          endpoint: floor === 1 || floor === top,
        })),
      setServe: vi.fn((floor: number, serve: boolean) => {
        if (floor === 1 || floor === top) return; // endpoints always stop
        if (serve) served.add(floor);
        else served.delete(floor);
      }),
      expressStops: vi.fn(() => {
        served = new Set([1, top, ...lobbies]);
      }),
      allStops: vi.fn(() => {
        served = new Set(Array.from({ length: top }, (_, i) => i + 1));
      }),
    };
    return port;
  }
  function baseCtx(over: Partial<ScheduleDialogCtx> = {}): ScheduleDialogCtx {
    return {
      title: "Schedule: Standard elevator (floors 1-10)",
      ux: MODERN_RULES.elevatorScheduleUX(),
      isExpress: false,
      cars: 4,
      bottom: 1,
      top: 10,
      stops: fakeStops(),
      initialWeekend: false,
      ...over,
    };
  }
  function open(over: Partial<ScheduleDialogCtx> = {}) {
    const { ui } = makeUI();
    const apply = vi.fn();
    ui.showElevatorScheduleDialog(baseCtx(over), { apply });
    return { ui, apply };
  }
  /** The car chip for `car` (1-based) on the grid row for `floor`. */
  const chipAt = (floor: number, car: number) => {
    const row = Array.from(dialog().querySelectorAll<HTMLElement>(".es-grid-row:not(.es-grid-head)"))
      .find((r) => r.querySelector(".es-cell-floor")!.textContent!.replace(/[^0-9-]/g, "") === String(floor))!;
    return row.querySelectorAll<HTMLButtonElement>(".es-chip")[car - 1];
  };
  const okBtn = () => dialog().querySelector<HTMLButtonElement>('[data-act="apply"]')!;
  const simText = () => dialog().querySelector(".es-sim")!.textContent!;

  it("opens with every hour at the full fleet, homes at the base lobby, and the defaults", () => {
    const { apply } = open();
    okBtn().click();
    expect(apply).toHaveBeenCalledOnce();
    const s = apply.mock.calls[0][0];
    expect(s.activeCars.weekday).toEqual(Array(24).fill(4));
    expect(s.activeCars.weekend).toEqual(Array(24).fill(4));
    expect(s.homeFloors).toEqual([1, 1, 1, 1]);
    expect(s.waitingCarResponse).toBe(0);
    expect(s.standardFloorDeparture).toBe(48);
    expect(dialog().open).toBe(false);
  });

  it("seeds the working copy from the shaft's current schedule", () => {
    const { apply } = open({
      current: {
        activeCars: { weekday: Array(24).fill(2) },
        homeFloors: [8, 8],
        waitingCarResponse: 6,
        standardFloorDeparture: 30,
      },
    });
    okBtn().click();
    const s = apply.mock.calls[0][0];
    expect(s.activeCars.weekday).toEqual(Array(24).fill(2));
    expect(s.activeCars.weekend).toEqual(Array(24).fill(4)); // missing day row: full fleet
    expect(s.homeFloors).toEqual([8, 8, 1, 1]); // short homes list: base lobby fill
    expect(s.waitingCarResponse).toBe(6);
    expect(s.standardFloorDeparture).toBe(30);
  });

  it("a pristine Cancel closes at once", () => {
    const { apply } = open();
    dialog().querySelector<HTMLButtonElement>('[data-act="close"]')!.click();
    expect(apply).not.toHaveBeenCalled();
    expect(dialog().open).toBe(false);
  });

  it("a dirty Cancel arms Discard changes? and the second press discards", () => {
    const { apply } = open();
    dialog().querySelector<HTMLButtonElement>(".es-quick .btn:last-child")!.click(); // stage up-tower
    const cancel = () => dialog().querySelector<HTMLButtonElement>('[data-act="close"]')!;
    cancel().click(); // arms
    expect(dialog().open).toBe(true);
    expect(cancel().textContent).toBe("Discard changes?");
    cancel().click(); // confirms
    expect(apply).not.toHaveBeenCalled();
    expect(dialog().open).toBe(false);
  });

  it("Esc and the title-bar close honor the dirty guard too (arm first, close second)", () => {
    const { apply } = open();
    dialog().querySelector<HTMLButtonElement>(".es-quick .btn:last-child")!.click(); // dirty
    // Esc and the ✕ both arrive as the dialog's cancelable "cancel" event.
    const esc = () => {
      const e = new Event("cancel", { cancelable: true });
      dialog().dispatchEvent(e);
      return e;
    };
    expect(esc().defaultPrevented).toBe(true); // held open, arming instead
    expect(dialog().open).toBe(true);
    expect(dialog().querySelector('[data-act="close"]')!.textContent).toBe("Discard changes?");
    expect(esc().defaultPrevented).toBe(false); // second press discards
    expect(dialog().open).toBe(false);
    expect(apply).not.toHaveBeenCalled();
  });

  it("a pristine Esc closes at once (no guard without edits)", () => {
    open();
    const e = new Event("cancel", { cancelable: true });
    dialog().dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
    expect(dialog().open).toBe(false);
  });

  it("an edit after arming disarms the discard confirm", () => {
    open();
    dialog().querySelectorAll<HTMLButtonElement>(".es-day .btn")[1].click(); // weekend: view change, stays clean
    dialog().querySelector<HTMLButtonElement>(".es-quick .btn:last-child")!.click(); // stage up-tower: dirty
    const cancel = () => dialog().querySelector<HTMLButtonElement>('[data-act="close"]')!;
    cancel().click(); // arms
    expect(cancel().textContent).toBe("Discard changes?");
    dialog().querySelector<HTMLButtonElement>('.es-spread [aria-label="raise"]')!.click(); // edit disarms
    expect(cancel().textContent).toBe("Cancel");
  });

  it("the staging quick actions rewrite the homes and the Simulate readout follows", () => {
    const { apply } = open();
    expect(simText()).toContain("4 at the lobby");
    dialog().querySelector<HTMLButtonElement>(".es-quick .btn:last-child")!.click(); // stage upper half up-tower
    expect(simText()).toContain("2 staged up-tower");
    // The quick row leads with the folded-in stops actions; home-all is third.
    dialog().querySelectorAll<HTMLButtonElement>(".es-quick .btn")[2].click(); // Home all cars at the lobby
    expect(simText()).toContain("4 at the lobby");
    okBtn().click();
    expect(apply.mock.calls[0][0].homeFloors).toEqual([1, 1, 1, 1]);
  });

  it("a per-car chip press lands in the applied schedule", () => {
    const { apply } = open();
    chipAt(8, 4).click(); // home car 4 at the sky lobby
    expect(chipAt(8, 4).classList.contains("on")).toBe(true);
    okBtn().click();
    expect(apply.mock.calls[0][0].homeFloors).toEqual([1, 1, 1, 8]);
  });

  it("a Modern preset rewrites both day rows and the staging", () => {
    const { apply } = open();
    const feeder = Array.from(dialog().querySelectorAll<HTMLButtonElement>(".es-presets .btn")).find((b) => b.textContent === "Feeder")!;
    feeder.click();
    okBtn().click();
    const s = apply.mock.calls[0][0];
    expect(s.activeCars.weekday).toHaveLength(24);
    expect(s.homeFloors.filter((f: number) => f === 8).length).toBeGreaterThan(0); // half the fleet at the top lobby
  });

  it("Classic renders the raw strip and edits hours through the docked stepper", () => {
    const { apply } = open({ ux: CLASSIC_RULES.elevatorScheduleUX() });
    expect(dialog().querySelector(".es-presets")).toBeNull();
    expect(dialog().querySelector(".es-adv")).toBeNull();
    const bars = dialog().querySelectorAll<HTMLButtonElement>(".es-bar");
    expect(bars).toHaveLength(24);
    bars[3].click(); // select 03:00
    const minus = dialog().querySelector<HTMLButtonElement>('.es-strip-step [aria-label="fewer cars"]')!;
    minus.click();
    minus.click();
    okBtn().click();
    const row = apply.mock.calls[0][0].activeCars.weekday;
    expect(row[3]).toBe(2);
    expect(row[4]).toBe(4); // neighbors untouched
  });

  it("the day toggle edits the day being shown, leaving the other day alone", () => {
    const { apply } = open();
    dialog().querySelectorAll<HTMLButtonElement>(".es-day .btn")[1].click(); // Weekend
    // Modern folds the strip behind Advanced; open it to reach the stepper.
    dialog().querySelector<HTMLElement>(".es-adv summary")!.click();
    dialog().querySelectorAll<HTMLButtonElement>(".es-bar")[12].click();
    dialog().querySelector<HTMLButtonElement>('.es-strip-step [aria-label="fewer cars"]')!.click();
    okBtn().click();
    const s = apply.mock.calls[0][0];
    expect(s.activeCars.weekend[12]).toBe(3);
    expect(s.activeCars.weekday[12]).toBe(4);
  });

  it("opens on the live day type (weekend when the tower is in one)", () => {
    open({ initialWeekend: true });
    const [wd, we] = Array.from(dialog().querySelectorAll(".es-day .btn"));
    expect(we.classList.contains("es-on")).toBe(true);
    expect(wd.classList.contains("es-on")).toBe(false);
  });

  it("the WCR and SFD steppers clamp to their canon ranges", () => {
    const { apply } = open({ current: { waitingCarResponse: 29, standardFloorDeparture: 58 } });
    const steppers = dialog().querySelectorAll(".es-spread .es-stepper");
    const wcrUp = steppers[0].querySelector<HTMLButtonElement>('[aria-label="raise"]')!;
    wcrUp.click();
    wcrUp.click(); // clamped at 30
    const sfdUp = steppers[1].querySelector<HTMLButtonElement>('[aria-label="raise"]')!;
    sfdUp.click();
    sfdUp.click(); // 58 → 60, clamped
    okBtn().click();
    const s = apply.mock.calls[0][0];
    expect(s.waitingCarResponse).toBe(30);
    expect(s.standardFloorDeparture).toBe(60);
  });

  it("advice reads measured demand and Auto-tune stays disabled without it", () => {
    // A morning-peaked measured curve against a half-staffed morning: short.
    const hourly = Array(24).fill(0.05);
    hourly[8] = 0.9;
    const { ui } = makeUI();
    const current = { activeCars: { weekday: Array(24).fill(1) } };
    ui.showElevatorScheduleDialog(baseCtx({ hourly: { weekday: hourly }, current }), { apply: vi.fn() });
    const advice = dialog().querySelector(".es-advice");
    expect(advice).not.toBeNull();
    expect(advice!.textContent).toBe("This shaft is short at 08:00 on weekdays.");
    expect(dialog().querySelector<HTMLButtonElement>(".es-autotune")!.disabled).toBe(false);
  });

  it("compresses consecutive advice hours into one range", () => {
    // Half the fleet parked all day against a flat busy curve: over-staffed
    // never fires; a full-fleet demand with 1 active car is short EVERY hour,
    // which must read as one 00:00-23:00 span, not 24 comma'd stamps.
    const hourly = Array(24).fill(0.9);
    const { ui } = makeUI();
    ui.showElevatorScheduleDialog(baseCtx({ hourly: { weekday: hourly }, current: { activeCars: { weekday: Array(24).fill(1) } } }), { apply: vi.fn() });
    expect(dialog().querySelector(".es-advice")!.textContent).toBe("This shaft is short at 00:00–23:00 on weekdays.");
  });

  it("hands Auto-tune the measured curve and the tuned counts land on OK", () => {
    const hourly = Array(24).fill(0.1);
    hourly[8] = 1;
    const { apply } = open({ hourly: { weekday: hourly } });
    dialog().querySelector<HTMLButtonElement>(".es-autotune")!.click();
    okBtn().click();
    const row = apply.mock.calls[0][0].activeCars.weekday;
    expect(row[8]).toBe(4); // the peak keeps the fleet
    expect(Math.min(...row)).toBeGreaterThanOrEqual(1); // quiet hours floor at 1, never 0
  });

  it("Auto-tune seeds split staging on an untouched shaft", () => {
    const hourly = Array(24).fill(0.5);
    const { apply } = open({ hourly: { weekday: hourly } }); // no stored schedule, staging never edited
    dialog().querySelector<HTMLButtonElement>(".es-autotune")!.click();
    okBtn().click();
    expect(apply.mock.calls[0][0].homeFloors).toEqual([1, 1, 8, 8]); // the split
  });

  it("Auto-tune never overwrites hand-set homes", () => {
    const hourly = Array(24).fill(0.5);
    const { apply } = open({ hourly: { weekday: hourly } });
    chipAt(5, 1).click(); // hand-home car 1 at floor 5
    dialog().querySelector<HTMLButtonElement>(".es-autotune")!.click();
    okBtn().click();
    expect(apply.mock.calls[0][0].homeFloors).toEqual([5, 1, 1, 1]);
  });

  it("a preset keeps its hands off hand-set homes (counts only)", () => {
    const { apply } = open();
    chipAt(9, 4).click(); // hand-home car 4 at floor 9
    const rush = Array.from(dialog().querySelectorAll<HTMLButtonElement>(".es-presets .btn")).find((b) => b.textContent === "Rush")!;
    rush.click();
    okBtn().click();
    expect(apply.mock.calls[0][0].homeFloors).toEqual([1, 1, 1, 9]); // staging untouched
    expect(apply.mock.calls[0][0].activeCars.weekday[8]).toBe(4); // counts repainted
  });

  it("keeps Auto-tune disabled until the curve has a real spread of sampled hours", () => {
    const hourly = Array(24).fill(0);
    hourly[8] = 0.9; // one busy hour is not a measured day
    open({ hourly: { weekday: hourly } });
    expect(dialog().querySelector<HTMLButtonElement>(".es-autotune")!.disabled).toBe(true);
    expect(dialog().querySelector(".es-advice")).toBeNull(); // no advice off a cold ring
  });

  it("day-scopes the ghost and advice: a warm weekday never stands in for a cold weekend (#466)", () => {
    // Only the weekday ring is measured; the weekday tab shows the ghost and its
    // day-named advice, and flipping to Weekend must drop BOTH (no phantom rush),
    // while Auto-tune stays armed (it can still tune the measured weekday).
    const hourly = Array(24).fill(0.05);
    hourly[8] = 0.9;
    const { ui } = makeUI();
    ui.showElevatorScheduleDialog(
      baseCtx({ hourly: { weekday: hourly }, current: { activeCars: { weekday: Array(24).fill(1), weekend: Array(24).fill(1) } } }),
      { apply: vi.fn() },
    );
    expect(dialog().querySelector(".es-legend")).not.toBeNull();
    expect(dialog().querySelector(".es-advice")!.textContent).toContain("on weekdays");
    dialog().querySelectorAll<HTMLButtonElement>(".es-day .btn")[1].click(); // Weekend
    expect(dialog().querySelector(".es-legend")).toBeNull(); // no ghost off a cold ring
    expect(dialog().querySelector(".es-bar-demand")).toBeNull();
    expect(dialog().querySelector(".es-advice")).toBeNull(); // no weekend advice invented
    expect(dialog().querySelector<HTMLButtonElement>(".es-autotune")!.disabled).toBe(false);
    // The Simulate sentence never claims a measured peak for the cold day, and a
    // hint explains why Auto-tune will not move the visible row.
    expect(simText()).toContain("No measured weekend peak yet; at the 17:00 down-rush");
    expect(dialog().textContent).toContain("No measured weekend traffic yet; Auto-tune adjusts only measured days.");
  });

  it("marks measured boarding hotspots in the grid and names them in Simulate (#465)", async () => {
    const { emptyOriginRings } = await import("../../engine/scheduleOrigins");
    // Weekday demand peaks at 08:00; origins say that hour's riders board on
    // floors 7 (mostly) and 1.
    const hourly = Array(24).fill(0.2);
    hourly[8] = 0.9;
    const origins = emptyOriginRings();
    origins.weekday[8] = new Map([
      [7, 30],
      [1, 10],
    ]);
    open({ hourly: { weekday: hourly }, origins });
    const marks = Array.from(dialog().querySelectorAll(".es-origin"));
    expect(marks).toHaveLength(2);
    // The marker carries an accessible label, not just a title tooltip.
    expect(marks[0].getAttribute("role")).toBe("img");
    expect(marks[0].getAttribute("aria-label")).toContain("Demand hotspot");
    expect(simText()).toContain("Most riders board on floors 1, 7.");
    // The markers are day-scoped like the ghost: a cold weekend shows none.
    dialog().querySelectorAll<HTMLButtonElement>(".es-day .btn")[1].click();
    expect(dialog().querySelectorAll(".es-origin")).toHaveLength(0);
    expect(simText()).not.toContain("Most riders board");
  });

  it("origins never outrun the demand gate: warm origins on a cold day show nothing (#465)", async () => {
    // The inverse of the cold-origins case: the weekend ORIGIN map carries mass
    // but the weekend demand curve never warmed. Deleting the dayWarmed() gate
    // in dayOriginsAt would light these markers; pin that they stay dark.
    const { emptyOriginRings } = await import("../../engine/scheduleOrigins");
    const origins = emptyOriginRings();
    origins.weekend[12] = new Map([[7, 30]]);
    const hourly = Array(24).fill(0.5);
    open({ hourly: { weekday: hourly }, origins, initialWeekend: true }); // the cold weekend tab
    expect(dialog().querySelectorAll(".es-origin")).toHaveLength(0);
    expect(simText()).not.toContain("Most riders board");
  });

  it("drops the hotspot mark and the named floor once the floor is skipped (#465)", async () => {
    // EMA'd origin history outlives a stop edit; the readouts must not claim
    // boardings on a floor the shaft no longer serves.
    const { emptyOriginRings } = await import("../../engine/scheduleOrigins");
    const hourly = Array(24).fill(0.2);
    hourly[8] = 0.9;
    const origins = emptyOriginRings();
    origins.weekday[8] = new Map([
      [7, 30],
      [1, 10],
    ]);
    open({ hourly: { weekday: hourly }, origins, stops: fakeStops(10, [1, 8], [1, 2, 3, 4, 5, 6, 8, 9, 10]) });
    expect(dialog().querySelectorAll(".es-origin")).toHaveLength(1); // floor 7 is skipped: only floor 1 marks
    expect(simText()).toContain("Most riders board at Floor 1.");
  });

  it("a skipped floor's stale mass does not suppress the served-floor marker (#465)", async () => {
    // The share threshold must apply to the SERVED set: floor 7 carries most of
    // the slot's historical mass but is skipped, so filtering it out AFTER the
    // ranking would leave floor 3 below threshold and blank all markers. With
    // the slot filtered to served floors first, floor 3 still marks.
    const { emptyOriginRings } = await import("../../engine/scheduleOrigins");
    const hourly = Array(24).fill(0.2);
    hourly[8] = 0.9;
    const origins = emptyOriginRings();
    origins.weekday[8] = new Map([
      [7, 90], // skipped, but dominates the raw slot total
      [3, 10],
    ]);
    open({ hourly: { weekday: hourly }, origins, stops: fakeStops(10, [1, 8], [1, 2, 3, 4, 5, 6, 8, 9, 10]) });
    const marks = Array.from(dialog().querySelectorAll(".es-origin"));
    expect(marks).toHaveLength(1); // floor 3 still marks despite floor 7's larger mass
    expect(simText()).toContain("Most riders board at Floor 3.");
  });

  it("snaps a stored home floor on a no-longer-served stop to the nearest served floor", () => {
    const { apply } = open({
      stops: fakeStops(10, [1, 8], [1, 2, 3, 4, 8, 9, 10]),
      current: { homeFloors: [7, 1, 1, 1] }, // floor 7 no longer served
    });
    expect(chipAt(8, 1).classList.contains("on")).toBe(true); // snapped to the nearest served floor
    okBtn().click();
    expect(apply.mock.calls[0][0].homeFloors[0]).toBe(8);
  });

  it("shift-click extends the selection and the docked stepper edits the whole span", () => {
    const { apply } = open({ ux: CLASSIC_RULES.elevatorScheduleUX() });
    const bars = () => dialog().querySelectorAll<HTMLButtonElement>(".es-bar");
    bars()[6].click();
    bars()[9].dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey: true }));
    expect(dialog().textContent).toContain("Hours 06:00–09:00");
    dialog().querySelector<HTMLButtonElement>('.es-strip-step [aria-label="fewer cars"]')!.click();
    okBtn().click();
    const row = apply.mock.calls[0][0].activeCars.weekday;
    expect(row.slice(6, 10)).toEqual([3, 3, 3, 3]);
    expect(row[5]).toBe(4);
    expect(row[10]).toBe(4);
  });

  it("arrow keys adjust a bar's count and move between hours", () => {
    const { apply } = open({ ux: CLASSIC_RULES.elevatorScheduleUX() });
    const bars = () => dialog().querySelectorAll<HTMLButtonElement>(".es-bar");
    bars()[9].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
    bars()[9].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }));
    expect(dialog().textContent).toContain("Hour 10:00"); // selection moved
    okBtn().click();
    const row = apply.mock.calls[0][0].activeCars.weekday;
    expect(row[9]).toBe(3);
  });

  it("a Serve toggle applies live, refreshes the rows, and re-snaps the working homes", () => {
    const stops = fakeStops();
    const { apply } = open({ stops, current: { homeFloors: [5, 1, 1, 1] } });
    // Uncheck floor 5: the port mutates, the grid refreshes, car 1's home snaps off it.
    const rows = () => dialog().querySelectorAll<HTMLElement>(".es-grid-row:not(.es-grid-head)");
    const serve5 = Array.from(rows()).find((r) => r.querySelector(".es-cell-floor")!.textContent!.includes("5"))!
      .querySelector<HTMLInputElement>("input[type=checkbox]")!;
    serve5.checked = false;
    serve5.dispatchEvent(new Event("change", { bubbles: true }));
    expect(stops.setServe).toHaveBeenCalledWith(5, false);
    const row5 = Array.from(rows()).find((r) => r.querySelector(".es-cell-floor")!.textContent!.includes("5"))!;
    expect(row5.classList.contains("es-skipped")).toBe(true);
    expect(row5.querySelectorAll(".es-chip")).toHaveLength(0);
    okBtn().click();
    expect(apply.mock.calls[0][0].homeFloors[0]).not.toBe(5); // snapped off the skipped floor
  });

  it("stop edits do not arm the discard guard (they applied live; Cancel cannot take them back)", () => {
    open();
    const serve = dialog().querySelectorAll<HTMLInputElement>(".es-grid input[type=checkbox]")[1];
    serve.checked = false;
    serve.dispatchEvent(new Event("change", { bubbles: true }));
    dialog().querySelector<HTMLButtonElement>('[data-act="close"]')!.click();
    expect(dialog().open).toBe(false); // closed at once: no schedule edit pending
  });

  it("the bulk stop quick actions ride the port and announce", () => {
    const announce = vi.fn();
    const stops = fakeStops();
    open({ stops, announce });
    const quick = dialog().querySelectorAll<HTMLButtonElement>(".es-quick .btn");
    quick[0].click(); // Express (lobbies)
    expect(stops.expressStops).toHaveBeenCalledOnce();
    expect(announce).toHaveBeenLastCalledWith("Stops set to lobbies only.");
    // The grid follows: non-lobby floors read skipped now.
    expect(dialog().querySelectorAll(".es-grid-row.es-skipped").length).toBeGreaterThan(0);
    quick[1].click(); // All stops
    expect(stops.allStops).toHaveBeenCalledOnce();
    expect(announce).toHaveBeenLastCalledWith("Stopping at every floor.");
    expect(dialog().querySelectorAll(".es-grid-row.es-skipped")).toHaveLength(0);
  });

  it("on touch, the FIRST tap selects (never spans); the second extends; a third resets (F1)", () => {
    const orig = window.matchMedia;
    window.matchMedia = ((q: string) =>
      ({ matches: q === "(pointer: coarse)", media: q, addEventListener: () => {}, removeEventListener: () => {} }) as unknown as MediaQueryList) as typeof window.matchMedia;
    try {
      const { apply } = open({ ux: CLASSIC_RULES.elevatorScheduleUX() });
      const bars = () => dialog().querySelectorAll<HTMLButtonElement>(".es-bar");
      bars()[6].click(); // FIRST tap: selects, must not span from the seeded 17
      expect(dialog().textContent).toContain("Hour 06:00");
      expect(dialog().textContent).not.toContain("Hours ");
      bars()[9].click(); // second tap extends
      expect(dialog().textContent).toContain("Hours 06:00–09:00");
      bars()[3].click(); // third tap resets to the tapped bar
      expect(dialog().textContent).toContain("Hour 03:00");
      dialog().querySelector<HTMLButtonElement>('.es-strip-step [aria-label="fewer cars"]')!.click();
      okBtn().click();
      const row = apply.mock.calls[0][0].activeCars.weekday;
      expect(row[3]).toBe(3); // only the reset single hour stepped
      expect(row[6]).toBe(4);
    } finally {
      window.matchMedia = orig;
    }
  });

  it("a held stepper auto-repeats and stops when the button detaches (F3)", () => {
    vi.useFakeTimers();
    try {
      const { apply } = open({ ux: CLASSIC_RULES.elevatorScheduleUX() });
      const minus = () => dialog().querySelector<HTMLButtonElement>('.es-strip-step [aria-label="fewer cars"]')!;
      minus().dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      vi.advanceTimersByTime(400 + 150 * 3 + 10); // hold: ~3 repeats
      const btn = minus();
      btn.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
      okBtn().click();
      const held = apply.mock.calls[0][0].activeCars.weekday[17];
      expect(held).toBeLessThanOrEqual(1); // 4 - 3 repeats
      expect(held).toBeGreaterThanOrEqual(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a runaway hold dies with the dialog: no repeats fire after dismissal (F3)", () => {
    vi.useFakeTimers();
    try {
      const announce = vi.fn();
      open({ ux: CLASSIC_RULES.elevatorScheduleUX(), announce });
      const steppers = dialog().querySelectorAll(".es-spread .es-stepper");
      const up = steppers[0].querySelector<HTMLButtonElement>('[aria-label="raise"]')!;
      up.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      vi.advanceTimersByTime(400 + 150 * 2 + 10); // repeats begin
      const fired = announce.mock.calls.length;
      expect(fired).toBeGreaterThan(0);
      dialog().querySelector<HTMLButtonElement>('[data-act="close"]')!.click(); // pristine? no: WCR edits armed... use Esc-free: the guard arms
      dialog().querySelector<HTMLButtonElement>('[data-act="close"]')!.click(); // second press discards
      expect(dialog().open).toBe(false);
      vi.advanceTimersByTime(150 * 10); // the interval must self-stop on the detached button
      expect(announce.mock.calls.length).toBe(fired);
    } finally {
      vi.useRealTimers();
    }
  });

  it("endpoints render a fixed serve mark, never a toggle, and basements read B-n (F2/V5)", () => {
    open({ stops: fakeStops(10, [1, 8]) });
    const rows = dialog().querySelectorAll<HTMLElement>(".es-grid-row:not(.es-grid-head)");
    expect(rows[0].querySelector("input[type=checkbox]")).toBeNull(); // top endpoint
    expect(rows[0].querySelector(".es-always")).not.toBeNull();
    expect(rows[rows.length - 1].querySelector("input[type=checkbox]")).toBeNull(); // bottom endpoint
    expect(rows[1].querySelector("input[type=checkbox]")).not.toBeNull(); // interior floors toggle
  });

  it("emits the pinned announce strings on stepper commits, presets, and Auto-tune", () => {
    const announce = vi.fn();
    const hourly = Array(24).fill(0.5);
    open({ hourly: { weekday: hourly }, announce });
    const steppers = dialog().querySelectorAll(".es-spread .es-stepper");
    steppers[0].querySelector<HTMLButtonElement>('[aria-label="raise"]')!.click();
    expect(announce).toHaveBeenLastCalledWith("Waiting Car Response set to 1. Higher holds idle cars in place longer.");
    steppers[0].querySelector<HTMLButtonElement>('[aria-label="lower"]')!.click();
    expect(announce).toHaveBeenLastCalledWith("Waiting Car Response: 0. Idle cars answer the nearest call.");
    steppers[1].querySelector<HTMLButtonElement>('[aria-label="lower"]')!.click();
    expect(announce).toHaveBeenLastCalledWith("Standard Floor Departure: 46 seconds.");
    Array.from(dialog().querySelectorAll<HTMLButtonElement>(".es-presets .btn")).find((b) => b.textContent === "Balanced")!.click();
    expect(announce).toHaveBeenLastCalledWith("Applied the Balanced schedule.");
    dialog().querySelector<HTMLButtonElement>(".es-autotune")!.click();
    // The announce names the days actually tuned (#466): only the weekday is warm here.
    expect(announce).toHaveBeenLastCalledWith("Auto-tuned the weekday schedule and staging to measured demand.");
  });
});

describe("Saved Towers rows (mode chip + in-game day)", () => {
  it("shows a coerced rule-set chip and the day on every existing slot; empty slots get neither", () => {
    const { ui } = makeUI();
    ui.showSaves([
      { slot: "auto", exists: true, present: true, towerName: "Old Faithful", star: 3, population: 900, funds: 1000, savedAt: 1, mode: "classic", day: 42 },
      { slot: 1, exists: true, present: true, towerName: "New Ways", star: 2, population: 400, funds: 500, savedAt: 1, mode: "modern", day: 7 },
      { slot: 2, exists: false, present: false },
    ]);
    const rows = Array.from(dialog().querySelectorAll(".slot"));
    expect(rows[0].querySelector(".nt-badge")!.textContent).toBe("Classic");
    expect(rows[0].querySelector(".nt-badge.alt")).toBeNull(); // classic uses the muted badge
    expect(rows[1].querySelector(".nt-badge.alt")!.textContent).toBe("Modern");
    // Structural pins on the when-line, not substring scans of the whole row.
    expect(rows[0].querySelector(".slot-when")!.textContent).toMatch(/\bDay 42\b/);
    expect(rows[1].querySelector(".slot-when")!.textContent).toMatch(/\bDay 7\b/);
    expect(rows[2].querySelector(".nt-badge")).toBeNull();
    expect(rows[2].querySelector(".slot-when")).toBeNull(); // empty rows carry no when-line at all
  });

  it("omits the day when the save's minutes were malformed, keeping the timestamp", () => {
    const { ui } = makeUI();
    ui.showSaves([
      { slot: 1, exists: true, present: true, towerName: "T", star: 1, population: 0, funds: 0, savedAt: 1700000000000, mode: "classic" },
    ]);
    const when = dialog().querySelector(".slot-when")!.textContent!;
    expect(when).not.toMatch(/\bDay\b/);
    expect(when.length).toBeGreaterThan(0); // the fmtWhen timestamp still renders
  });

  it("a non-numeric day smuggled past the types never reaches the template raw", () => {
    const { ui } = makeUI();
    ui.showSaves([
      // A hostile producer bypassing SlotInfo's types (the storage layer
      // already bounds day; this pins the render-side finiteness guard).
      { slot: 1, exists: true, present: true, towerName: "T", star: 1, population: 0, funds: 0, savedAt: 1, mode: "classic", day: "<img>" as unknown as number },
    ]);
    const when = dialog().querySelector(".slot-when")!.textContent!;
    expect(when).not.toContain("<img>");
    expect(dialog().querySelector(".slot-when img")).toBeNull();
    expect(when).not.toMatch(/\bDay\b/);
  });
});

describe("mode badge (uiStatus.setMode) follows the live rule-set", () => {
  beforeEach(() => mountAppDom());
  afterEach(() => (document.body.innerHTML = ""));

  const badge = (): HTMLButtonElement => document.getElementById("btn-mode") as HTMLButtonElement;

  it("paints the Classic label and class", () => {
    const { ui } = makeUI();
    setMode(ui, "classic");
    expect(badge().textContent).toBe("This tower: Classic");
    expect(badge().classList.contains("is-classic")).toBe(true);
    expect(badge().classList.contains("is-modern")).toBe(false);
  });

  it("switches to Modern when the mode changes", () => {
    const { ui } = makeUI();
    setMode(ui, "classic");
    setMode(ui, "modern");
    expect(badge().textContent).toBe("This tower: Modern");
    expect(badge().classList.contains("is-modern")).toBe(true);
    expect(badge().classList.contains("is-classic")).toBe(false);
  });

  it("is dirty-gated: an unchanged mode does not rewrite the DOM", () => {
    const { ui } = makeUI();
    setMode(ui, "modern");
    // Poison the label; a same-mode call must leave it untouched (no DOM write).
    badge().textContent = "SENTINEL";
    setMode(ui, "modern");
    expect(badge().textContent).toBe("SENTINEL");
  });
});

describe("Compare modal (showCompare) pauses the tower and restores speed", () => {
  beforeEach(() => mountAppDom());
  afterEach(() => (document.body.innerHTML = ""));

  it("opens the shared comparison through the single #modal", () => {
    const { ui } = makeUI();
    ui.showCompare();
    expect(dialog().open).toBe(true);
    expect(dialog().querySelector("h2")?.textContent).toContain("Classic vs Modern");
    expect(dialog().textContent).toContain("pixel-faithful to 1994");
  });

  it("pauses on open and restores the prior speed on Got it", () => {
    const onSpeed = vi.fn();
    const { ui } = makeUI({ getSpeed: () => 2, onSpeed });
    ui.showCompare();
    expect(onSpeed).toHaveBeenNthCalledWith(1, 0); // paused on open
    click('[data-act="close"]');
    expect(dialog().open).toBe(false);
    expect(onSpeed).toHaveBeenNthCalledWith(2, 2); // restored on close
  });

  it("restores the prior speed on Esc/cancel too, exactly once", () => {
    const onSpeed = vi.fn();
    const { ui } = makeUI({ getSpeed: () => 3, onSpeed });
    ui.showCompare();
    // Esc routes through the dialog's cancel path (the ✕ dispatches it too).
    dialog().dispatchEvent(new Event("cancel", { cancelable: true }));
    expect(dialog().open).toBe(false);
    expect(onSpeed).toHaveBeenNthCalledWith(2, 3);
    // A second dismissal must not restore again (finish fires once).
    dialog().dispatchEvent(new Event("cancel", { cancelable: true }));
    expect(onSpeed).toHaveBeenCalledTimes(2);
  });

  it("opens from a click on the Tower-panel mode badge", () => {
    const { ui } = makeUI();
    void ui; // constructed for its side effect: the badge click is wired in the ctor
    (document.getElementById("btn-mode") as HTMLButtonElement).click();
    expect(dialog().open).toBe(true);
    expect(dialog().textContent).toContain("Variant households");
  });
});

describe("Help dialog: the 'Open full page' link downgrades to the compare modal when installed", () => {
  beforeEach(() => mountAppDom());
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  /** Force (or clear) the installed-standalone signal the link's handler reads. */
  const setStandalone = (on: boolean): void => {
    vi.spyOn(window, "matchMedia").mockImplementation(
      (q: string) =>
        ({
          matches: q.includes("display-mode: standalone") ? on : false,
          media: q,
          onchange: null,
          addListener: () => {},
          removeListener: () => {},
          addEventListener: () => {},
          removeEventListener: () => {},
          dispatchEvent: () => false,
        }) as unknown as MediaQueryList,
    );
  };

  const clickFullPage = (): void => {
    const a = dialog().querySelector<HTMLAnchorElement>('a[data-act="open-help"]');
    expect(a, "expected the Open full page link in the Help dialog").not.toBeNull();
    a!.click();
  };

  it("intercepts the click and opens the in-app compare modal when running standalone", () => {
    setStandalone(true);
    const onSpeed = vi.fn();
    const { ui } = makeUI({ getSpeed: () => 2, onSpeed });
    ui.showHelp();
    expect(dialog().querySelector("h2")?.textContent).toContain("How to play");

    clickFullPage();

    // The single #modal now shows the compare modal, and opening it paused the
    // tower (showCompare's pause-on-open), so the player never left the sim.
    expect(dialog().querySelector("h2")?.textContent).toContain("Classic vs Modern");
    expect(dialog().textContent).toContain("pixel-faithful to 1994");
    expect(onSpeed).toHaveBeenCalledWith(0);
  });

  it("leaves the anchor to navigate in a plain browser tab (no interception)", () => {
    setStandalone(false);
    const { ui } = makeUI();
    ui.showHelp();
    // Suppress happy-dom's real new-tab navigation (it would fetch /help against
    // no server): a test-only listener cancels the default AFTER the production
    // handler has had its chance, so we still prove the handler itself did not
    // hijack the click (the compare modal never opens; the Help modal stays put).
    const a = dialog().querySelector<HTMLAnchorElement>('a[data-act="open-help"]')!;
    a.addEventListener("click", (e) => e.preventDefault());

    clickFullPage();

    // The help modal is untouched: the click was left to the real <a target=_blank>.
    expect(dialog().querySelector("h2")?.textContent).toContain("How to play");
  });

  it("also intercepts in the native Capacitor wrapper, which has no /help route", () => {
    setStandalone(false); // not a standalone PWA, but a native shell
    vi.spyOn(platformModule, "getPlatform").mockReturnValue({
      isNativeWrapper: true,
      saveFile: () => Promise.resolve(),
      openExternal: () => {},
    });
    const onSpeed = vi.fn();
    const { ui } = makeUI({ getSpeed: () => 1, onSpeed });
    ui.showHelp();

    clickFullPage();

    // Kept in the sim: the compare modal opens (paused) instead of a dead new tab.
    expect(dialog().querySelector("h2")?.textContent).toContain("Classic vs Modern");
    expect(onSpeed).toHaveBeenCalledWith(0);
  });
});
