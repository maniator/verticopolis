// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mountAppDom, makeUI } from "../uiFixture";
import { PAUSED_FOR_HELP } from "../../ui/helpPause";

/**
 * In-game Help (src/ui/uiHelpMenu.ts) on the real UI, with the game's
 * callbacks as spies: About… opens About this game straight away, the tower
 * pauses while it is open, the pause holds while a Help site page is in
 * another tab, and the player's speed comes back once.
 */

const standalone = vi.hoisted(() => ({ isInstalledStandalone: vi.fn(() => false) }));
vi.mock("../../ui/standalone", () => standalone);

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

function openAbout(start = 2) {
  const speed = speedAt(start);
  const { ui, cb } = makeUI({ getSpeed: speed.getSpeed, onSpeed: speed.onSpeed });
  (document.getElementById("btn-about") as HTMLButtonElement).click();
  return { ui, cb, speed };
}

describe("About… (About this game)", () => {
  beforeEach(() => {
    mountAppDom();
    standalone.isInstalledStandalone.mockReturnValue(false);
  });
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("opens About this game straight from About…, and pauses the tower, saying so inside the dialog", async () => {
    const { speed } = openAbout(2);
    expect(inDialog("h2").textContent).toContain("About this game");
    inDialog(".help-diagnostics");
    inDialog('a[data-act="privacy"]');
    inDialog('a[data-act="report"]');
    inDialog('[data-act="replay-onboard"]');
    // What's new and the release notes live on the Help site now (its sidebar,
    // under More), so there is no menu in between. Report a problem is a line
    // in About itself, because only the game can fill in its bug form.
    for (const act of ["whats-new", "release-notes", "about"]) {
      expect(dialog().querySelector(`[data-act="${act}"]`), `no ${act} row`).toBeNull();
    }
    expect(speed.now()).toBe(0);
    expect(inDialog("[data-help-status]").getAttribute("role")).toBe("status");
    await vi.waitFor(() => expect(status()).toBe(PAUSED_FOR_HELP));
    expect(live()).not.toBe(PAUSED_FOR_HELP);
    expect(pauseButton().getAttribute("aria-label")).toBe(PAUSED_FOR_HELP);
  });

  it("restores the prior speed once on Close, and says so", async () => {
    const { speed } = openAbout(2);
    inDialog<HTMLButtonElement>('[data-act="close"]').click();
    dialog().dispatchEvent(new Event("cancel", { cancelable: true }));
    expect(dialog().open).toBe(false);
    expect(speed.now()).toBe(2);
    expect(speed.onSpeed).toHaveBeenCalledTimes(2);
    await vi.waitFor(() => expect(live()).toBe("Back at medium speed"));
    expect(pauseButton().getAttribute("aria-label")).toBe("Pause");
  });

  it("restores on Esc and on a backdrop click too", () => {
    const esc = openAbout(3);
    dialog().dispatchEvent(new Event("cancel", { cancelable: true }));
    expect(esc.speed.now()).toBe(3);
    document.body.innerHTML = "";
    mountAppDom();
    const backdrop = openAbout(1);
    dialog().dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(backdrop.speed.now()).toBe(1);
  });

  it("leaves an already paused tower paused", () => {
    const { speed } = openAbout(0);
    inDialog<HTMLButtonElement>('[data-act="close"]').click();
    expect(speed.onSpeed).not.toHaveBeenCalled();
    expect(live()).not.toBe(PAUSED_FOR_HELP);
  });

  it("restores the speed before Replay Getting Started runs", () => {
    const { cb, speed } = openAbout(2);
    document.getElementById("splash")?.remove();
    // About… opened before the splash went, so open it again off the splash.
    inDialog<HTMLButtonElement>('[data-act="close"]').click();
    (document.getElementById("btn-about") as HTMLButtonElement).click();
    vi.mocked(cb.onReplayOnboarding).mockImplementation(() => expect(speed.now()).toBe(2));
    inDialog<HTMLButtonElement>('[data-act="replay-onboard"]').click();
    expect(cb.onReplayOnboarding).toHaveBeenCalledTimes(1);
    expect(dialog().open).toBe(false);
  });

  it("opens the privacy page in a new tab, holds the pause, and resumes once the player is back", async () => {
    const { speed } = openAbout(3);
    followNewTab('a[data-act="privacy"]');
    expect(dialog().open).toBe(false);
    expect(speed.now()).toBe(0);
    leaveAndReturn();
    expect(speed.now()).toBe(3);
    await vi.waitFor(() => expect(live()).toBe("Back at fast speed"));
  });

  it("keeps a speed the player picked before coming back", () => {
    const { speed } = openAbout(3);
    followNewTab('a[data-act="privacy"]');
    speed.playerSets(1);
    leaveAndReturn();
    expect(speed.now()).toBe(1);
  });

  it("lets go of the pause, and clears the toolbar mark, when the player picks a speed with Help in another tab", async () => {
    const { speed } = openAbout(3);
    pauseButton().classList.add("active"); // the game marks the speed it set
    followNewTab('a[data-act="privacy"]');
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
      const { speed } = openAbout(3);
      const a = inDialog<HTMLAnchorElement>('a[data-act="privacy"]');
      a.addEventListener("click", (e) => e.preventDefault());
      a.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ...mod }));
      expect(dialog().open).toBe(true);
      leaveAndReturn();
      expect(speed.now()).toBe(0);
      inDialog<HTMLButtonElement>('[data-act="close"]').click();
      expect(speed.now()).toBe(3);
    }
  });

  it("says the privacy page needs a connection when offline, and keeps About open with the tower paused", () => {
    const { speed } = openAbout(3);
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const a = inDialog<HTMLAnchorElement>('a[data-act="privacy"]');
    let followed = true;
    a.addEventListener("click", (e) => {
      followed = !e.defaultPrevented;
      e.preventDefault();
    });
    a.click();
    expect(followed, "the link must not open a tab that cannot load").toBe(false);
    expect(dialog().open).toBe(true);
    expect(inDialog(".help-privacy-status").textContent).toBe(
      "The privacy page needs an internet connection. It is at verticopolis.com/help/privacy.",
    );
    expect(speed.now()).toBe(0);
    inDialog<HTMLButtonElement>('[data-act="close"]').click();
    expect(speed.now()).toBe(3);
  });

  it("keeps each Help window's buttons last, under the status line, so the sticky footer covers below them", () => {
    const lastIsFooter = () => {
      const box = inDialog<HTMLElement>(".modal-box");
      expect(box.lastElementChild?.classList.contains("modal-actions")).toBe(true);
      expect(box.querySelector(":scope > [data-help-status]")).not.toBeNull();
    };
    const { ui } = openAbout(2);
    lastIsFooter();
    inDialog<HTMLButtonElement>('[data-act="close"]').click();
    ui.showCompare();
    lastIsFooter();
  });

  it("opens the manual from the Help button in a new tab, holding the pause until the player is back", () => {
    const speed = speedAt(3);
    makeUI({ getSpeed: speed.getSpeed, onSpeed: speed.onSpeed });
    const open = vi.spyOn(window, "open").mockReturnValue({} as Window);
    (document.getElementById("btn-help") as HTMLButtonElement).click();
    expect(open).toHaveBeenCalledWith("/help/?from=game", "_blank");
    expect(dialog().open).toBe(false);
    expect(speed.now()).toBe(0);
    leaveAndReturn();
    expect(speed.now()).toBe(3);
  });

  it("opens the manual from the title screen in a new tab, holding the pause until the player is back", () => {
    const speed = speedAt(3);
    const { ui } = makeUI({ getSpeed: speed.getSpeed, onSpeed: speed.onSpeed });
    const open = vi.spyOn(window, "open").mockReturnValue({} as Window);
    ui.showHelp();
    expect(open).toHaveBeenCalledWith("/help/?from=game", "_blank");
    expect(dialog().open).toBe(false);
    expect(speed.now()).toBe(0);
    leaveAndReturn();
    expect(speed.now()).toBe(3);
  });

  it("says the manual needs a connection when offline, opens no tab, and keeps the tower running", () => {
    const speed = speedAt(3);
    const { ui } = makeUI({ getSpeed: speed.getSpeed, onSpeed: speed.onSpeed });
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const open = vi.spyOn(window, "open");
    const say = vi.spyOn(ui, "sayVisibly");
    ui.showHelp();
    expect(open).not.toHaveBeenCalled();
    expect(say).toHaveBeenCalledWith("The manual needs an internet connection. It is at verticopolis.com/help.");
    expect(speed.now()).toBe(3);
  });

  it("says where the guide is when the browser blocks the new tab, and keeps the tower running", () => {
    const speed = speedAt(3);
    const { ui } = makeUI({ getSpeed: speed.getSpeed, onSpeed: speed.onSpeed });
    vi.spyOn(window, "open").mockReturnValue(null);
    const say = vi.spyOn(ui, "sayVisibly");
    ui.showHelp();
    expect(say).toHaveBeenCalledWith("The guide could not open. It is at verticopolis.com/help.");
    expect(speed.now()).toBe(3);
  });

  it("prefills GitHub's bug form from what About shows, with the tower's mode", () => {
    const { cb } = openAbout();
    const a = inDialog<HTMLAnchorElement>('a[data-act="report"]');
    expect(a.target).toBe("_blank");
    expect(a.rel).toContain("noopener");
    const url = new URL(a.href);
    expect(url.origin + url.pathname).toBe("https://github.com/maniator/verticopolis/issues/new");
    expect(url.searchParams.get("template")).toBe("bug_report.yml");
    expect(url.searchParams.get("version")).toMatch(/^v/);
    // The same text Copy diagnostics gives, from the block About shows.
    expect(url.searchParams.get("diagnostics")).toContain(inDialog(".help-diagnostics-summary").textContent!);
    expect(cb.getMode).toHaveBeenCalled();
    expect(url.searchParams.get("mode")).toBe("Classic");
    expect(url.searchParams.get("platform")).toMatch(/^(Desktop|Mobile \/ tablet)$/);
  });

  it("says Not sure for the mode on the title screen, where no tower is open", () => {
    const splash = document.createElement("div");
    splash.id = "splash";
    document.body.appendChild(splash);
    const { cb } = openAbout();
    expect(new URL(inDialog<HTMLAnchorElement>('a[data-act="report"]').href).searchParams.get("mode")).toBe("Not sure");
    expect(cb.getMode).not.toHaveBeenCalled();
    splash.remove();
  });

  it("opens the bug form in a new tab, holds the pause, and resumes once the player is back", () => {
    const { speed } = openAbout(3);
    followNewTab('a[data-act="report"]');
    expect(dialog().open).toBe(false);
    expect(speed.now()).toBe(0);
    leaveAndReturn();
    expect(speed.now()).toBe(3);
  });

  it("says reporting needs a connection when offline, and keeps About open", () => {
    openAbout(3);
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const a = inDialog<HTMLAnchorElement>('a[data-act="report"]');
    let followed = true;
    a.addEventListener("click", (e) => {
      followed = !e.defaultPrevented;
      e.preventDefault();
    });
    a.click();
    expect(followed).toBe(false);
    expect(dialog().open).toBe(true);
    expect(inDialog(".help-privacy-status").textContent).toBe(
      "Reporting a problem needs an internet connection. Copy diagnostics now and report it once you are back online.",
    );
  });

  it("marks the privacy link as opened by the game", () => {
    openAbout();
    expect(inDialog('a[data-act="privacy"]').getAttribute("href")).toBe("/help/privacy/?from=game");
  });

  it("ends the pause when another dialog takes the screen", () => {
    const { ui, speed } = openAbout(2);
    ui.showImportReport(
      { towerName: "GRAND", star: 3, money: 1, day: 1, floors: 1, basements: 0, unitsImported: 1, broughtOver: [], couldNotBring: [] },
      { onOpen: vi.fn() },
    );
    expect(dialog().textContent).toContain("GRAND");
    expect(speed.now()).toBe(2);
  });
});

describe("About… in the installed app", () => {
  beforeEach(() => {
    mountAppDom();
    standalone.isInstalledStandalone.mockReturnValue(true);
  });
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("opens the same About this game, privacy link included (the browser opens the Help site)", () => {
    openAbout(2);
    expect(inDialog("h2").textContent).toContain("About this game");
    expect(inDialog('a[data-act="privacy"]').getAttribute("href")).toBe("/help/privacy/?from=game");
  });
});
