import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, type TemplateResult } from "lit-html";
import type { TowerFileEntry } from "../storage/fileSpace";
import type { LinkedFolderState } from "../storage/linkedFolder";
import { showFileDialog, type FileDialogCtx, type FileNote } from "./fileDialog";
import { resetFilePlaceForTests, type LinkedPlaceCtx } from "./fileDialogPlaces";

const entry = (id: string, name: string, kind: TowerFileEntry["kind"] = "tower"): TowerFileEntry => ({ id, name, kind, size: 100, modified: 10 });

let box: HTMLElement | null;
let ui: { openModalTemplate: ReturnType<typeof vi.fn>; closeModal: ReturnType<typeof vi.fn> };
let folder: LinkedFolderState | null;
let linked: { [K in keyof LinkedPlaceCtx]: LinkedPlaceCtx[K] extends (...a: never[]) => unknown ? ReturnType<typeof vi.fn> & LinkedPlaceCtx[K] : LinkedPlaceCtx[K] };
let ctx: FileDialogCtx & { [K in "open" | "save" | "duplicate" | "rename" | "remove" | "add"]: ReturnType<typeof vi.fn> };
let changed: (() => void)[];
let mirroring: boolean;

const ok = async (): Promise<FileNote | null> => null;

function makeLinked(): typeof linked {
  return {
    canLink: true,
    state: vi.fn(() => folder),
    files: vi.fn(() => [entry("Sky.vctower", "Sky"), entry("OLD.TDT", "OLD", "tdt")]),
    usage: vi.fn(() => ({ count: 2, bytes: 200 })),
    onChange: vi.fn((l: () => void) => {
      changed.push(l);
      return () => {};
    }),
    refresh: vi.fn(async () => {}),
    link: vi.fn(async () => {
      folder = { name: "Towers", access: "granted" };
      return "linked" as const;
    }),
    allow: vi.fn(async () => {
      folder = { name: "Towers", access: "granted" };
      return null;
    }),
    unlink: vi.fn(async () => {
      folder = null;
      return null;
    }),
    mirror: vi.fn(() => mirroring),
    setMirror: vi.fn(async (on: boolean) => {
      mirroring = on;
      return { text: on ? "copied" : "no longer copied", kind: "info" as const };
    }),
    open: vi.fn(),
    save: vi.fn(ok),
    duplicate: vi.fn(ok),
  } as typeof linked;
}

function show(mode: "open" | "saveAs", over: Partial<FileDialogCtx> = {}) {
  ctx = {
    mode,
    initialName: mode === "saveAs" ? "Sky" : "",
    auto: () => ({ id: "auto", name: "Auto-save (Sky)", type: "auto", modified: 50 }),
    files: () => [entry("a", "Alpha")],
    usage: () => ({ count: 1, bytes: 100 }),
    loading: () => false,
    onChange: () => () => {},
    open: vi.fn(),
    save: vi.fn(ok),
    rename: vi.fn(ok),
    duplicate: vi.fn(ok),
    remove: vi.fn(ok),
    add: vi.fn(ok),
    fromComputer: vi.fn(),
    asked: vi.fn(),
    downloadKept: null,
    linked,
    ...over,
  } as typeof ctx;
  showFileDialog(ui as never, ctx);
}

const q = <T extends HTMLElement = HTMLElement>(sel: string) => box!.querySelector<T>(sel)!;
const rowNames = () => [...box!.querySelectorAll(".fd-row .fd-name-cell")].map((e) => e.textContent);
const buttons = () => [...box!.querySelectorAll<HTMLButtonElement>("button")].map((b) => b.textContent?.trim().replace(/\s+/g, " "));
const button = (text: string) => [...box!.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim().replace(/\s+/g, " ").startsWith(text))!;
const lookItems = () => [...box!.querySelectorAll(".fd-look-item")].map((e) => e.textContent?.trim().replace(/\s+/g, " "));
const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  box = null;
  changed = [];
  mirroring = false;
  folder = null;
  linked = makeLinked();
  resetFilePlaceForTests();
  ui = {
    openModalTemplate: vi.fn((tpl: TemplateResult) => {
      box = document.createElement("div");
      render(tpl, box);
      document.body.append(box);
      return box;
    }),
    closeModal: vi.fn(() => box?.remove()),
  };
});
afterEach(() => box?.remove());

describe("the Look in box", () => {
  it("starts in My Towers and offers to link a folder", () => {
    show("open");
    expect(q(".fd-look-now").textContent).toContain("My Towers");
    q(".fd-look").click();
    expect(lookItems()).toEqual(["My Towersin this browser", "Link a folder on this computer…"]);
  });

  it("says in gray when the browser can't link a folder", () => {
    show("open", { linked: null });
    q(".fd-look").click();
    const item = box!.querySelector('.fd-look-item[aria-disabled="true"]')!;
    expect(item.textContent).toContain("This browser can't link a folder");
  });

  it("links a folder and lists it, leaving My Towers alone", async () => {
    show("open");
    q(".fd-look").click();
    button("Link a folder").click();
    expect(linked.link).toHaveBeenCalledOnce();
    await settle();
    expect(q(".fd-look-now").textContent).toContain("Towers");
    expect(rowNames().sort()).toEqual(["OLD", "Sky"]);
    expect(ctx.add).not.toHaveBeenCalled();
  });

  it("switches between the two places and remembers the last one", async () => {
    folder = { name: "Towers", access: "granted" };
    show("open");
    expect(rowNames()).toContain("Alpha");
    q(".fd-look").click();
    button("Towers").click();
    expect(linked.refresh).toHaveBeenCalled();
    expect(rowNames().sort()).toEqual(["OLD", "Sky"]);
    box!.remove();
    show("open");
    expect(rowNames().sort()).toEqual(["OLD", "Sky"]);
  });

  it("opens with the arrow keys and closes on Escape", () => {
    show("open");
    q(".fd-look").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
    expect(box!.querySelector(".fd-look-pop")).not.toBeNull();
    document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(box!.querySelector(".fd-look-pop")).toBeNull();
    expect(document.activeElement).toBe(q(".fd-look"));
  });

  it("unlinks and says the files are still there", async () => {
    folder = { name: "Towers", access: "granted" };
    show("open", { startIn: "linked" });
    q(".fd-look").click();
    button('Unlink "Towers"').click();
    await settle();
    expect(linked.unlink).toHaveBeenCalledOnce();
    expect(q(".fd-look-now").textContent).toContain("My Towers");
    expect(box!.textContent).toContain(`Unlinked "Towers". Its files are still there.`);
  });

  it("offers the Auto-save copy as a check item between Link and Unlink, and turns it on and off", async () => {
    folder = { name: "Towers", access: "granted" };
    show("open", { startIn: "linked" });
    q(".fd-look").click();
    expect(lookItems().slice(-3)).toEqual(["Link a different folder…", "Keep a copy of my towers here too", 'Unlink "Towers"its files stay']);
    const item = () => q(".fd-mirror");
    expect(item().getAttribute("role")).toBe("menuitemcheckbox");
    expect(item().getAttribute("aria-checked")).toBe("false");
    item().click();
    await settle();
    expect(linked.setMirror).toHaveBeenLastCalledWith(true);
    expect(box!.querySelector(".fd-look-pop")).toBeNull();
    expect(box!.textContent).toContain("copied");
    q(".fd-look").click();
    expect(item().getAttribute("aria-checked")).toBe("true");
    expect(item().textContent).toContain("✓");
    item().click();
    await settle();
    expect(linked.setMirror).toHaveBeenLastCalledWith(false);
  });

  it("offers no Auto-save copy while no folder is linked", () => {
    show("open");
    q(".fd-look").click();
    expect(box!.querySelector(".fd-mirror")).toBeNull();
  });
});

describe("the linked folder's list", () => {
  beforeEach(() => {
    folder = { name: "Towers", access: "granted" };
  });

  it("never offers Delete or Rename, and keeps Duplicate", () => {
    show("open", { startIn: "linked" });
    expect(buttons()).not.toContain("Delete");
    expect(buttons()).not.toContain("Rename");
    expect(buttons().some((b) => b?.startsWith("Duplicate"))).toBe(true);
    const row = q(".fd-row");
    row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 5, clientY: 5 }));
    const menu = [...box!.querySelectorAll(".fd-menu [role=menuitem]")].map((e) => e.textContent?.trim());
    expect(menu.some((t) => /Delete|Rename|Copy$|Paste/.test(t ?? ""))).toBe(false);
  });

  it("opens a row through the folder, not My Towers", () => {
    show("open", { startIn: "linked" });
    q(".fd-row").dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(linked.open).toHaveBeenCalledOnce();
    expect(ctx.open).not.toHaveBeenCalled();
  });

  it("hides the Auto-save", () => {
    show("open", { startIn: "linked" });
    expect(rowNames()).not.toContain("Auto-save (Sky)");
  });

  it("saves into the folder, and asks before replacing a tower of that name", async () => {
    show("saveAs", { startIn: "linked" });
    button("Save").click();
    await settle();
    expect(ctx.save).not.toHaveBeenCalled();
    expect(linked.save).not.toHaveBeenCalled();
    expect(box!.textContent).toContain(`Save this tower as "Sky (2)", or replace it?`);
    button("Replace").click();
    await settle();
    expect(linked.save).toHaveBeenCalledExactlyOnceWith("Sky", true);
  });

  it("does not count a 1994 file of the same name as taken", async () => {
    show("saveAs", { startIn: "linked", initialName: "OLD" });
    button("Save").click();
    await settle();
    expect(linked.save).toHaveBeenCalledExactlyOnceWith("OLD", false);
  });
});

describe("a folder waiting for the browser's OK", () => {
  beforeEach(() => {
    folder = { name: "Towers", access: "prompt" };
  });

  it("shows the Allow access note instead of rows, and holds Open", () => {
    show("open", { startIn: "linked" });
    expect(box!.textContent).toContain("Your browser needs your OK to open Towers again.");
    expect(rowNames()).toEqual([]);
    expect(button("Open").disabled).toBe(true);
  });

  it("asks once on the click and lists the folder after", async () => {
    show("open", { startIn: "linked" });
    button("Allow access").click();
    expect(linked.allow).toHaveBeenCalledOnce();
    await settle();
    changed.forEach((l) => l());
    expect(rowNames().sort()).toEqual(["OLD", "Sky"]);
  });
});

describe("From a folder…", () => {
  it("adds the picked folder's tower files to My Towers", async () => {
    show("open", { linked: null, canPickFolder: true });
    const click = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(function (this: HTMLInputElement) {
      const picked = [new File(["x"], "a.vctower"), new File(["y"], "notes.txt"), new File(["z"], "OLD.TDT")];
      Object.defineProperty(this, "files", { value: picked });
      this.dispatchEvent(new Event("change"));
    });
    button("From a folder").click();
    await settle();
    click.mockRestore();
    expect(ctx.add).toHaveBeenCalledOnce();
    expect((ctx.add.mock.calls[0][0] as File[]).map((f) => f.name)).toEqual(["a.vctower", "OLD.TDT"]);
    expect(ctx.add.mock.calls[0][1]).toBe("folder");
  });

  it("says so when the folder has no towers", async () => {
    show("open", { linked: null, canPickFolder: true });
    const click = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(function (this: HTMLInputElement) {
      Object.defineProperty(this, "files", { value: [new File(["y"], "notes.txt")] });
      this.dispatchEvent(new Event("change"));
    });
    button("From a folder").click();
    await settle();
    click.mockRestore();
    expect(ctx.add).not.toHaveBeenCalled();
    expect(box!.textContent).toContain("There are no tower files (.vctower or .TDT) in that folder.");
  });
});
