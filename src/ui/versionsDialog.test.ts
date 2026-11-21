import { render } from "lit-html";
import type { ModalView } from "@verticopolis/components/windows/uiModal";
import { describe, expect, it, vi } from "vitest";
import type { TowerVersion } from "../storage/fileVersions";
import { viewTemplate } from "./testing/litTestUtils";
import { showVersionsDialog, versionWhen } from "./versionsDialog";

const NOW = new Date(2026, 10, 17, 18, 0).getTime();
const at = (day: number, hour: number) => new Date(2026, 10, day, hour, 4).getTime();

/** A modal host the dialog draws into, as the UI's is: a box in the one
 *  shared `<dialog>`. */
function makeUi() {
  const box = document.createElement("div");
  const dialog = document.createElement("dialog");
  const ui = {
    openModal: vi.fn((view: ModalView) => {
      document.body.replaceChildren(dialog);
      dialog.replaceChildren(box);
      render(viewTemplate(view), box);
      return box;
    }),
    renderModal: vi.fn((view: ModalView) => render(viewTemplate(view), box)),
    closeModal: vi.fn(() => box.remove()),
  };
  return { ui, box, dialog };
}

const V: TowerVersion[] = [
  { key: "v:F:m2", at: at(17, 15), size: 2048, manual: true },
  { key: "v:F:1", at: at(16, 9), size: 1024 },
];

describe("the Previous Versions window", () => {
  it("says when each version was written, the way Windows lists it", () => {
    expect(versionWhen(at(17, 15), NOW)).toMatch(/^Today, /);
    expect(versionWhen(at(16, 9), NOW)).toMatch(/^Yesterday, /);
    expect(versionWhen(at(3, 9), NOW)).toMatch(/^Nov 3, /);
  });

  it("lists the versions, saved by hand or autosaved, with the newest picked", () => {
    const { ui, box } = makeUi();
    showVersionsDialog(ui, { name: "Sky", versions: V, open: vi.fn() });
    const rows = [...box.querySelectorAll(".pv-row")];
    expect(rows.map((r) => r.querySelector(".pv-how")!.textContent)).toEqual(["Saved by you", "Autosaved"]);
    expect(rows[0].getAttribute("aria-selected")).toBe("true");
  });

  it("opens the picked version, and shows why when it couldn't", async () => {
    const { ui, box } = makeUi();
    const open = vi.fn(async () => ({ text: "That version is gone.", kind: "bad" as const }));
    showVersionsDialog(ui, { name: "Sky", versions: V, open });
    box.querySelectorAll<HTMLElement>(".pv-row")[1].click();
    box.querySelector<HTMLButtonElement>(".pv-buttons .primary")!.click();
    await vi.waitFor(() => expect(box.querySelector(".fd-line")?.textContent).toBe("That version is gone."));
    expect(open).toHaveBeenCalledExactlyOnceWith(V[1]);
  });

  it("with no versions, says when the game makes them and offers nothing to open", () => {
    const { ui, box } = makeUi();
    showVersionsDialog(ui, { name: "Sky", versions: [], open: vi.fn() });
    expect(box.querySelector(".fd-empty")!.textContent).toMatch(/every 10 minutes/);
    expect(box.querySelector<HTMLButtonElement>(".pv-buttons .primary")!.disabled).toBe(true);
    box.querySelector<HTMLButtonElement>(".pv-buttons .btn:not(.primary)")!.click();
    expect(ui.closeModal).toHaveBeenCalledOnce();
  });

  describe("closing it without opening a version goes back to the window it came from", () => {
    const cancel = (dialog: HTMLDialogElement, cancelable = true) => {
      const e = new Event("cancel", { cancelable });
      dialog.dispatchEvent(e);
      return e;
    };
    const ways: [string, (box: HTMLElement, dialog: HTMLDialogElement) => void][] = [
      ["Cancel", (box) => box.querySelector<HTMLButtonElement>(".pv-buttons .btn:not(.primary)")!.click()],
      [
        "Esc or the ✕",
        (_box, dialog) =>
          expect(cancel(dialog).defaultPrevented, "the dialog stays open for the window it goes back to").toBe(true),
      ],
      ["a click beside it", (_box, dialog) => dialog.dispatchEvent(new MouseEvent("click", { bubbles: true }))],
    ];
    for (const [how, close] of ways) {
      it(`by ${how}`, () => {
        const { ui, box, dialog } = makeUi();
        const back = vi.fn();
        showVersionsDialog(ui, { name: "Sky", versions: V, open: vi.fn(), back });
        close(box, dialog);
        expect(back).toHaveBeenCalledOnce();
        expect(ui.closeModal).not.toHaveBeenCalled();
      });
    }

    it("and closes, as before, when nothing opened it", () => {
      const { ui, dialog } = makeUi();
      showVersionsDialog(ui, { name: "Sky", versions: V, open: vi.fn() });
      cancel(dialog);
      expect(ui.closeModal).toHaveBeenCalledOnce();
    });

    it("closes when the browser won't keep the dialog open on that Esc", () => {
      const { ui, dialog } = makeUi();
      const back = vi.fn();
      showVersionsDialog(ui, { name: "Sky", versions: V, open: vi.fn(), back });
      cancel(dialog, false);
      expect(back).not.toHaveBeenCalled();
      expect(ui.closeModal).toHaveBeenCalledOnce();
    });

    it("but not while a version is opening, which closes the window itself", async () => {
      const { ui, box, dialog } = makeUi();
      const back = vi.fn();
      let opened!: (note: null) => void;
      const open = vi.fn(() => new Promise<null>((done) => (opened = done)));
      showVersionsDialog(ui, { name: "Sky", versions: V, open, back });
      box.querySelector<HTMLButtonElement>(".pv-buttons .primary")!.click();
      expect(cancel(dialog).defaultPrevented).toBe(true);
      box.querySelector<HTMLButtonElement>(".pv-buttons .btn:not(.primary)")!.click();
      expect(back).not.toHaveBeenCalled();
      expect(ui.closeModal).not.toHaveBeenCalled();
      opened(null);
      await vi.waitFor(() => expect(open).toHaveBeenCalledOnce());
    });
  });
});
