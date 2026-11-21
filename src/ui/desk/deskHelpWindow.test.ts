import { afterEach, describe, expect, it, vi } from "vitest";
import { MANUAL_COMMAND_TYPE, MANUAL_PAGE_TYPE } from "../../manual/manualEmbed";
import { MANUAL_TITLE, ManualWindow, deskManual, setDeskManual } from "./deskHelpWindow";

/** A manual window on the page, its frame's window stood in for by a spy. */
function placed() {
  const hooks = { closed: vi.fn(), shown: vi.fn(), menuPicked: vi.fn() };
  const win = new ManualWindow(document, hooks);
  document.body.append(win.frame.root);
  const frameWin = { location: { replace: vi.fn() }, postMessage: vi.fn() };
  Object.defineProperty(win.frame.page, "contentWindow", { value: frameWin, configurable: true });
  return { win, hooks, frameWin };
}

/** A message from `source`, sent from `origin`. */
function message(source: unknown, data: unknown, origin = location.origin): void {
  const event = new MessageEvent("message", { data, origin });
  Object.defineProperty(event, "source", { value: source });
  window.dispatchEvent(event);
}

const page = (path: string, title = "Page", look = "auto") => ({ type: MANUAL_PAGE_TYPE, path, title, look });
const button = (root: HTMLElement, label: string) =>
  [...root.querySelectorAll<HTMLButtonElement>(".desk-help-bar button")].find((b) => b.textContent === label)!;

/** The window menu's item reporting `code`. */
const menuItem = (root: HTMLElement, code: string) =>
  root.querySelector<HTMLElement>(`.desk-help-menu [data-help-item="${code}"]`)!;

afterEach(() => {
  document.body.replaceChildren();
  setDeskManual(null);
});

describe("ManualWindow", () => {
  it("starts closed, and opens on a page marked as opened from the game", () => {
    const { win, hooks } = placed();
    expect(win.isOpen()).toBe(false);
    win.show("/help/rooms/", "help_key");
    expect(win.isOpen()).toBe(true);
    expect(win.frame.page.getAttribute("src")).toMatch(/^\/help\/rooms\/\?from=game&via=help_key/);
    expect(hooks.shown).toHaveBeenCalledTimes(1);
  });

  it("moves an open window's page with replace, so the game's history stays clean", () => {
    const { win, frameWin } = placed();
    win.show("/help/", "game_menu");
    win.show("/help/building/elevators/", "inspector");
    expect(frameWin.location.replace).toHaveBeenCalledWith(
      expect.stringMatching(/^\/help\/building\/elevators\/\?from=game&via=inspector/),
    );
  });

  it("titles the window after the page, and keeps Back and Forward from the pages shown", () => {
    const { win, frameWin } = placed();
    win.show("/help/", "game_menu");
    message(frameWin, page("/", MANUAL_TITLE));
    message(frameWin, page("/rooms/", "Rooms"));
    message(frameWin, page("/rooms/hotels/", "Hotels"));
    expect(win.frame.root.querySelector(".desk-title-text")!.textContent).toBe(`Hotels - ${MANUAL_TITLE}`);
    expect(button(win.frame.root, "Back").disabled).toBe(false);
    expect(button(win.frame.root, "Forward").disabled).toBe(true);

    button(win.frame.root, "Back").click();
    expect(frameWin.location.replace).toHaveBeenLastCalledWith("/help/rooms/");
    message(frameWin, page("/rooms/", "Rooms"));
    expect(button(win.frame.root, "Forward").disabled).toBe(false);
    button(win.frame.root, "Forward").click();
    expect(frameWin.location.replace).toHaveBeenLastCalledWith("/help/rooms/hotels/");

    button(win.frame.root, "Contents").click();
    expect(frameWin.location.replace).toHaveBeenLastCalledWith("/help/");
  });

  it("drops forward pages when a new page is shown after Back", () => {
    const { win, frameWin } = placed();
    win.show("/help/", "game_menu");
    message(frameWin, page("/"));
    message(frameWin, page("/rooms/"));
    button(win.frame.root, "Back").click();
    message(frameWin, page("/"));
    message(frameWin, page("/building/"));
    expect(win.current()).toBe("/building/");
    expect(button(win.frame.root, "Forward").disabled).toBe(true);
  });

  it("hears only its own frame, from the manual's origin, saying a page", () => {
    const { win, frameWin } = placed();
    win.show("/help/", "game_menu");
    message({ other: true }, page("/rooms/"));
    message(frameWin, page("/rooms/"), "https://elsewhere.example");
    message(frameWin, { type: "other", path: "/rooms/", title: "x" });
    expect(win.current()).toBeNull();
  });

  it("opens the page showing in a browser tab", () => {
    const { win, frameWin } = placed();
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    win.show("/help/", "game_menu");
    message(frameWin, page("/rooms/hotels/"));
    button(win.frame.root, "Open in Browser").click();
    expect(open).toHaveBeenCalledWith("/help/rooms/hotels/", "_blank", "noopener");
    open.mockRestore();
  });

  it("closes from its ✕, telling the desk and every waiting listener, and starts fresh next time", () => {
    const { win, hooks, frameWin } = placed();
    const waiting = vi.fn();
    win.show("/help/", "game_menu");
    message(frameWin, page("/rooms/", "Rooms"));
    win.whenClosed(waiting);
    win.frame.root.querySelector<HTMLButtonElement>(".win-title button")!.click();
    expect(win.isOpen()).toBe(false);
    expect(hooks.closed).toHaveBeenCalledTimes(1);
    expect(waiting).toHaveBeenCalledTimes(1);
    expect(frameWin.location.replace).toHaveBeenLastCalledWith("about:blank");
    expect(win.current()).toBeNull();
    expect(win.frame.root.querySelector(".desk-title-text")!.textContent).toBe(MANUAL_TITLE);
  });

  it("ignores what the page it just emptied says after a close", () => {
    const { win, frameWin } = placed();
    win.show("/help/", "game_menu");
    win.close();
    message(frameWin, page("/rooms/", "Rooms"));
    expect(win.current()).toBeNull();
    expect(win.frame.root.querySelector(".desk-title-text")!.textContent).toBe(MANUAL_TITLE);
  });

  it("opens again in place after a close, so the game's history stays clean", () => {
    const { win, frameWin } = placed();
    win.show("/help/", "game_menu");
    win.close();
    win.show("/help/rooms/", "help_key");
    expect(win.isOpen()).toBe(true);
    expect(frameWin.location.replace).toHaveBeenLastCalledWith(
      expect.stringMatching(/^\/help\/rooms\/\?from=game&via=help_key/),
    );
  });

  it("ends the waiting listeners when the desk comes down, without counting a close", () => {
    const { win, hooks } = placed();
    const waiting = vi.fn();
    win.show("/help/", "game_menu");
    win.whenClosed(waiting);
    win.dispose();
    expect(waiting).toHaveBeenCalledTimes(1);
    expect(hooks.closed).not.toHaveBeenCalled();
  });
});

describe("ManualWindow's menu bar", () => {
  it("prints and searches the page in the frame, telling only the manual's origin", () => {
    const { win, hooks, frameWin } = placed();
    const focus = vi.spyOn(win.frame.page, "focus");
    win.show("/help/", "game_menu");
    menuItem(win.frame.root, "print").click();
    expect(frameWin.postMessage).toHaveBeenLastCalledWith(
      { type: MANUAL_COMMAND_TYPE, command: "print" },
      location.origin,
    );
    menuItem(win.frame.root, "find").click();
    expect(focus).toHaveBeenCalled();
    expect(frameWin.postMessage).toHaveBeenLastCalledWith(
      { type: MANUAL_COMMAND_TYPE, command: "find" },
      location.origin,
    );
    expect(hooks.menuPicked.mock.calls).toEqual([["print"], ["find"]]);
  });

  it("checks the look the page wears, and asks the page for the look picked", () => {
    const { win, frameWin } = placed();
    const checked = (code: string) => menuItem(win.frame.root, code).getAttribute("aria-checked");
    win.show("/help/", "game_menu");
    expect(checked("theme_auto")).toBe("true");
    message(frameWin, page("/", "Page", "dark"));
    expect([checked("theme_dark"), checked("theme_auto")]).toEqual(["true", "false"]);
    menuItem(win.frame.root, "theme_light").click();
    expect(frameWin.postMessage).toHaveBeenLastCalledWith(
      { type: MANUAL_COMMAND_TYPE, command: "look", look: "light" },
      location.origin,
    );
    expect(checked("theme_light")).toBe("true");
  });

  it("closes the window from File > Exit, as the player's close", () => {
    const { win, hooks } = placed();
    win.show("/help/", "game_menu");
    menuItem(win.frame.root, "exit").click();
    expect(win.isOpen()).toBe(false);
    expect(hooks.closed).toHaveBeenCalledTimes(1);
    expect(hooks.menuPicked).toHaveBeenCalledWith("exit");
  });

  it("copies the manual's own address for the page showing, and opens What's New in the window", async () => {
    const { win, frameWin } = placed();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    win.show("/help/", "game_menu");
    message(frameWin, page("/rooms/hotels/"));
    menuItem(win.frame.root, "copy_link").click();
    expect(writeText).toHaveBeenCalledWith(`${location.origin}/help/rooms/hotels/`);
    menuItem(win.frame.root, "whats_new").click();
    expect(frameWin.location.replace).toHaveBeenLastCalledWith("/help/changelog/");
  });
});

describe("deskManual", () => {
  it("is the desk's window while the desk is up", () => {
    expect(deskManual()).toBeNull();
    const { win } = placed();
    setDeskManual(win);
    expect(deskManual()).toBe(win);
  });
});
