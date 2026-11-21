import { describe, expect, it, vi } from "vitest";
import type { MenuItemModel } from "@verticopolis/components/windows/menuBar";
import { REPORT_URL, deskHelpMenuModel, type DeskHelpMenuDeps } from "./deskHelpMenu";

const deps = (sponsor: string | null): DeskHelpMenuDeps => ({
  openInBrowser: vi.fn(),
  print: vi.fn(),
  exit: vi.fn(),
  find: vi.fn(),
  copyLink: vi.fn(),
  setLook: vi.fn(),
  whatsNew: vi.fn(),
  sponsor,
  track: vi.fn(),
});

/** The Help menu's items, as label and link. */
const helpItems = (d: DeskHelpMenuDeps) =>
  deskHelpMenuModel(d, "auto")
    .menus.find((m) => m.id === "dhm-help")!
    .items.map((i) =>
      i.kind === "separator" ? "-" : `${(i as MenuItemModel).label} ${(i as MenuItemModel).href ?? ""}`.trim(),
    );

describe("deskHelpMenuModel", () => {
  it("offers Sponsor only where the game offers it, and sends Report a Problem to the issue chooser", () => {
    expect(helpItems(deps("https://sponsor.example"))).toEqual([
      "What's New",
      `Report a Problem… ${REPORT_URL}`,
      "-",
      "Sponsor Verticopolis https://sponsor.example",
    ]);
    expect(helpItems(deps(null))).toEqual(["What's New", `Report a Problem… ${REPORT_URL}`]);
  });

  it("reports a link item's pick by its code", () => {
    const d = deps(null);
    const report = deskHelpMenuModel(d, "auto").menus.find((m) => m.id === "dhm-help")!.items[1] as MenuItemModel;
    report.onPick!(new MouseEvent("click"));
    expect(d.track).toHaveBeenCalledWith("report");
  });
});
