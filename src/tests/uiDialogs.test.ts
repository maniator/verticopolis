// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { UI, type UICallbacks } from "../ui/UI";

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
 *  - openModal: the window grammar (.modal-box.win box, top-level h2 becomes
 *    the .win-title bar, nested h2s are never skinned), the ✕ is appended
 *    AFTER showModal so it's the title bar's last child (keyboard focus lands
 *    on the primary action, not on ✕), and the ✕ routes through the dialog's
 *    cancel path — not closeModal() directly — so modals that override
 *    oncancel (the emergency choice) still resolve when dismissed via ✕.
 *  - renderEditor: same shape key patches volatile cells in place (buttons
 *    keep identity → no swallowed clicks); a new key rebuilds and rewires.
 *    (patchVolatile itself is covered by editorPatch.test.ts.)
 *  - toast: kind class + text land on the toast element; the stack is capped.
 */

// jsdom 28 defines HTMLDialogElement but leaves showModal()/close()
// unimplemented (upstream jsdom issue #3294). Polyfill the minimal semantics
// the UI relies on: `open` reflects the `open` attribute, which jsdom DOES
// support, and native close() fires a "close" event.
if (typeof HTMLDialogElement.prototype.showModal !== "function") {
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.open = false;
    this.dispatchEvent(new Event("close"));
  };
}

/** Minimal fixture with every id the UI constructor looks up (non-null!). */
function mountAppDom(): void {
  document.body.innerHTML = `
    <span id="stat-money"></span><span id="stat-pop"></span><span id="stat-star"></span>
    <span id="stat-time"></span><span id="stat-date"></span>
    <div id="speed"><button class="btn" data-speed="1">▶</button></div>
    <button id="audio-toggle">🔊</button>
    <div id="palette-scroll"></div>
    <div id="tool-info"></div>
    <input id="tower-name" />
    <div id="tower-stats"></div>
    <button id="btn-stats"></button>
    <div id="log"></div>
    <button id="btn-save"></button><button id="btn-load"></button>
    <button id="btn-export"></button><button id="btn-import"></button>
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
    onSave: vi.fn(),
    onLoad: vi.fn(),
    onExport: vi.fn(),
    onImport: vi.fn(),
    onImportLegacy: vi.fn(),
    onNew: vi.fn(),
    onToggleAudio: vi.fn(() => true),
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    onEditAction: vi.fn(),
    onToggleReducedMotion: vi.fn(() => true),
    onReplayOnboarding: vi.fn(),
    onRenameTower: vi.fn(),
    onShowStats: vi.fn(),
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

beforeEach(() => {
  mountAppDom();
});

describe("wireActions — the anti-dead-button contract", () => {
  it("binds the default close: [data-act=close] dismisses the modal", () => {
    const { ui } = makeUI();
    ui.showStats("<p>lots of numbers</p>");
    expect(dialog().open).toBe(true);
    click('[data-act="close"]');
    expect(dialog().open).toBe(false);
    expect(dialog().innerHTML).toBe(""); // closeModal also empties the dialog
  });

  it("binds caller-supplied [data-act] handlers (saves dialog export)", () => {
    const { ui, cb } = makeUI();
    ui.showSaves([]);
    click('[data-act="export"]');
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
    ui.showStats("<p>body</p>");
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
    ui.showInspector("<h4>Office 12F</h4><div>occupied</div>");
    const x = document.querySelector<HTMLButtonElement>("#inspector h4 > button")!;
    expect(x).not.toBeNull();
    expect([...x.classList].sort()).toEqual(["btn", "insp-close", "xs"]);
    expect(x.getAttribute("aria-label")).toBe("Close");
    expect(x.textContent).toBe("✕");
    x.click();
    // Routed through the app (which latches the dismissal) — not a local hide.
    expect(cb.onInspectorClose).toHaveBeenCalledTimes(1);
  });
});

describe("openModal — the window grammar", () => {
  // openModal is private but is THE window factory; its return value and
  // skinning rules are the contract every show* method builds on.
  const open = (ui: UI, html: string): HTMLElement => (ui as any).openModal(html);

  it("wraps content in .modal-box.win and returns that box", () => {
    const { ui } = makeUI();
    const box = open(ui, "<h2>Title</h2><p>body</p>");
    expect(box).toBe(dialog().firstElementChild);
    expect(box.classList.contains("modal-box")).toBe(true);
    expect(box.classList.contains("win")).toBe(true);
    expect(dialog().open).toBe(true);
  });

  it("skins only the TOP-LEVEL h2 as .win-title — an h2 nested in body content is untouched", () => {
    const { ui } = makeUI();
    const box = open(ui, "<h2>Window Title</h2><div><h2>Section heading</h2></div>");
    const [title, nested] = [...box.querySelectorAll("h2")];
    expect(title.classList.contains("win-title")).toBe(true);
    expect(nested.classList.contains("win-title")).toBe(false);
    expect(nested.querySelector("button")).toBeNull(); // and no ✕ either
  });

  it("appends exactly one ✕, as the LAST child of the title bar (focus lands on the primary action, not ✕)", () => {
    const { ui } = makeUI();
    const box = open(ui, "<h2>Title</h2><button class='btn primary' data-act='close'>OK</button>");
    const title = box.querySelector(":scope > h2")!;
    const xs = box.querySelectorAll(".modal-x");
    expect(xs.length).toBe(1);
    expect(title.lastElementChild).toBe(xs[0]);
  });

  it("✕ routes through the dialog's cancel path (a cancelable cancel event), not closeModal directly", () => {
    const { ui } = makeUI();
    open(ui, "<h2>Title</h2>");
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
    open(ui, "<h2>Title</h2>");
    click(".modal-x");
    expect(dialog().open).toBe(false);

    open(ui, "<h2>Title</h2>");
    dialog().dispatchEvent(new Event("cancel", { cancelable: true })); // what Esc produces
    expect(dialog().open).toBe(false);
  });

  it("a backdrop click (target === dialog) closes the modal", () => {
    const { ui } = makeUI();
    open(ui, "<h2>Title</h2>");
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

  it("emergency modal: accept button resolves accept", () => {
    const { ui } = makeUI();
    const onResolve = vi.fn();
    ui.showEventChoice("Bomb threat!", "$100,000", onResolve);
    click('[data-act="accept"]');
    expect(onResolve).toHaveBeenCalledExactlyOnceWith("accept");
  });
});

describe("renderEditor — patch in place on same key, rebuild on new key", () => {
  const editorEl = (): HTMLElement => document.getElementById("editor")!;
  const template = (label: string) =>
    `<div><span class="v" data-field="rent">${label}</span><button data-edit="rentUp">+ rent</button></div>`;

  it("same key: patches volatile cells without rebuilding (button identity survives)", () => {
    const { ui } = makeUI();
    const build = vi.fn(() => template("$10,000"));
    ui.renderEditor("office:1", build, { rent: "$10,000" });
    const btn = editorEl().querySelector("button")!;
    expect(build).toHaveBeenCalledTimes(1);

    ui.renderEditor("office:1", build, { rent: "$14,000" });
    expect(build).toHaveBeenCalledTimes(1); // no rebuild
    expect(editorEl().querySelector('[data-field="rent"]')!.innerHTML).toBe("$14,000");
    expect(editorEl().querySelector("button")).toBe(btn); // same element → no swallowed click
  });

  it("new key: rebuilds the card and rewires [data-edit] to onEditAction", () => {
    const { ui, cb } = makeUI();
    ui.renderEditor("office:1", () => template("$10,000"), { rent: "$10,000" });
    const oldBtn = editorEl().querySelector("button")!;

    ui.renderEditor("condo:7", () => template("$80,000"), { rent: "$80,000" });
    const newBtn = editorEl().querySelector<HTMLElement>("[data-edit]")!;
    expect(newBtn).not.toBe(oldBtn); // full rebuild
    newBtn.click();
    expect(cb.onEditAction).toHaveBeenCalledExactlyOnceWith("rentUp", editorEl());
  });

  it("hideEditor clears the card and forces a rebuild on the next render of the SAME key", () => {
    const { ui } = makeUI();
    const build = vi.fn(() => template("$10,000"));
    ui.renderEditor("office:1", build, { rent: "$10,000" });
    ui.hideEditor();
    expect(ui.isEditorOpen()).toBe(false);
    expect(editorEl().innerHTML).toBe("");

    ui.renderEditor("office:1", build, { rent: "$10,000" });
    expect(build).toHaveBeenCalledTimes(2); // stale key was dropped
    expect(ui.isEditorOpen()).toBe(true);
  });

  it("the editor card's .ed-close hides it", () => {
    const { ui } = makeUI();
    ui.showEditor('<h4>Office</h4><button class="ed-close">✕</button>');
    expect(ui.isEditorOpen()).toBe(true);
    editorEl().querySelector<HTMLElement>(".ed-close")!.click();
    expect(ui.isEditorOpen()).toBe(false);
  });
});

describe("toast — kind class and stack cap", () => {
  const wrap = (): HTMLElement => document.getElementById("toast-wrap")!;

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
