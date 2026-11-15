import { describe, it, expect, vi } from "vitest";
import { BACK_TO_GAME_LABEL, PLAY_LABEL, wireHelpMenu, type HelpMenuDeps } from "./helpSiteMenu";

/** The help site's bar, as MenuBar.astro renders it (trimmed to the items the tests pick). */
function mountBar(): HTMLElement {
  document.body.innerHTML = `
    <nav id="help-menubar" class="menubar">
      <div class="mb-menu">
        <button type="button" class="mb-title" id="hm-file" aria-expanded="false" aria-controls="hm-file-menu"><u>F</u>ile</button>
        <div class="mb-pop" id="hm-file-menu" role="menu" hidden>
          <a role="menuitem" class="mb-item" href="/" data-help-item="game">Play Verticopolis</a>
          <button type="button" role="menuitem" class="mb-item" data-help-item="print">Print…</button>
        </div>
      </div>
      <div class="mb-menu">
        <button type="button" class="mb-title" id="hm-edit" aria-expanded="false" aria-controls="hm-edit-menu"><u>E</u>dit</button>
        <div class="mb-pop" id="hm-edit-menu" role="menu" hidden>
          <button type="button" role="menuitem" class="mb-item" data-help-item="find">Find…</button>
          <button type="button" role="menuitem" class="mb-item" data-help-item="copy_link">Copy Link to This Page</button>
        </div>
      </div>
      <div class="mb-menu">
        <button type="button" class="mb-title" id="hm-options" aria-expanded="false" aria-controls="hm-options-menu"><u>O</u>ptions</button>
        <div class="mb-pop" id="hm-options-menu" role="menu" hidden>
          <button type="button" role="menuitemradio" class="mb-item" data-help-item="theme_light" aria-checked="false">Light</button>
          <button type="button" role="menuitemradio" class="mb-item" data-help-item="theme_dark" aria-checked="false">Dark</button>
          <button type="button" role="menuitemradio" class="mb-item" data-help-item="theme_auto" aria-checked="false">Match My Device</button>
        </div>
      </div>
    </nav>`;
  return document.getElementById("help-menubar")!;
}

function stubDeps(over: Partial<HelpMenuDeps> = {}): HelpMenuDeps {
  return {
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
    const checked = (code: string) => document.querySelector(`[data-help-item="${code}"]`)!.getAttribute("aria-checked");
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
