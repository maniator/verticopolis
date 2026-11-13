import { describe, expect, it, vi } from "vitest";
import type { ImportReport } from "../storage/tdtImportReport";
import { precedenceUi } from "./precedenceUi.fixture";
import { showImportReport } from "./uiDialogs";

/**
 * The import report's `onShown`: it fires once, when the report is actually on
 * screen, and never for a report that waited behind another dialog and was
 * dropped. The `tdt_import_read` event hangs off it (`saveLoad.ts`), so a
 * report the player never saw is never counted as read.
 */

function report(towerName = "GRAND"): ImportReport {
  return {
    towerName,
    star: 3,
    money: 1_500_000,
    day: 3,
    floors: 5,
    basements: 1,
    unitsImported: 9,
    broughtOver: [],
    couldNotBring: [],
  };
}

describe("showImportReport onShown", () => {
  it("fires once when the report opens straight away, after the dialog is up", () => {
    const { ui, spies } = precedenceUi();
    const onShown = vi.fn();
    showImportReport(ui, report(), { onOpen: vi.fn(), onShown });
    expect(onShown).toHaveBeenCalledOnce();
    expect(spies.openModalTemplate).toHaveBeenCalledOnce();
    expect(onShown.mock.invocationCallOrder[0]).toBeGreaterThan(spies.openModalTemplate.mock.invocationCallOrder[0]!);
  });

  it("does not fire while the report waits, and fires once when the dialog in the way closes", () => {
    const { ui, spies, openBlocking } = precedenceUi();
    openBlocking();
    const onShown = vi.fn();
    showImportReport(ui, report(), { onOpen: vi.fn(), onShown });
    expect(onShown, "a waiting report is not on screen").not.toHaveBeenCalled();
    expect(spies.openModalTemplate).toHaveBeenCalledOnce(); // only the blocking dialog
    spies.closeModal();
    expect(onShown).toHaveBeenCalledOnce();
    expect(spies.openModalTemplate).toHaveBeenCalledTimes(2);
    // A second close (the report's own) does not show it again.
    spies.closeModal();
    expect(onShown).toHaveBeenCalledOnce();
  });

  it("never fires for a waiting report a second file supersedes, and fires once for the second", () => {
    const { ui, spies, openBlocking } = precedenceUi();
    openBlocking();
    const first = vi.fn();
    const second = vi.fn();
    showImportReport(ui, report("FIRST"), { onOpen: vi.fn(), onShown: first });
    showImportReport(ui, report("SECOND"), { onOpen: vi.fn(), onShown: second });
    expect(spies.sayVisibly).toHaveBeenLastCalledWith("The import was dropped: another file was picked before it could open. Try again.");
    spies.closeModal();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
  });

  it("never fires for a waiting report dropped by a tower swap", () => {
    const { ui, spies, openBlocking } = precedenceUi();
    openBlocking();
    const onShown = vi.fn();
    showImportReport(ui, report(), { onOpen: vi.fn(), onShown });
    spies.precedence.towerSwapped();
    expect(spies.sayVisibly).toHaveBeenLastCalledWith("The import was dropped: you started a different tower before it could open. Try again.");
    spies.closeModal();
    expect(onShown).not.toHaveBeenCalled();
    expect(spies.openModalTemplate, "the dropped report never opens").toHaveBeenCalledOnce();
  });

  it("never fires for a waiting report dropped when another dialog takes over", () => {
    const { ui, spies, openBlocking } = precedenceUi();
    openBlocking();
    const onShown = vi.fn();
    showImportReport(ui, report(), { onOpen: vi.fn(), onShown });
    openBlocking(); // displaces the dialog the report was waiting on
    spies.closeModal();
    expect(onShown).not.toHaveBeenCalled();
  });

  it("opens without an onShown", () => {
    const { ui, spies } = precedenceUi();
    expect(() => showImportReport(ui, report(), { onOpen: vi.fn() })).not.toThrow();
    expect(spies.openModalTemplate).toHaveBeenCalledOnce();
  });
});
