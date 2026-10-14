import { afterEach, describe, expect, it, vi } from "vitest";
import { finishModal, type ModalDeps } from "./uiModal";

const deps = (): ModalDeps => ({
  titleBarClose: () => document.createElement("button"),
  closeModal: vi.fn(),
  drainNotice: vi.fn(),
});

describe("finishModal", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("opens the dialog", () => {
    document.body.innerHTML = `<dialog id="modal"><div class="box"><h2>Saves</h2></div></dialog>`;
    const dialog = document.getElementById("modal") as HTMLDialogElement;
    finishModal(dialog, dialog.querySelector(".box") as HTMLElement, deps());
    expect(dialog.open).toBe(true);
  });

  it("never opens behind a wasm-only engine-failure message, whose Reload button the top layer would cover", () => {
    document.body.innerHTML = `<div id="engine-failure"></div><dialog id="modal"><div class="box"><h2>Import report</h2></div></dialog>`;
    const dialog = document.getElementById("modal") as HTMLDialogElement;
    finishModal(dialog, dialog.querySelector(".box") as HTMLElement, deps());
    expect(dialog.open).toBe(false);
  });
});
