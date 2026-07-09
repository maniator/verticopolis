// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { UI, type UICallbacks } from "../ui/UI";
import { Simulation } from "../engine/Simulation";
import * as platformModule from "../platform";

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
    const { cb } = makeUI();
    document.getElementById("btn-export")!.click();
    expect(dialog().open).toBe(true);
    expect(cb.onExport).not.toHaveBeenCalled(); // nothing serialized yet
    const primary = dialog().querySelector('[data-act="export"]')!;
    expect(primary.textContent).toBe("Export"); // not a generic "Confirm"
    expect(primary.classList.contains("primary")).toBe(true); // one primary per dialog
    click('[data-act="close"]'); // cancel → still no export
    expect(cb.onExport).not.toHaveBeenCalled();

    document.getElementById("btn-export")!.click();
    click('[data-act="export"]');
    expect(cb.onExport).toHaveBeenCalledTimes(1);
    expect(dialog().open).toBe(false); // the toast isn't hidden under the modal
  });

  it("the confirm dialog's secondary routes to the 1994 export flow, never the .vctower one", () => {
    const { cb } = makeUI();
    document.getElementById("btn-export")!.click();
    click('[data-act="legacy"]');
    expect(cb.onExportLegacy).toHaveBeenCalledTimes(1);
    expect(cb.onExport).not.toHaveBeenCalled();
    expect(dialog().open).toBe(false);
  });

  it("the 1994 export is disabled for a Modern tower (Classic only)", () => {
    const { cb } = makeUI({ getMode: () => "modern" as const });
    document.getElementById("btn-export")!.click();
    const legacy = document.querySelector('[data-act="legacy"]') as HTMLButtonElement;
    expect(legacy.disabled).toBe(true);
    legacy.click(); // a disabled button fires nothing
    expect(cb.onExportLegacy).not.toHaveBeenCalled();
    // the primary .vctower export still works
    click('[data-act="export"]');
    expect(cb.onExport).toHaveBeenCalledTimes(1);
  });

  it("the Import button goes straight to the file picker — no modal, no textarea — accepting .vctower first", () => {
    makeUI();
    const picker = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});
    document.getElementById("btn-import")!.click();
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
    const { cb } = makeUI();
    vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});
    document.getElementById("btn-import")!.click();
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
    const { cb } = makeUI();
    vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});
    document.getElementById("btn-import")!.click();
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
    const { cb } = makeUI();
    vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});
    document.getElementById("btn-import")!.click();
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

  it("puts the link in the modal BODY, leaving the footer at its three buttons", () => {
    const { ui } = makeUI();
    ui.showHelp();
    const box = dialog().firstElementChild!;
    const actions = box.querySelector(".modal-actions")!;
    // The report link is a body affordance, never a dialog action.
    expect(actions.querySelector('a[href*="/issues/new"]')).toBeNull();
    // Footer stays exactly reduce-motion / steady-clock / replay-onboard / close (Got it).
    const acts = [...actions.querySelectorAll("[data-act]")].map((b) => b.getAttribute("data-act"));
    expect(acts).toEqual(["reduce-motion", "steady-clock", "replay-onboard", "close"]);
  });

  it("wires the Steady clock toggle: label follows the callback's returned state across clicks", () => {
    // A stateful stub (On, then Off) makes a stuck toggle or a stale-state
    // regression falsifiable; a constant stub would pass either bug.
    let steady = false;
    const toggle = vi.fn(() => (steady = !steady));
    const { ui, cb } = makeUI({ onToggleSteadyClock: toggle, isSteadyClock: vi.fn(() => steady) });
    ui.showHelp();
    const btn = dialog().querySelector<HTMLButtonElement>('[data-act="steady-clock"]')!;
    // Fresh device: breathing clock on, so the "steady" pref reads Off.
    expect(btn.textContent).toBe("Steady clock: Off");
    expect(btn.getAttribute("aria-pressed")).toBe("false");
    btn.click();
    expect(cb.onToggleSteadyClock).toHaveBeenCalledTimes(1);
    expect(btn.textContent).toBe("Steady clock: On");
    expect(btn.getAttribute("aria-pressed")).toBe("true");
    btn.click();
    expect(btn.textContent).toBe("Steady clock: Off");
    expect(btn.getAttribute("aria-pressed")).toBe("false");
  });

  it("derives the toggle's initial label from the live isSteadyClock callback", () => {
    const { ui } = makeUI({ isSteadyClock: vi.fn(() => true) });
    ui.showHelp();
    const btn = dialog().querySelector<HTMLButtonElement>('[data-act="steady-clock"]')!;
    expect(btn.textContent).toBe("Steady clock: On");
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
});

describe("newTowerModal — the rule-set picker", () => {
  it("founds Classic by default (the pre-checked mode)", () => {
    const onFound = vi.fn();
    const { ui } = makeUI();
    ui.newTowerModal({ hasSave: false, onFound });
    click('[data-act="found"]');
    expect(onFound).toHaveBeenCalledWith("classic");
    expect(dialog().open).toBe(false); // and it closes on commit
  });

  it("founds Modern when that radio is chosen", () => {
    const onFound = vi.fn();
    const { ui } = makeUI();
    ui.newTowerModal({ hasSave: false, onFound });
    dialog().querySelector<HTMLInputElement>('input[value="modern"]')!.checked = true;
    click('[data-act="found"]');
    expect(onFound).toHaveBeenCalledWith("modern");
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
  const header = (group: string): HTMLElement =>
    palette().querySelector<HTMLElement>(`.pal-group-title[data-group="${group}"]`)!;

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
    // Groups with no unlocked member hide their header; populated ones stay.
    expect(header("Structure").hidden).toBe(false);
    expect(header("Commercial").hidden).toBe(false);
    expect(header("Leisure").hidden).toBe(true);
    expect(header("Services").hidden).toBe(true);
    expect(header("Special").hidden).toBe(true);

    sim.star = 3;
    ui.update(sim);
    // 2★/3★ kinds now reveal; their group headers appear.
    expect(item("hotelSingle").classList.contains("locked")).toBe(false);
    expect(item("restaurant").classList.contains("locked")).toBe(false);
    expect(item("cinema").classList.contains("locked")).toBe(false);
    expect(header("Leisure").hidden).toBe(false);
    expect(header("Services").hidden).toBe(false);
    // 4★/5★ kinds stay hidden until their tier.
    expect(item("metro").classList.contains("locked")).toBe(true);
    expect(header("Special").hidden).toBe(true);
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

  it("audio toggle flips the icon to match the reported muted state", () => {
    const { cb } = makeUI({ onToggleAudio: vi.fn().mockReturnValueOnce(true).mockReturnValueOnce(false) });
    const audio = document.getElementById("audio-toggle")!;
    audio.click();
    expect(audio.textContent).toBe("🔇");
    audio.click();
    expect(audio.textContent).toBe("🔊");
    expect(cb.onToggleAudio).toHaveBeenCalledTimes(2);
  });

  it("undo / redo / save / load / stats each route to their callback", () => {
    const { cb } = makeUI();
    document.getElementById("btn-undo")!.click();
    document.getElementById("btn-redo")!.click();
    document.getElementById("btn-save")!.click();
    document.getElementById("btn-load")!.click();
    document.getElementById("btn-stats")!.click();
    expect(cb.onUndo).toHaveBeenCalledOnce();
    expect(cb.onRedo).toHaveBeenCalledOnce();
    expect(cb.onSave).toHaveBeenCalledOnce();
    expect(cb.onShowSaves).toHaveBeenCalledOnce();
    expect(cb.onShowStats).toHaveBeenCalledOnce();
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

describe("showSaves — the save-slot manager", () => {
  const slots = [
    { slot: "auto" as const, exists: true, towerName: "Auto Twr", star: 2, population: 300, funds: 50000, savedAt: 1_700_000_000_000 },
    { slot: 1, exists: true, towerName: "One", star: 6, population: 15000, funds: 1_000_000, savedAt: 1_700_000_000_000 },
    { slot: 2, exists: false },
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

describe("showStopsDialog — per-floor elevator stop toggles", () => {
  it("renders a labeled row per floor (basements as B-n) and reports toggles", () => {
    const { ui } = makeUI();
    const toggles: Array<[number, boolean]> = [];
    ui.showStopsDialog(
      "Express",
      [
        { floor: 5, stop: true, lobby: false },
        { floor: 1, stop: true, lobby: true },
        { floor: -2, stop: false, lobby: false },
      ],
      (floor, stop) => toggles.push([floor, stop]),
    );
    const boxes = dialog().querySelectorAll<HTMLInputElement>("input[data-floor]");
    expect(boxes).toHaveLength(3);
    expect(dialog().textContent).toContain("Floor 5");
    expect(dialog().textContent).toContain("B2"); // basement label
    expect(dialog().querySelector(".stop-lobby")).not.toBeNull(); // lobby tag
    // Untick floor 5.
    const f5 = dialog().querySelector<HTMLInputElement>('input[data-floor="5"]')!;
    f5.checked = false;
    f5.dispatchEvent(new Event("change"));
    expect(toggles).toContainEqual([5, false]);
  });
});

describe("showStats / congratsTower / showUpdateChip — small dialogs & chrome", () => {
  it("showStats opens a modal with the supplied HTML and a working Close", () => {
    const { ui } = makeUI();
    ui.showStats("<p>ninety-nine floors</p>");
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
});

describe("showBatchPricingDialog — set-all rent/price with a reset confirm", () => {
  const result = { matched: 5, eligible: 5, changed: 3, skippedSold: 0, skippedCustom: 2, customOverwritten: 0, clampedLow: 0, clampedHigh: 0 };
  function open() {
    const { ui } = makeUI();
    const band = { default: 10000, min: 5000, max: 20000, step: 1000 };
    const preview = vi.fn(() => ({ ...result }));
    const apply = vi.fn(() => ({ ...result }));
    const onApplied = vi.fn();
    ui.showBatchPricingDialog({ kind: "office", kindLabel: "Office", band }, { preview, apply, onApplied });
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
});
