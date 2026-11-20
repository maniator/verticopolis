import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { viewTemplate } from "../testing/litTestUtils";
import type { ModalView } from "@verticopolis/components/windows/uiModal";
import { render } from "lit-html";
import type { UI } from "../UI";
import { ctxDouble } from "./saverTestKit.fixture";
import { openScreenSaverDialog, type SaverDialogPorts } from "./saverDialog";
import type { SaverPrefs } from "./saverPrefs";

/** The UI's two modal primitives as spies: opening renders the template into
 *  a box on the page, as `UI.openModal` does; closing removes it. */
function uiDouble() {
  let box: HTMLElement | null = null;
  const ui = {
    openModal: vi.fn((t: ModalView) => {
      box?.remove();
      box = document.createElement("div");
      box.className = "test-modal";
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

function portsDouble(): SaverDialogPorts & { [K in keyof SaverDialogPorts]: ReturnType<typeof vi.fn> } {
  return {
    makeScene: vi.fn(() => ({ step: vi.fn(), draw: vi.fn() })),
    still: vi.fn(() => true),
    save: vi.fn(),
    preview: vi.fn(),
  } as never;
}

const start: SaverPrefs = { saver: "night", waitMinutes: 5, onReturn: true };

function pick(box: HTMLElement, selector: string, value: string) {
  const s = box.querySelector<HTMLSelectElement>(selector)!;
  s.value = value;
  s.dispatchEvent(new Event("change"));
}

describe("the Screen Saver dialog", () => {
  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      ctxDouble() as unknown as CanvasRenderingContext2D,
    );
  });
  afterEach(() => {
    document.querySelectorAll(".test-modal").forEach((e) => e.remove());
    vi.restoreAllMocks();
  });

  it("shows the current choices and plays the picked saver on the little monitor", () => {
    const { ui, box } = uiDouble();
    const ports = portsDouble();
    openScreenSaverDialog(ui as unknown as UI, start, ports);
    const b = box()!;
    expect(b.querySelector<HTMLSelectElement>("#saver-pick")!.value).toBe("night");
    expect(b.querySelector<HTMLSelectElement>("#saver-wait")!.value).toBe("5");
    expect(b.querySelector<HTMLInputElement>("#saver-return")!.checked).toBe(true);
    expect(ports.makeScene).toHaveBeenCalledWith("night", 88, 66);
    expect(ui.openModal).toHaveBeenCalledWith(expect.anything(), { displaceable: true });
  });

  it("keeps the choices on OK", () => {
    const { ui, box } = uiDouble();
    const ports = portsDouble();
    openScreenSaverDialog(ui as unknown as UI, start, ports);
    pick(box()!, "#saver-pick", "marquee");
    expect(ports.makeScene).toHaveBeenLastCalledWith("marquee", 88, 66);
    pick(box()!, "#saver-wait", "15");
    const check = box()!.querySelector<HTMLInputElement>("#saver-return")!;
    check.checked = false;
    check.dispatchEvent(new Event("change"));
    box()!.querySelector<HTMLButtonElement>('[data-saver="ok"]')!.click();
    expect(ports.save).toHaveBeenCalledWith({ saver: "marquee", waitMinutes: 15, onReturn: false });
    expect(ui.closeModal).toHaveBeenCalled();
  });

  it("drops the choices on Cancel", () => {
    const { ui, box } = uiDouble();
    const ports = portsDouble();
    openScreenSaverDialog(ui as unknown as UI, start, ports);
    pick(box()!, "#saver-pick", "stars");
    box()!.querySelector<HTMLButtonElement>('[data-saver="cancel"]')!.click();
    expect(ports.save).not.toHaveBeenCalled();
    expect(ui.closeModal).toHaveBeenCalled();
  });

  it("grays Preview, Wait and the box with no saver picked, and blacks the monitor", () => {
    const { ui, box } = uiDouble();
    const ports = portsDouble();
    openScreenSaverDialog(ui as unknown as UI, start, ports);
    ports.makeScene.mockClear();
    pick(box()!, "#saver-pick", "none");
    const b = box()!;
    expect(b.querySelector<HTMLButtonElement>('[data-saver="preview"]')!.disabled).toBe(true);
    expect(b.querySelector<HTMLSelectElement>("#saver-wait")!.disabled).toBe(true);
    expect(b.querySelector<HTMLInputElement>("#saver-return")!.disabled).toBe(true);
    expect(ports.makeScene).not.toHaveBeenCalled();
  });

  it("previews full screen, then comes back with the unsaved choices", () => {
    const { ui, box } = uiDouble();
    const ports = portsDouble();
    openScreenSaverDialog(ui as unknown as UI, start, ports);
    pick(box()!, "#saver-pick", "express");
    box()!.querySelector<HTMLButtonElement>('[data-saver="preview"]')!.click();
    expect(ui.closeModal).toHaveBeenCalled();
    expect(box()).toBeNull();
    expect(ports.preview).toHaveBeenCalledWith("express", expect.any(Function));
    const back = ports.preview.mock.calls[0][1] as () => void;
    back();
    expect(box()!.querySelector<HTMLSelectElement>("#saver-pick")!.value).toBe("express");
    expect(ports.save).not.toHaveBeenCalled();
  });
});
