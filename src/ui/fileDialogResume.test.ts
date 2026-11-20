import { afterEach, describe, expect, it, vi } from "vitest";
import { render, type TemplateResult } from "lit-html";

vi.mock("../analytics", () => ({ trackAppAction: vi.fn() }));

import type { TowerFileEntry } from "../storage/fileSpace";
import { showFileDialog, type FileDialogCtx } from "./fileDialog";

/**
 * Previous versions… is a child window of the Open or Save As window: the
 * `back` the window hands it puts the window back as the player left it
 * (Naftali, 2026-11-17). The rest of the window is `fileDialog.test.ts`.
 */

const entry = (id: string, name: string, modified: number): TowerFileEntry => ({
  id,
  name,
  kind: "tower",
  size: 100,
  modified,
});
const files = [entry("a", "Alpha", 10), entry("c", "Charlie", 20), entry("b", "Bravo", 30)];

let boxes: HTMLElement[] = [];
const ui = {
  openModalTemplate: vi.fn((tpl: TemplateResult) => {
    boxes.forEach((b) => b.remove());
    const box = document.createElement("div");
    render(tpl, box);
    document.body.append(box);
    boxes.push(box);
    return box;
  }),
  closeModal: vi.fn(() => boxes.forEach((b) => b.remove())),
};

function show(mode: "open" | "saveAs", versions: FileDialogCtx["versions"]): void {
  const ok = async () => null;
  showFileDialog(ui, {
    mode,
    initialName: mode === "saveAs" ? "Sky" : "",
    auto: () => null,
    files: () => files,
    usage: () => ({ count: files.length, bytes: 0 }),
    loading: () => false,
    onChange: () => () => {},
    open: vi.fn(),
    save: vi.fn(ok),
    rename: vi.fn(ok),
    duplicate: vi.fn(ok),
    remove: vi.fn(ok),
    add: vi.fn(ok),
    fromComputer: vi.fn(),
    downloadKept: null,
    versions,
  });
}

const live = () => boxes[boxes.length - 1];
const q = <T extends HTMLElement = HTMLElement>(sel: string) => live().querySelector<T>(sel)!;
const names = () => [...live().querySelectorAll(".fd-row .fd-name-cell")].map((e) => e.textContent);

/** Right-click row `id` and pick Previous versions…; answers the `back` it got. */
function versionsOf(id: string, versions: ReturnType<typeof vi.fn>): () => void {
  q(`#fd-row-${id}`).dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
  [...live().querySelectorAll<HTMLButtonElement>(".fd-menu .mb-item")]
    .find((b) => b.textContent === "Previous versions…")!
    .click();
  return versions.mock.calls[versions.mock.calls.length - 1][1] as () => void;
}

afterEach(() => {
  boxes.forEach((b) => b.remove());
  boxes = [];
  vi.clearAllMocks();
});

describe("back from Previous versions…", () => {
  for (const mode of ["open", "saveAs"] as const) {
    it(`puts the ${mode === "open" ? "Open" : "Save As"} window back with its row, name, sort and scroll`, () => {
      const versions = vi.fn();
      show(mode, versions);
      q<HTMLButtonElement>(".fd-col-name").click();
      const sorted = names();
      expect(sorted, "sorted by name, not the default newest first").toEqual(["Alpha", "Bravo", "Charlie"]);
      q(".fd-rows").scrollTop = 40;
      const back = versionsOf("c", versions);
      expect(versions).toHaveBeenCalledExactlyOnceWith("c", back);
      // The versions window takes the dialog; here, the window is gone.
      live().remove();

      back();
      expect(ui.openModalTemplate).toHaveBeenCalledTimes(2);
      expect(names(), "the sort the player chose").toEqual(sorted);
      expect(q("#fd-row-c").getAttribute("aria-selected")).toBe("true");
      expect(q<HTMLInputElement>("#fd-name").value).toBe("Charlie");
      expect(live().querySelector(".fd-menu"), "the menu that opened the child stays closed").toBeNull();
      expect(q(".fd-rows").scrollTop).toBe(40);
      expect(document.activeElement).toBe(q(".fd-rows"));
    });
  }

  it("works again from the window it put back", () => {
    const versions = vi.fn();
    show("open", versions);
    versionsOf("a", versions)();
    const again = versionsOf("b", versions);
    again();
    expect(q("#fd-row-b").getAttribute("aria-selected")).toBe("true");
    expect(versions).toHaveBeenCalledTimes(2);
  });
});
