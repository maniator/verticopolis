import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { GameApp } from "../main";

vi.mock("../analytics", () => ({
  trackAppAction: vi.fn(),
  setCommonProps: vi.fn(),
  getCommonProps: vi.fn(() => ({ version: "x", display: "browser" })),
}));
vi.mock("../ui/appearance/appearanceDialog", () => ({ openAppearanceDialog: vi.fn() }));
vi.mock("../ui/appearance/appearancePrefs", async (original) => ({
  ...(await original<typeof import("../ui/appearance/appearancePrefs")>()),
  shareScheme: vi.fn(),
}));

import { trackAppAction, setCommonProps } from "../analytics";
import { openAppearanceDialog } from "../ui/appearance/appearanceDialog";
import { shareScheme } from "../ui/appearance/appearancePrefs";
import { APPEARANCE_ITEM_ID, applyKeptScheme, freshenHelpLink, wireAppearance } from "./appearanceWiring";
import { html } from "lit-html";
import { drawMenuBar } from "./menuBarHost";
import { drawElement, mountPage } from "../ui/testing/litTestUtils";

/** The dialog's OK, as the mocked dialog hands it to the wiring. */
function okWith(id: string) {
  const save = vi.mocked(openAppearanceDialog).mock.calls[vi.mocked(openAppearanceDialog).mock.calls.length - 1][2];
  save(id as never);
}

describe("the appearance wiring", () => {
  let root: HTMLElement;
  const app = { ui: {} } as unknown as Pick<GameApp, "ui">;

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    root = document.createElement("html");
    mountPage(html`<div id="menubar-host"></div>`);
    drawMenuBar();
  });
  afterEach(() => document.body.replaceChildren());

  const openDialog = () => document.getElementById(APPEARANCE_ITEM_ID)!.click();

  it("applies the kept scheme at startup", () => {
    localStorage.setItem("vc.appearance", "skyline");
    expect(applyKeptScheme(root)).toBe("skyline");
    expect(root.getAttribute("data-scheme")).toBe("skyline");
    // A kept scheme renews the cookie the manual's host reads.
    expect(shareScheme).toHaveBeenCalledWith("skyline");
  });

  it("gives a Standard player no cookie at startup", () => {
    expect(applyKeptScheme(root)).toBe("standard");
    expect(shareScheme).not.toHaveBeenCalled();
  });

  it("opens the dialog from the menu item with the scheme the page wears", () => {
    wireAppearance(app, "skyline", root);
    openDialog();
    expect(openAppearanceDialog).toHaveBeenCalledWith(app.ui, "skyline", expect.any(Function));
  });

  it("on an OK that changes it: dresses the page, keeps it, and reports it", () => {
    wireAppearance(app, "standard", root);
    openDialog();
    okWith("skyline");
    expect(root.getAttribute("data-scheme")).toBe("skyline");
    expect(localStorage.getItem("vc.appearance")).toBe("skyline");
    expect(shareScheme).toHaveBeenCalledWith("skyline");
    expect(setCommonProps).toHaveBeenCalledWith({ version: "x", display: "browser", scheme: "skyline" });
    expect(trackAppAction).toHaveBeenCalledWith("appearance_set", "skyline");
    // The next open starts from the new scheme.
    openDialog();
    expect(vi.mocked(openAppearanceDialog).mock.calls[vi.mocked(openAppearanceDialog).mock.calls.length - 1][1]).toBe(
      "skyline",
    );
  });

  it("sends nothing when OK keeps the same scheme", () => {
    wireAppearance(app, "skyline", root);
    openDialog();
    okWith("skyline");
    expect(trackAppAction).not.toHaveBeenCalled();
    expect(setCommonProps).not.toHaveBeenCalled();
    expect(shareScheme).not.toHaveBeenCalled();
    expect(localStorage.getItem("vc.appearance")).toBeNull();
  });

  it("brings a help link up to date with the worn scheme as it is pressed", () => {
    const url = "https://help.verticopolis.com/rooms/?from=game&via=stats";
    const link = drawElement(html`<a href=${url}><span>Help</span></a>`);
    document.body.append(link);
    document.documentElement.setAttribute("data-scheme", "skyline");
    try {
      freshenHelpLink({ target: link.firstElementChild } as unknown as Event);
      expect(link.getAttribute("href")).toBe("https://help.verticopolis.com/rooms/?from=game&via=stats&scheme=skyline");
    } finally {
      document.documentElement.removeAttribute("data-scheme");
    }
    freshenHelpLink({ target: link } as unknown as Event);
    expect(link.getAttribute("href")).toBe("https://help.verticopolis.com/rooms/?from=game&via=stats");
  });
});
