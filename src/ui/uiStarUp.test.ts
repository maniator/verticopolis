import { describe, it, expect, vi } from "vitest";
import { render } from "lit-html";
import { showStarUp } from "./uiStarUp";
import type { UI } from "./UI";
import type { ModalOpts } from "./modalPrecedence";

/**
 * The star-up box's close paths: OK, Esc and the title-bar ✕ (both the
 * dialog's cancel) close it, a click outside it does not, and a dialog
 * opened over it counts as closing it. Each runs `onClosed` once. The UI is
 * a stand-in that mounts the template into a real `<dialog>`.
 */

function stage() {
  const dialog = document.createElement("dialog");
  document.body.replaceChildren(dialog);
  let opts: ModalOpts = {};
  const ui = {
    el: { modal: dialog },
    openModalTemplate: vi.fn((result, o: ModalOpts = {}) => {
      opts = o;
      render(result, dialog);
      return dialog;
    }),
    closeModal: vi.fn(),
  };
  const onClosed = vi.fn();
  showStarUp(ui as unknown as UI, { star: 3, rooms: [], headsUp: null, topFloor: 100 }, onClosed);
  return { dialog, ui, onClosed, displaced: () => opts.onDisplaced?.() };
}

describe("showStarUp", () => {
  it("OK closes the box and runs onClosed once", () => {
    const { dialog, ui, onClosed } = stage();
    dialog.querySelector<HTMLButtonElement>('[data-act="ok"]')!.click();
    dialog.querySelector<HTMLButtonElement>('[data-act="ok"]')!.click();
    expect(ui.closeModal).toHaveBeenCalledOnce();
    expect(onClosed).toHaveBeenCalledOnce();
  });

  it("Esc and the ✕ (the dialog's cancel) close it the same way", () => {
    const { dialog, ui, onClosed } = stage();
    const cancel = new Event("cancel", { cancelable: true });
    dialog.dispatchEvent(cancel);
    expect(cancel.defaultPrevented).toBe(true);
    expect(ui.closeModal).toHaveBeenCalledOnce();
    expect(onClosed).toHaveBeenCalledOnce();
  });

  it("a click outside the box does nothing", () => {
    const { dialog, ui, onClosed } = stage();
    dialog.click();
    expect(ui.closeModal).not.toHaveBeenCalled();
    expect(onClosed).not.toHaveBeenCalled();
  });

  it("a dialog opened over it runs onClosed without closing the newcomer", () => {
    const { ui, onClosed, displaced } = stage();
    displaced();
    expect(onClosed).toHaveBeenCalledOnce();
    expect(ui.closeModal).not.toHaveBeenCalled();
  });
});
