// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mountAppDom, makeUI } from "../uiFixture";
import { PAUSED_FOR_HELP } from "../../ui/helpPause";

/**
 * The toolbar's Help menu (src/ui/uiHelpMenu.ts) on the real UI, with the
 * game's callbacks as spies: it pauses the tower while any Help window is
 * open, keeps one pause across the menu's windows, holds it while Help is in
 * another tab, and restores the player's speed once.
 */

const standalone = vi.hoisted(() => ({ isInstalledStandalone: vi.fn(() => false) }));
vi.mock("../../ui/standalone", () => standalone);
vi.mock("../../whatsNewData", () => ({
  WHATS_NEW: [
    { version: "3.2.0", notes: ["A newer note."] },
    { version: "3.1.0", notes: ["An older note."] },
  ],
}));

const dialog = (): HTMLDialogElement => document.getElementById("modal") as HTMLDialogElement;
const inDialog = <T extends Element>(sel: string): T => {
  const el = dialog().querySelector<T>(sel);
  expect(el, `expected ${sel} in the dialog`).not.toBeNull();
  return el!;
};
const live = (): string => document.getElementById("a11y-live")!.textContent ?? "";
/** The open Help dialog's own status line (the page's live region is inert
 *  while a dialog is open). */
const status = (): string => dialog().querySelector("[data-help-status]")?.textContent ?? "";
const pauseButton = (): HTMLElement => document.querySelector<HTMLElement>('#speed button[data-speed="0"]')!;

/** A speed the controller reads back after it sets it, as the game's does. */
function speedAt(start: number) {
  let speed = start;
  const onSpeed = vi.fn((s: number) => {
    speed = s;
  });
  return { onSpeed, getSpeed: () => speed, now: () => speed, playerSets: (s: number) => (speed = s) };
}

/** Click a new-tab link without letting happy-dom navigate. */
function followNewTab(sel: string): void {
  const a = inDialog<HTMLAnchorElement>(sel);
  a.addEventListener("click", (e) => e.preventDefault());
  a.click();
}

/** Leave the game tab and come back to it. */
function leaveAndReturn(): void {
  const focus = vi.spyOn(document, "hasFocus").mockReturnValue(false);
  window.dispatchEvent(new Event("blur"));
  focus.mockReturnValue(true);
  window.dispatchEvent(new Event("focus"));
  focus.mockRestore();
}

function openMenu(start = 2) {
  const speed = speedAt(start);
  const { ui, cb } = makeUI({ getSpeed: speed.getSpeed, onSpeed: speed.onSpeed });
  (document.getElementById("btn-help") as HTMLButtonElement).click();
  return { ui, cb, speed };
}

describe("the Help menu", () => {
  beforeEach(() => {
    mountAppDom();
    standalone.isInstalledStandalone.mockReturnValue(false);
  });
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("opens from Help… with every item, and pauses the tower, saying so inside the dialog", async () => {
    const { speed } = openMenu(2);
    expect(inDialog("h2").textContent).toContain("Help");
    for (const act of ["how-to-play", "whats-new", "release-notes", "gallery", "report", "about"]) inDialog(`[data-act="${act}"]`);
    expect(speed.now()).toBe(0);
    expect(inDialog("[data-help-status]").getAttribute("role")).toBe("status");
    await vi.waitFor(() => expect(status()).toBe(PAUSED_FOR_HELP));
    expect(live()).not.toBe(PAUSED_FOR_HELP);
    expect(pauseButton().getAttribute("aria-label")).toBe(PAUSED_FOR_HELP);
  });

  it("restores the prior speed once on Close, and says so", async () => {
    const { speed } = openMenu(2);
    inDialog<HTMLButtonElement>('[data-act="close"]').click();
    dialog().dispatchEvent(new Event("cancel", { cancelable: true }));
    expect(dialog().open).toBe(false);
    expect(speed.now()).toBe(2);
    expect(speed.onSpeed).toHaveBeenCalledTimes(2);
    await vi.waitFor(() => expect(live()).toBe("Back at medium speed"));
    expect(pauseButton().getAttribute("aria-label")).toBe("Pause");
  });

  it("restores on Esc and on a backdrop click too", () => {
    const esc = openMenu(3);
    dialog().dispatchEvent(new Event("cancel", { cancelable: true }));
    expect(esc.speed.now()).toBe(3);
    document.body.innerHTML = "";
    mountAppDom();
    const backdrop = openMenu(1);
    dialog().dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(backdrop.speed.now()).toBe(1);
  });

  it("leaves an already paused tower paused", () => {
    const { speed } = openMenu(0);
    inDialog<HTMLButtonElement>('[data-act="close"]').click();
    expect(speed.onSpeed).not.toHaveBeenCalled();
    expect(live()).not.toBe(PAUSED_FOR_HELP);
  });

  it("keeps one pause from the menu into About this game, and restores when About closes", () => {
    const { speed } = openMenu(2);
    inDialog<HTMLButtonElement>('[data-act="about"]').click();
    expect(inDialog("h2").textContent).toContain("About this game");
    inDialog(".help-diagnostics");
    expect(document.activeElement).toBe(inDialog('[data-act="close"]'));
    expect(speed.onSpeed).toHaveBeenCalledTimes(1);
    inDialog<HTMLButtonElement>('[data-act="close"]').click();
    expect(speed.now()).toBe(2);
  });

  it("restores the speed before Replay Getting Started runs", () => {
    const { cb, speed } = openMenu(2);
    document.getElementById("splash")?.remove();
    inDialog<HTMLButtonElement>('[data-act="about"]').click();
    vi.mocked(cb.onReplayOnboarding).mockImplementation(() => expect(speed.now()).toBe(2));
    inDialog<HTMLButtonElement>('[data-act="replay-onboard"]').click();
    expect(cb.onReplayOnboarding).toHaveBeenCalledTimes(1);
    expect(dialog().open).toBe(false);
  });

  it("opens What's new from the build's own notes, with the release notes link marked for the game", async () => {
    const { speed } = openMenu(2);
    inDialog<HTMLButtonElement>('[data-act="whats-new"]').click();
    await vi.waitFor(() => expect(inDialog("h2").textContent).toContain("What's new"));
    const text = dialog().textContent!;
    expect(text).toContain("A newer note.");
    expect(text).toContain("An older note.");
    expect(inDialog<HTMLAnchorElement>('a[data-act="release-notes"]').getAttribute("href")).toBe("/help/changelog?from=game#3.2.0");
    expect(speed.onSpeed).toHaveBeenCalledTimes(1);
    inDialog<HTMLButtonElement>('[data-act="close"]').click();
    expect(speed.now()).toBe(2);
  });

  it("opens How to play in a new tab, holds the pause, and resumes once the player is back", async () => {
    const { speed } = openMenu(3);
    expect(inDialog<HTMLAnchorElement>('a[data-act="how-to-play"]').getAttribute("href")).toBe("/help?from=game");
    followNewTab('a[data-act="how-to-play"]');
    expect(dialog().open).toBe(false);
    expect(speed.now()).toBe(0);
    leaveAndReturn();
    expect(speed.now()).toBe(3);
    await vi.waitFor(() => expect(live()).toBe("Back at fast speed"));
  });

  it("keeps a speed the player picked before coming back", () => {
    const { speed } = openMenu(3);
    followNewTab('a[data-act="gallery"]');
    speed.playerSets(1);
    leaveAndReturn();
    expect(speed.now()).toBe(1);
  });

  it("lets go of the pause, and clears the toolbar mark, when the player picks a speed with Help in another tab", async () => {
    const { speed } = openMenu(3);
    pauseButton().classList.add("active"); // the game marks the speed it set
    followNewTab('a[data-act="how-to-play"]');
    (document.querySelector('#speed button[data-speed="1"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(pauseButton().getAttribute("aria-label")).toBe("Pause"));
    speed.playerSets(1);
    leaveAndReturn();
    expect(speed.now()).toBe(1);
  });

  it("keeps Help open, and the speed it owes, on a Ctrl or Cmd click that opens a background tab", () => {
    for (const mod of [{ ctrlKey: true }, { metaKey: true }]) {
      document.body.innerHTML = "";
      mountAppDom();
      const { speed } = openMenu(3);
      const a = inDialog<HTMLAnchorElement>('a[data-act="gallery"]');
      a.addEventListener("click", (e) => e.preventDefault());
      a.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ...mod }));
      expect(dialog().open).toBe(true);
      leaveAndReturn();
      expect(speed.now()).toBe(0);
      inDialog<HTMLButtonElement>('[data-act="close"]').click();
      expect(speed.now()).toBe(3);
    }
  });

  it("opens nothing when the menu closes before What's new has loaded", async () => {
    const { speed } = openMenu(2);
    inDialog<HTMLButtonElement>('[data-act="whats-new"]').click();
    inDialog<HTMLButtonElement>('[data-act="close"]').click();
    expect(speed.now()).toBe(2);
    await import("../../whatsNewData");
    await new Promise((r) => setTimeout(r, 0));
    expect(dialog().open).toBe(false);
    expect(speed.now()).toBe(2);
    expect(speed.onSpeed).toHaveBeenCalledTimes(2);
  });

  it("keeps each Help window's buttons last, under the status line, so the sticky footer covers below them", async () => {
    const lastIsFooter = () => {
      const box = inDialog<HTMLElement>(".modal-box");
      expect(box.lastElementChild?.classList.contains("modal-actions")).toBe(true);
      expect(box.querySelector(":scope > [data-help-status]")).not.toBeNull();
    };
    const { ui } = openMenu(2);
    lastIsFooter();
    inDialog<HTMLButtonElement>('[data-act="about"]').click();
    lastIsFooter();
    inDialog<HTMLButtonElement>('[data-act="close"]').click();
    ui.showHelpMenu();
    inDialog<HTMLButtonElement>('[data-act="whats-new"]').click();
    await vi.waitFor(() => expect(inDialog("h2").textContent).toContain("What's new"));
    lastIsFooter();
    inDialog<HTMLButtonElement>('[data-act="close"]').click();
    ui.showHelp();
    lastIsFooter();
    inDialog<HTMLButtonElement>('[data-act="close"]').click();
    ui.showCompare();
    lastIsFooter();
  });

  it("keeps the guide open on a Ctrl click on its full help page link", () => {
    const speed = speedAt(3);
    const { ui } = makeUI({ getSpeed: speed.getSpeed, onSpeed: speed.onSpeed });
    ui.showHelp();
    const a = inDialog<HTMLAnchorElement>('a[data-act="open-help"]');
    a.addEventListener("click", (e) => e.preventDefault());
    a.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true }));
    expect(dialog().open).toBe(true);
    inDialog<HTMLButtonElement>('[data-act="close"]').click();
    expect(speed.now()).toBe(3);
  });

  it("marks the page links as opened by the game", () => {
    openMenu();
    expect(inDialog('a[data-act="release-notes"]').getAttribute("href")).toBe("/help/changelog?from=game");
    expect(inDialog('a[data-act="gallery"]').getAttribute("href")).toBe("/gallery?from=game");
    expect(inDialog('a[data-act="report"]').getAttribute("href")).toContain("github.com/maniator/verticopolis/issues/new/choose");
  });

  it("ends the pause when another dialog takes the screen", () => {
    const { ui, speed } = openMenu(2);
    ui.showImportReport(
      { towerName: "GRAND", star: 3, money: 1, day: 1, floors: 1, basements: 0, unitsImported: 1, broughtOver: [], couldNotBring: [] },
      { onOpen: vi.fn() },
    );
    expect(dialog().textContent).toContain("GRAND");
    expect(speed.now()).toBe(2);
  });
});

describe("the Help menu in the installed app", () => {
  beforeEach(() => {
    mountAppDom();
    standalone.isInstalledStandalone.mockReturnValue(true);
  });
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("opens the in-game guide for How to play and leaves out the page-only items", () => {
    const { speed } = openMenu(2);
    expect(dialog().querySelector('[data-act="release-notes"]')).toBeNull();
    expect(dialog().querySelector('[data-act="gallery"]')).toBeNull();
    inDialog<HTMLButtonElement>('button[data-act="how-to-play"]').click();
    expect(inDialog("h2").textContent).toContain("How to play");
    expect(speed.onSpeed).toHaveBeenCalledTimes(1);
    inDialog<HTMLButtonElement>('[data-act="close"]').click();
    expect(speed.now()).toBe(2);
  });

  it("shows What's new without the release notes link", async () => {
    openMenu();
    inDialog<HTMLButtonElement>('[data-act="whats-new"]').click();
    await vi.waitFor(() => expect(inDialog("h2").textContent).toContain("What's new"));
    expect(dialog().querySelector('a[data-act="release-notes"]')).toBeNull();
  });
});
