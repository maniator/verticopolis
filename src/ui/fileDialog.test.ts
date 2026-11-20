import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, type TemplateResult } from "lit-html";

const m = vi.hoisted(() => ({ track: vi.fn() }));
vi.mock("../analytics", () => ({ trackAppAction: m.track }));

import type { TowerFileEntry } from "../storage/fileSpace";
import { clearFileClipboardForTests, fileRows, showFileDialog, type FileDialogCtx, type FileNote } from "./fileDialog";
import { ROW_HOLD_MS } from "./fileDialogPress";
import type { FileRow } from "./templates/fileDialog";

const entry = (
  id: string,
  name: string,
  modified: number,
  kind: TowerFileEntry["kind"] = "tower",
  size = 100,
): TowerFileEntry => ({ id, name, kind, size, modified });
const AUTO: FileRow = { id: "auto", name: "Auto-save (Sky)", type: "auto", modified: 50 };

let files: TowerFileEntry[];
let listeners: (() => void)[];
let ctx: FileDialogCtx & {
  [K in "open" | "save" | "rename" | "duplicate" | "remove" | "add" | "fromComputer"]: ReturnType<typeof vi.fn>;
};
let ui: { openModalTemplate: ReturnType<typeof vi.fn>; closeModal: ReturnType<typeof vi.fn> };
let box: HTMLElement | null;

function makeCtx(mode: "open" | "saveAs", over: Partial<FileDialogCtx> = {}) {
  const ok = async (): Promise<FileNote | null> => null;
  ctx = {
    mode,
    initialName: mode === "saveAs" ? "Sky" : "",
    auto: () => AUTO,
    files: () => files,
    usage: () => ({ count: files.length, bytes: 0 }),
    loading: () => false,
    onChange: (l) => {
      listeners.push(l);
      return () => (listeners = listeners.filter((x) => x !== l));
    },
    open: vi.fn(),
    save: vi.fn(ok),
    rename: vi.fn(ok),
    duplicate: vi.fn(ok),
    remove: vi.fn(ok),
    add: vi.fn(ok),
    fromComputer: vi.fn(),
    asked: vi.fn(),
    downloadKept: null,
    ...over,
  } as typeof ctx;
  return ctx;
}

const show = (mode: "open" | "saveAs", over: Partial<FileDialogCtx> = {}) =>
  showFileDialog(ui as never, makeCtx(mode, over));
const q = <T extends HTMLElement = HTMLElement>(sel: string) => box!.querySelector<T>(sel)!;
const rowNames = () => [...box!.querySelectorAll(".fd-row .fd-name-cell")].map((e) => e.textContent);
const key = (el: Element, k: string, init: KeyboardEventInit = {}) =>
  el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init }));
const button = (text: string) =>
  [...box!.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === text)!;
const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  files = [entry("a", "Alpha", 10), entry("b", "Bravo", 30, "tdt"), entry("c", "charlie 10", 20)];
  listeners = [];
  box = null;
  ui = {
    openModalTemplate: vi.fn((tpl: TemplateResult) => {
      box = document.createElement("div");
      render(tpl, box);
      document.body.append(box);
      return box;
    }),
    closeModal: vi.fn(() => box?.remove()),
  };
  clearFileClipboardForTests();
});

afterEach(() => {
  box?.remove();
  vi.useRealTimers();
});

describe("the rows a window lists", () => {
  it("puts the Auto-save first, then the files newest first", () => {
    expect(fileRows(AUTO, files, "all", { key: "modified", down: true }).map((r) => r.id)).toEqual([
      "auto",
      "b",
      "c",
      "a",
    ]);
  });

  it("sorts by name the way a person reads numbers, either way round", () => {
    const more = [...files, entry("d", "charlie 9", 1)];
    expect(fileRows(null, more, "all", { key: "name", down: false }).map((r) => r.name)).toEqual([
      "Alpha",
      "Bravo",
      "charlie 9",
      "charlie 10",
    ]);
    expect(fileRows(null, more, "all", { key: "name", down: true }).map((r) => r.name)).toEqual([
      "charlie 10",
      "charlie 9",
      "Bravo",
      "Alpha",
    ]);
  });

  it("shows only the filtered type, and the Auto-save only under All towers", () => {
    expect(fileRows(AUTO, files, "tdt", { key: "modified", down: true }).map((r) => r.id)).toEqual(["b"]);
    expect(fileRows(AUTO, files, "tower", { key: "size", down: false }).map((r) => r.id)).toEqual(["a", "c"]);
  });
});

describe("the Open window", () => {
  it("opens a row on a double click, closing the window first", () => {
    show("open");
    expect(rowNames()).toEqual(["Auto-save (Sky)", "Bravo", "charlie 10", "Alpha"]);
    q("#fd-row-c").dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(ui.closeModal).toHaveBeenCalledOnce();
    expect(ctx.open).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ id: "c", name: "charlie 10", type: "tower" }),
    );
    expect(ui.closeModal.mock.invocationCallOrder[0]).toBeLessThan(ctx.open.mock.invocationCallOrder[0]);
  });

  it("moves with the arrows and opens with Enter", () => {
    show("open");
    const list = q(".fd-rows");
    key(list, "ArrowDown");
    key(list, "ArrowDown");
    key(list, "Enter");
    expect(ctx.open).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: "b" }));
  });

  it("opens a typed name, and says so when no tower has it", () => {
    show("open");
    const name = q<HTMLInputElement>("#fd-name");
    name.value = "nobody";
    name.dispatchEvent(new Event("input"));
    button("Open").click();
    expect(q(".fd-line").textContent).toBe(`There's no tower named "nobody" in My Towers.`);
    name.value = "ALPHA";
    name.dispatchEvent(new Event("input"));
    button("Open").click();
    expect(ctx.open).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: "a" }));
  });

  it("shows the Auto-save's size and counts it in the header with the files", () => {
    const sized = { auto: () => ({ ...AUTO, size: 20 * 1024 }), usage: () => ({ count: 2, bytes: 40 * 1024 }) };
    show("open", sized);
    expect(q(".fd-row .fd-size-cell").textContent).toBe("20 KB");
    expect(q(".fd-usage").textContent).toBe("3 towers, 60 KB");
    box?.remove();
    show("open", { ...sized, usage: () => ({ count: 0, bytes: 0 }) });
    expect(q(".fd-usage").textContent, "the Auto-save alone is a tower").toBe("1 tower, 20 KB");
    box?.remove();
    show("saveAs", sized);
    expect(q(".fd-usage").textContent, "Save As lists no Auto-save, so counts none").toBe("2 towers, 40 KB");
  });

  it("says My Towers is opening and holds Open until the list is in", () => {
    let loading = true;
    files = [];
    show("open", { loading: () => loading });
    expect(q(".fd-usage").textContent).toBe("Opening My Towers…");
    expect(rowNames(), "the Auto-save shows at once").toEqual(["Auto-save (Sky)"]);
    expect(q<HTMLButtonElement>(".fd-primary").disabled).toBe(true);
    const name = q<HTMLInputElement>("#fd-name");
    name.value = "Alpha";
    name.dispatchEvent(new Event("input"));
    name.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    expect(box!.querySelector(".fd-line"), "no 'no tower named' before the list is in").toBeNull();
    loading = false;
    files = [entry("a", "Alpha", 10)];
    for (const l of listeners) l();
    expect(q(".fd-usage").textContent).not.toContain("Opening");
    expect(rowNames()).toEqual(["Auto-save (Sky)", "Alpha"]);
    expect(q<HTMLButtonElement>(".fd-primary").disabled).toBe(false);
  });

  it("blocks the window behind its message box, keeps Tab inside it, and gives the focus back on No", () => {
    show("open");
    q("#fd-row-a").click();
    key(q(".fd-rows"), "Delete");
    expect(q(".fd-ask-layer [role='alertdialog']").getAttribute("aria-modal")).toBe("true");
    expect(q(".fd-tools"), "the window's buttons stay drawn under the box").not.toBeNull();
    const [yes, no] = [q('[data-fd-ask="yes"]'), q('[data-fd-ask="no"]')];
    key(no, "Tab");
    expect(document.activeElement).toBe(yes);
    key(yes, "Tab");
    expect(document.activeElement).toBe(no);
    no.click();
    expect(box!.querySelector(".fd-ask-layer")).toBeNull();
    expect(ctx.remove).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(q(".fd-rows"));
  });

  it("keeps the right-click menu inside the window near its right and bottom edges", () => {
    show("open");
    q(".fd").getBoundingClientRect = () => ({
      left: 10,
      top: 20,
      width: 300,
      height: 400,
      right: 310,
      bottom: 420,
      x: 10,
      y: 20,
      toJSON: () => ({}),
    });
    const proto = HTMLElement.prototype;
    const width = Object.getOwnPropertyDescriptor(proto, "offsetWidth")!;
    const height = Object.getOwnPropertyDescriptor(proto, "offsetHeight")!;
    const menuSize = (size: number) => ({
      configurable: true,
      get(this: HTMLElement) {
        return this.classList.contains("fd-menu") ? size : 0;
      },
    });
    Object.defineProperty(proto, "offsetWidth", menuSize(140));
    Object.defineProperty(proto, "offsetHeight", menuSize(150));
    try {
      const press = (x: number, y: number) =>
        q(".fd-row").dispatchEvent(
          new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: x, clientY: y }),
        );
      press(300, 400);
      expect([q(".fd-menu").style.left, q(".fd-menu").style.top], "moved left and up to fit").toEqual([
        "160px",
        "250px",
      ]);
      press(50, 60);
      expect([q(".fd-menu").style.left, q(".fd-menu").style.top], "a menu that fits stays at the pointer").toEqual([
        "40px",
        "40px",
      ]);
    } finally {
      Object.defineProperty(proto, "offsetWidth", width);
      Object.defineProperty(proto, "offsetHeight", height);
    }
  });

  it("says My Towers is opening in an empty list", () => {
    files = [];
    show("saveAs", { loading: () => true });
    expect(q(".fd-empty").textContent).toBe("Opening My Towers…");
  });

  it("asks before deleting, and Esc drops the question before the window", () => {
    show("open");
    q("#fd-row-a").click();
    key(q(".fd-rows"), "Delete");
    expect(q(".fd-ask").textContent).toContain(`Are you sure you want to delete "Alpha"?`);
    expect(q(".fd-ask").textContent).toContain("It can't be undone.");
    expect(q("#fd-ask-title").textContent).toBe("Confirm File Delete");
    expect(document.activeElement, "No has the focus").toBe(q('[data-fd-ask="no"]'));
    expect(ctx.asked).toHaveBeenCalledExactlyOnceWith("delete");
    key(q(".fd-ask"), "Escape");
    expect(box!.querySelector(".fd-ask")).toBeNull();
    expect(ctx.remove).not.toHaveBeenCalled();
    key(q(".fd-rows"), "Delete");
    q('[data-fd-ask="yes"]').click();
    expect(ctx.remove).toHaveBeenCalledExactlyOnceWith("a");
  });

  it("copies and pastes a tower as a copy beside it, and Paste stays until the copy is deleted", async () => {
    show("open");
    q("#fd-row-b").click();
    key(q(".fd-rows"), "c", { ctrlKey: true });
    expect(q(".fd-line").textContent).toBe(`Copied "Bravo". Paste makes a copy of it here.`);
    key(q(".fd-rows"), "v", { metaKey: true });
    expect(ctx.duplicate).toHaveBeenCalledExactlyOnceWith("b");
    await settle();
    files = files.filter((f) => f.id !== "b");
    listeners.forEach((l) => l());
    key(q(".fd-rows"), "v", { ctrlKey: true });
    expect(ctx.duplicate).toHaveBeenCalledOnce();
    expect(q(".fd-line").textContent).toBe("The tower you copied has been deleted.");
  });

  it("renames in place with F2 and Enter, and leaves the Auto-save alone", async () => {
    show("open");
    q("#fd-row-auto").click();
    key(q(".fd-rows"), "F2");
    expect(box!.querySelector(".fd-rename")).toBeNull();
    q("#fd-row-a").click();
    key(q(".fd-rows"), "F2");
    const input = q<HTMLInputElement>(".fd-rename");
    input.value = "  Apex  ";
    key(input, "Enter");
    expect(ctx.rename).toHaveBeenCalledExactlyOnceWith("a", "  Apex  ");
    await settle();
    expect(q<HTMLInputElement>("#fd-name").value).toBe("Apex");
  });

  it("shows a failed command's note and keeps the window open", async () => {
    show("open", { duplicate: vi.fn(async () => ({ text: "My Towers is full.", kind: "bad" as const })) });
    q("#fd-row-a").click();
    button("Duplicate").click();
    await settle();
    expect(q(".fd-line").textContent).toBe("My Towers is full.");
    expect(box!.isConnected).toBe(true);
  });

  it("adds tower files dropped on it", () => {
    show("open");
    const dropped = new File(["x"], "Spire.vctower");
    const drop = new Event("drop", { bubbles: true, cancelable: true }) as DragEvent;
    Object.defineProperty(drop, "dataTransfer", { value: { types: ["Files"], files: [dropped] } });
    q(".fd").dispatchEvent(drop);
    expect(ctx.add).toHaveBeenCalledExactlyOnceWith([dropped], "drop");
    expect(drop.defaultPrevented).toBe(true);
  });

  it("offers a kept unreadable autosave, and closes before downloading it", () => {
    const downloadKept = vi.fn();
    show("open", { downloadKept });
    q(".fd-kept button").click();
    expect(ui.closeModal).toHaveBeenCalledOnce();
    expect(downloadKept).toHaveBeenCalledOnce();
  });

  it("opens a right-click menu on a row whose items act on that row, and Esc closes it first", () => {
    show("open");
    q("#fd-row-a").dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 40, clientY: 60 }),
    );
    const items = () => [...box!.querySelectorAll<HTMLButtonElement>(".fd-menu .mb-item")];
    expect(items().map((b) => [b.textContent, b.getAttribute("aria-disabled")])).toEqual([
      ["Open", "false"],
      ["Rename", "false"],
      ["Copy", "false"],
      ["Paste", "true"],
      ["Duplicate", "false"],
      ["Delete", "false"],
    ]);
    expect(q<HTMLInputElement>("#fd-name").value).toBe("Alpha");
    items()[3].click();
    expect(box!.querySelector(".fd-menu")).toBeNull();
    expect(ctx.duplicate).not.toHaveBeenCalled();
    q("#fd-row-a").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    items()[4].click();
    expect(ctx.duplicate).toHaveBeenCalledExactlyOnceWith("a");
    q("#fd-row-a").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    key(q(".fd-menu"), "Escape");
    expect(box!.querySelector(".fd-menu")).toBeNull();
    expect(box!.isConnected).toBe(true);
  });

  it("opens a row's menu on a held finger, once, and keeps it open through the finger's lift", () => {
    vi.useFakeTimers();
    const versions = vi.fn();
    show("open", { versions });
    m.track.mockClear();
    const touch = (type: string) =>
      new PointerEvent(type, {
        pointerType: "touch",
        pointerId: 3,
        isPrimary: true,
        clientX: 30,
        clientY: 40,
        bubbles: true,
        cancelable: true,
      });
    q("#fd-row-a").dispatchEvent(touch("pointerdown"));
    vi.advanceTimersByTime(ROW_HOLD_MS);
    expect(q<HTMLInputElement>("#fd-name").value).toBe("Alpha");
    // Android's own hold arrives too; the menu is not opened again.
    q("#fd-row-a").dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 30, clientY: 40 }),
    );
    q("#fd-row-a").dispatchEvent(touch("pointerup"));
    q(".fd-menu .mb-item").dispatchEvent(new MouseEvent("click", { detail: 1, bubbles: true, cancelable: true }));
    expect(ctx.open, "the lift's click pressed nothing").not.toHaveBeenCalled();
    expect(m.track).toHaveBeenCalledExactlyOnceWith("file_menu", "hold");
    const items = [...box!.querySelectorAll<HTMLButtonElement>(".fd-menu .mb-item")];
    expect(items.map((b) => b.textContent)).toContain("Previous versions…");
    items.find((b) => b.textContent === "Previous versions…")!.click();
    expect(versions).toHaveBeenCalledExactlyOnceWith("a", expect.any(Function));
  });

  it("leaves a hold or a right-click in the rename box to the text, with no row menu", () => {
    vi.useFakeTimers();
    show("open");
    q("#fd-row-a").click();
    key(q(".fd-rows"), "F2");
    const field = q(".fd-rename");
    field.dispatchEvent(
      new PointerEvent("pointerdown", {
        pointerType: "touch",
        pointerId: 4,
        isPrimary: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    vi.advanceTimersByTime(ROW_HOLD_MS * 2);
    const native = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    field.dispatchEvent(native);
    expect(box!.querySelector(".fd-menu")).toBeNull();
    expect(native.defaultPrevented, "the browser's own text menu still shows").toBe(false);
  });

  it("offers only Open and Paste on the Auto-save's menu, opened with Shift+F10", () => {
    show("open");
    q("#fd-row-auto").click();
    key(q(".fd-rows"), "F10", { shiftKey: true });
    expect([...box!.querySelectorAll(".fd-menu .mb-item")].map((b) => b.textContent)).toEqual(["Open", "Paste"]);
    expect(m.track).toHaveBeenLastCalledWith("file_menu", "key");
    q(".fd-menu .mb-item").click();
    expect(ctx.open).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: "auto" }));
  });

  it("deletes and renames from the menu, and a click on the list closes it", () => {
    show("open");
    const menuItem = (text: string) =>
      [...box!.querySelectorAll<HTMLButtonElement>(".fd-menu .mb-item")].find((b) => b.textContent === text)!;
    q("#fd-row-c").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    q(".fd-list").click();
    expect(box!.querySelector(".fd-menu")).toBeNull();
    q("#fd-row-c").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    menuItem("Delete").click();
    expect(q(".fd-ask").textContent).toContain(`delete "charlie 10"?`);
    q('[data-fd-ask="no"]').click();
    expect(box!.querySelector(".fd-ask")).toBeNull();
    q("#fd-row-c").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    menuItem("Copy").click();
    expect(q(".fd-line").textContent).toBe(`Copied "charlie 10". Paste makes a copy of it here.`);
    q("#fd-row-c").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    menuItem("Rename").click();
    expect(q<HTMLInputElement>(".fd-rename").value).toBe("charlie 10");
  });

  it("drops a rename on Esc, and keeps one typed before the box loses focus", () => {
    show("open");
    q("#fd-row-a").click();
    key(q(".fd-rows"), "F2");
    key(q(".fd-rename"), "Escape");
    expect(box!.querySelector(".fd-rename")).toBeNull();
    expect(ctx.rename).not.toHaveBeenCalled();
    button("Rename").click();
    const input = q<HTMLInputElement>(".fd-rename");
    input.value = "Alpha";
    input.dispatchEvent(new Event("blur"));
    expect(ctx.rename).not.toHaveBeenCalled();
    button("Rename").click();
    q<HTMLInputElement>(".fd-rename").value = "Aleph";
    q(".fd-rename").dispatchEvent(new Event("blur"));
    expect(ctx.rename).toHaveBeenCalledExactlyOnceWith("a", "Aleph");
  });

  it("sorts on a column click, reverses on a second, and filters by type", () => {
    show("open");
    q(".fd-col-name").click();
    expect(rowNames()).toEqual(["Auto-save (Sky)", "Alpha", "Bravo", "charlie 10"]);
    expect(q(".fd-col-name").textContent).toBe("Name ▲");
    q(".fd-col-name").click();
    expect(rowNames()).toEqual(["Auto-save (Sky)", "charlie 10", "Bravo", "Alpha"]);
    const type = q<HTMLSelectElement>("#fd-type");
    type.value = "tdt";
    type.dispatchEvent(new Event("change"));
    expect(rowNames()).toEqual(["Bravo"]);
    files = [];
    listeners.forEach((l) => l());
    expect(q(".fd-empty").textContent).toBe("No towers of this type.");
  });

  it("jumps with Home, End and the up arrow", () => {
    show("open");
    const list = q(".fd-rows");
    key(list, "End");
    expect(q("#fd-row-a").getAttribute("aria-selected")).toBe("true");
    key(list, "ArrowUp");
    expect(q("#fd-row-c").getAttribute("aria-selected")).toBe("true");
    key(list, "Home");
    expect(q("#fd-row-auto").getAttribute("aria-selected")).toBe("true");
    expect(q<HTMLInputElement>("#fd-name").value).toBe("Auto-save (Sky)");
  });

  it("shows where to drop while tower files are dragged over, and hides it when they leave", () => {
    show("open");
    const drag = (type: string) => {
      const e = new Event(type, { bubbles: true, cancelable: true }) as DragEvent;
      Object.defineProperty(e, "dataTransfer", { value: { types: ["Files"], files: [], dropEffect: "none" } });
      q(".fd").dispatchEvent(e);
      return e;
    };
    drag("dragenter");
    expect(q(".fd-drop-note").textContent).toBe("Drop tower files here to add them to My Towers");
    const over = drag("dragover");
    expect(over.defaultPrevented).toBe(true);
    expect(over.dataTransfer!.dropEffect).toBe("copy");
    drag("dragleave");
    expect(box!.querySelector(".fd-drop-note")).toBeNull();
  });

  it("redraws when the folder changes in another tab, and stops listening once closed", () => {
    show("open");
    files = [...files, entry("d", "Delta", 99)];
    listeners.forEach((l) => l());
    expect(rowNames()[1]).toBe("Delta");
    button("Cancel").click();
    listeners.forEach((l) => l());
    expect(listeners).toHaveLength(0);
  });
});

describe("the Save As window", () => {
  it("saves a new name and closes", async () => {
    show("saveAs");
    expect(rowNames()).not.toContain("Auto-save (Sky)");
    button("Save").click();
    expect(ctx.save).toHaveBeenCalledExactlyOnceWith("Sky", false);
    await settle();
    expect(ui.closeModal).toHaveBeenCalledOnce();
  });

  it("asks before replacing a tower of the same name, whatever its case", async () => {
    show("saveAs");
    const name = q<HTMLInputElement>("#fd-name");
    name.value = "alpha";
    name.dispatchEvent(new Event("input"));
    key(name, "Enter");
    expect(q(".fd-ask").textContent).toContain(`"alpha" already exists.`);
    expect(q(".fd-ask").textContent).toContain(`Save this tower as "alpha (2)", or replace it?`);
    expect(q("#fd-ask-title").textContent).toBe("Save As");
    expect(document.activeElement, "the numbered name has the focus").toBe(q('[data-fd-ask="alt"]'));
    expect(ctx.save).not.toHaveBeenCalled();
    button("Replace").click();
    expect(ctx.save).toHaveBeenCalledExactlyOnceWith("alpha", true);
  });

  it("offers the next free numbered name instead of replacing, the way Windows does", () => {
    files.push(entry("d", "Alpha (2)", 5));
    show("saveAs");
    const name = q<HTMLInputElement>("#fd-name");
    name.value = "Alpha";
    name.dispatchEvent(new Event("input"));
    key(name, "Enter");
    const alt = q('[data-fd-ask="alt"]');
    expect(alt.textContent).toBe(`Save as "Alpha (3)"`);
    expect(button("Cancel")).toBeTruthy();
    key(alt, "Tab");
    expect(document.activeElement, "Tab walks all three buttons").toBe(q('[data-fd-ask="yes"]'));
    alt.click();
    expect(ctx.save).toHaveBeenCalledExactlyOnceWith("Alpha (3)", false);
  });

  it("refuses an empty name", () => {
    show("saveAs");
    const name = q<HTMLInputElement>("#fd-name");
    name.value = "   ";
    name.dispatchEvent(new Event("input"));
    button("Save").click();
    expect(q(".fd-line").textContent).toBe("Type a name for the tower.");
    expect(ctx.save).not.toHaveBeenCalled();
  });

  it("hands the device download to the caller", () => {
    show("saveAs");
    q(".fd-computer").click();
    expect(ui.closeModal).toHaveBeenCalledOnce();
    expect(ctx.fromComputer).toHaveBeenCalledOnce();
  });
});
