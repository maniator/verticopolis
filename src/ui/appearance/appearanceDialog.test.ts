import { describe, it, expect, vi, afterEach } from "vitest";
import { viewTemplate } from "../testing/litTestUtils";
import type { ModalView } from "@verticopolis/components/windows/uiModal";
import { render } from "lit-html";
import type { UI } from "../UI";
import { openAppearanceDialog } from "./appearanceDialog";

/** The UI's two modal primitives as spies: opening renders the template into
 *  a box on the page, as `UI.openModal` does; closing removes it. */
function uiDouble() {
  let box: HTMLElement | null = null;
  const ui = {
    openModal: vi.fn((t: ModalView) => {
      box?.remove();
      box = document.createElement("div");
      document.body.append(box);
      render(viewTemplate(t), box);
      return box;
    }),
    closeModal: vi.fn(() => {
      box?.remove();
      box = null;
    }),
  };
  return { ui, box: () => box };
}

function choose(box: HTMLElement, id: string) {
  const radio = box.querySelector<HTMLInputElement>(`input[value="${id}"]`)!;
  radio.checked = true;
  radio.dispatchEvent(new Event("change"));
}

const press = (box: HTMLElement, which: "ok" | "cancel") =>
  box.querySelector<HTMLButtonElement>(`[data-appearance="${which}"]`)!.click();

describe("the Appearance dialog", () => {
  afterEach(() => document.body.replaceChildren());

  it("lists the three schemes with the current one picked", () => {
    const { ui, box } = uiDouble();
    openAppearanceDialog(ui as unknown as UI, "skyline", vi.fn());
    const names = [...box()!.querySelectorAll(".appearance-name")].map((n) => n.textContent);
    expect(names).toEqual(["Standard", "Skyline", "High Contrast"]);
    expect(box()!.querySelector<HTMLInputElement>('input[value="skyline"]')!.checked).toBe(true);
    expect(ui.openModal).toHaveBeenCalledWith(expect.anything(), { displaceable: true });
  });

  it("hands OK the picked scheme and closes", () => {
    const { ui, box } = uiDouble();
    const save = vi.fn();
    openAppearanceDialog(ui as unknown as UI, "standard", save);
    choose(box()!, "high_contrast");
    press(box()!, "ok");
    expect(save).toHaveBeenCalledWith("high_contrast");
    expect(ui.closeModal).toHaveBeenCalledTimes(1);
  });

  it("changes nothing on Cancel, even after a pick", () => {
    const { ui, box } = uiDouble();
    const save = vi.fn();
    openAppearanceDialog(ui as unknown as UI, "standard", save);
    choose(box()!, "skyline");
    press(box()!, "cancel");
    expect(save).not.toHaveBeenCalled();
    expect(ui.closeModal).toHaveBeenCalledTimes(1);
  });
});
