import { describe, expect, it, vi } from "vitest";
import type { TowerVersion } from "../storage/fileVersions";
import { showVersionsDialog, versionWhen } from "./versionsDialog";

const NOW = new Date(2026, 10, 17, 18, 0).getTime();
const at = (day: number, hour: number) => new Date(2026, 10, day, hour, 4).getTime();

/** A modal host the dialog draws into, as the UI's is. */
function makeUi() {
  const box = document.createElement("div");
  const ui = {
    openModalTemplate: vi.fn(() => {
      document.body.replaceChildren(box);
      box.innerHTML = '<h2>Previous Versions</h2><div class="pv-host"></div>';
      return box;
    }),
    closeModal: vi.fn(() => box.remove()),
  };
  return { ui, box };
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
});
