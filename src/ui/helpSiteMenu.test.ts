import { describe, it, expect, vi } from "vitest";
import { html } from "lit-html";
import { mountPage } from "./testing/litTestUtils";
import { BACK_TO_GAME_LABEL, PLAY_LABEL, wireHelpMenu, type HelpMenuDeps } from "./helpSiteMenu";

/** The host MenuBar.astro gives the bar. */
function mountBar(): HTMLElement {
  mountPage(html`<div id="host"></div>`);
  return document.getElementById("host")!;
}

function stubDeps(over: Partial<HelpMenuDeps> = {}): HelpMenuDeps {
  return {
    links: {
      game: "/",
      whatsNew: "/help/changelog/",
      report: "https://example.test/issues",
      sponsor: "https://example.test/sponsor",
    },
    fromGame: false,
    backToGame: vi.fn(),
    print: vi.fn(),
    openSearch: vi.fn(),
    copyLink: vi.fn(() => Promise.resolve()),
    pageUrl: () => "https://verticopolis.com/help/rooms/hotels/",
    theme: vi.fn(() => "auto" as const),
    setTheme: vi.fn(),
    track: vi.fn(),
    ...over,
  };
}

const pick = (code: string) => document.querySelector<HTMLElement>(`[data-help-item="${code}"]`)!.click();

describe("the help site's menu bar", () => {
  it("draws the manual's bar, each item carrying the code its pick reports", () => {
    wireHelpMenu(mountBar(), stubDeps());
    const bar = document.getElementById("help-menubar")!;
    expect(bar.getAttribute("aria-label")).toBe("Help menu");
    expect([...bar.querySelectorAll(".mb-title")].map((t) => t.textContent)).toEqual([
      "File",
      "Edit",
      "Options",
      "Help",
    ]);
    const codes = [...bar.querySelectorAll<HTMLElement>(".mb-item")].map((i) => i.dataset.helpItem);
    expect(codes).toEqual([
      "game",
      "print",
      "find",
      "copy_link",
      "theme_light",
      "theme_dark",
      "theme_auto",
      "whats_new",
      "report",
      "sponsor",
    ]);
    const report = bar.querySelector<HTMLAnchorElement>('[data-help-item="report"]')!;
    expect(report.getAttribute("href")).toBe("https://example.test/issues");
    expect(report.target).toBe("_blank");
    expect(bar.querySelector('[data-help-item="whats_new"]')!.getAttribute("href")).toBe("/help/changelog/");
  });

  it("offers to start the game in a plain visit, and lets its link load it", () => {
    const root = mountBar();
    const deps = stubDeps();
    wireHelpMenu(root, deps);
    const game = document.querySelector<HTMLAnchorElement>('[data-help-item="game"]')!;
    expect(game.textContent).toBe(PLAY_LABEL);
    const e = new MouseEvent("click", { bubbles: true, cancelable: true });
    game.dispatchEvent(e);
    expect(deps.backToGame).not.toHaveBeenCalled();
    expect(deps.track).toHaveBeenCalledWith("game");
  });

  it("goes back to the game that opened the tab", () => {
    const root = mountBar();
    const deps = stubDeps({ fromGame: true });
    wireHelpMenu(root, deps);
    expect(document.querySelector('[data-help-item="game"]')!.textContent).toBe(BACK_TO_GAME_LABEL);
    pick("game");
    expect(deps.backToGame).toHaveBeenCalledTimes(1);
  });

  it("prints, finds and copies this page's link, reporting each pick", async () => {
    const root = mountBar();
    const deps = stubDeps();
    wireHelpMenu(root, deps);
    pick("print");
    pick("find");
    pick("copy_link");
    await Promise.resolve();
    expect(deps.print).toHaveBeenCalledTimes(1);
    expect(deps.openSearch).toHaveBeenCalledTimes(1);
    expect(deps.copyLink).toHaveBeenCalledWith("https://verticopolis.com/help/rooms/hotels/");
    expect(vi.mocked(deps.track).mock.calls.map((c) => c[0])).toEqual(["print", "find", "copy_link"]);
  });

  it("keeps quiet when the clipboard refuses", async () => {
    const root = mountBar();
    const deps = stubDeps({ copyLink: vi.fn(() => Promise.reject(new Error("denied"))) });
    wireHelpMenu(root, deps);
    pick("copy_link");
    await Promise.resolve();
    expect(deps.copyLink).toHaveBeenCalledTimes(1);
  });

  it("checks the current look as Options opens, and switches it on a pick", () => {
    const root = mountBar();
    const deps = stubDeps({ theme: vi.fn(() => "dark" as const) });
    wireHelpMenu(root, deps);
    document.getElementById("hm-options")!.click();
    const checked = (code: string) =>
      document.querySelector(`[data-help-item="${code}"]`)!.getAttribute("aria-checked");
    expect([checked("theme_light"), checked("theme_dark"), checked("theme_auto")]).toEqual(["false", "true", "false"]);
    pick("theme_light");
    expect(deps.setTheme).toHaveBeenCalledWith("light");
    expect(deps.track).toHaveBeenCalledWith("theme_light");
  });

  it("ignores a click on a title, which is not an item", () => {
    const root = mountBar();
    const deps = stubDeps();
    wireHelpMenu(root, deps);
    document.getElementById("hm-file")!.click();
    expect(deps.track).not.toHaveBeenCalled();
  });
});
