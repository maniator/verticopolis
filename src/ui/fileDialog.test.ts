import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, type TemplateResult } from "lit-html";
import type { TowerFileEntry } from "../storage/fileSpace";
import { clearFileClipboardForTests, fileRows, showFileDialog, type FileDialogCtx, type FileNote } from "./fileDialog";
import type { FileRow } from "./templates/fileDialog";

const entry = (id: string, name: string, modified: number, kind: TowerFileEntry["kind"] = "tower", size = 100): TowerFileEntry => ({ id, name, kind, size, modified });
const AUTO: FileRow = { id: "auto", name: "Auto-save (Sky)", type: "auto", modified: 50 };

let files: TowerFileEntry[];
let listeners: (() => void)[];
let ctx: FileDialogCtx & { [K in "open" | "save" | "rename" | "duplicate" | "remove" | "add" | "fromComputer"]: ReturnType<typeof vi.fn> };
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
    downloadKept: null,
    ...over,
  } as typeof ctx;
  return ctx;
}

const show = (mode: "open" | "saveAs", over: Partial<FileDialogCtx> = {}) => showFileDialog(ui as never, makeCtx(mode, over));
const q = <T extends HTMLElement = HTMLElement>(sel: string) => box!.querySelector<T>(sel)!;
const rowNames = () => [...box!.querySelectorAll(".fd-row .fd-name-cell")].map((e) => e.textContent);
const key = (el: Element, k: string, init: KeyboardEventInit = {}) => el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init }));
const button = (text: string) => [...box!.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === text)!;
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
});

describe("the rows a window lists", () => {
  it("puts the Auto-save first, then the files newest first", () => {
    expect(fileRows(AUTO, files, "all", { key: "modified", down: true }).map((r) => r.id)).toEqual(["auto", "b", "c", "a"]);
  });

  it("sorts by name the way a person reads numbers, either way round", () => {
    const more = [...files, entry("d", "charlie 9", 1)];
    expect(fileRows(null, more, "all", { key: "name", down: false }).map((r) => r.name)).toEqual(["Alpha", "Bravo", "charlie 9", "charlie 10"]);
    expect(fileRows(null, more, "all", { key: "name", down: true }).map((r) => r.name)).toEqual(["charlie 10", "charlie 9", "Bravo", "Alpha"]);
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
    expect(ctx.open).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: "c", name: "charlie 10", type: "tower" }));
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

  it("asks before deleting, and Esc drops the question before the window", () => {
    show("open");
    q("#fd-row-a").click();
    key(q(".fd-rows"), "Delete");
    expect(q(".fd-ask").textContent).toContain(`Delete "Alpha"? This can't be undone.`);
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
    expect(ctx.add).toHaveBeenCalledExactlyOnceWith([dropped]);
    expect(drop.defaultPrevented).toBe(true);
  });

  it("offers a kept unreadable autosave, and closes before downloading it", () => {
    const downloadKept = vi.fn();
    show("open", { downloadKept });
    q(".fd-kept button").click();
    expect(ui.closeModal).toHaveBeenCalledOnce();
    expect(downloadKept).toHaveBeenCalledOnce();
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
    expect(ctx.save).toHaveBeenCalledExactlyOnceWith("Sky");
    await settle();
    expect(ui.closeModal).toHaveBeenCalledOnce();
  });

  it("asks before replacing a tower of the same name, whatever its case", async () => {
    show("saveAs");
    const name = q<HTMLInputElement>("#fd-name");
    name.value = "alpha";
    name.dispatchEvent(new Event("input"));
    key(name, "Enter");
    expect(q(".fd-ask").textContent).toContain(`"alpha" already exists. Replace it?`);
    expect(ctx.save).not.toHaveBeenCalled();
    button("Replace").click();
    expect(ctx.save).toHaveBeenCalledExactlyOnceWith("alpha");
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
