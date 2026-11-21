import { describe, expect, it, vi } from "vitest";
import {
  IDLE_LIMIT_MS,
  MANUAL_COMMAND_TYPE,
  boundIdle,
  MANUAL_PAGE_TYPE,
  embeddedClick,
  gameOriginFor,
  pageMessage,
  readManualCommand,
  readPageMessage,
} from "./manualEmbed";

describe("gameOriginFor", () => {
  it("posts to the production game from the manual's own host, else to the page's own origin", () => {
    expect(gameOriginFor("help.verticopolis.com", "https://help.verticopolis.com")).toBe("https://verticopolis.com");
    expect(gameOriginFor("staging.verticopolis.com", "https://staging.verticopolis.com")).toBe(
      "https://staging.verticopolis.com",
    );
  });
});

describe("pageMessage", () => {
  it("names the page under the base with its query and hash, and drops the site's suffix from the title", () => {
    const at = (pathname: string, search = "", hash = "") => ({ pathname, search, hash });
    expect(
      pageMessage(at("/help/rooms/hotels/", "?q=1", "#rent"), "/help", "Hotels | Verticopolis™ Help", "dark"),
    ).toEqual({ type: MANUAL_PAGE_TYPE, path: "/rooms/hotels/?q=1#rent", title: "Hotels", look: "dark" });
    expect(pageMessage(at("/rooms/"), "", "Rooms | Verticopolis Help", "auto").title).toBe("Rooms");
    expect(pageMessage(at("/"), "", "", "auto").title).toBe("Player's Manual");
  });
});

describe("readPageMessage", () => {
  it("reads a page message and refuses anything else", () => {
    expect(readPageMessage({ type: MANUAL_PAGE_TYPE, path: "/rooms/", title: "Rooms", look: "light" })).toEqual({
      type: MANUAL_PAGE_TYPE,
      path: "/rooms/",
      title: "Rooms",
      look: "light",
    });
    for (const bad of [
      null,
      "text",
      { type: "other", path: "/", title: "" },
      { type: MANUAL_PAGE_TYPE, path: 3, title: "" },
      { type: MANUAL_PAGE_TYPE, path: "https://elsewhere.example/", title: "" },
      { type: MANUAL_PAGE_TYPE, path: "//elsewhere.example/", title: "" },
    ])
      expect(readPageMessage(bad)).toBeNull();
  });

  it("reads a missing or unknown look as the device's own", () => {
    expect(readPageMessage({ type: MANUAL_PAGE_TYPE, path: "/", title: "" })!.look).toBe("auto");
    expect(readPageMessage({ type: MANUAL_PAGE_TYPE, path: "/", title: "", look: "sepia" })!.look).toBe("auto");
  });

  it("keeps a long title short", () => {
    expect(readPageMessage({ type: MANUAL_PAGE_TYPE, path: "/", title: "x".repeat(500) })!.title).toHaveLength(200);
  });
});

describe("boundIdle", () => {
  it("gives idle callbacks a deadline unless they name their own", () => {
    const idle = vi.fn(() => 7);
    const win = { requestIdleCallback: idle as unknown as Window["requestIdleCallback"] };
    boundIdle(win, IDLE_LIMIT_MS);
    const cb = () => {};
    expect(win.requestIdleCallback(cb)).toBe(7);
    expect(idle).toHaveBeenLastCalledWith(cb, { timeout: IDLE_LIMIT_MS });
    win.requestIdleCallback(cb, { timeout: 50 });
    expect(idle).toHaveBeenLastCalledWith(cb, { timeout: 50 });
  });

  it("leaves a browser without idle callbacks alone", () => {
    const win = {} as Pick<Window, "requestIdleCallback">;
    boundIdle(win, IDLE_LIMIT_MS);
    expect(win.requestIdleCallback).toBeUndefined();
  });
});

describe("readManualCommand", () => {
  it("reads print, find and a known look, and refuses anything else", () => {
    const command = (rest: object) => ({ type: MANUAL_COMMAND_TYPE, ...rest });
    expect(readManualCommand(command({ command: "print" }))).toEqual(command({ command: "print" }));
    expect(readManualCommand(command({ command: "find" }))).toEqual(command({ command: "find" }));
    expect(readManualCommand(command({ command: "look", look: "dark" }))).toEqual(
      command({ command: "look", look: "dark" }),
    );
    for (const bad of [
      null,
      "print",
      { type: MANUAL_PAGE_TYPE, command: "print" },
      command({ command: "eval" }),
      command({ command: "look", look: "sepia" }),
      command({ command: "look" }),
    ])
      expect(readManualCommand(bad)).toBeNull();
  });
});

describe("embeddedClick", () => {
  const HERE = "https://help.example/help/rooms/";
  const click = { button: 0, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, defaultPrevented: false };
  const link = (href: string, target = "", download = false) => ({
    href,
    target,
    hasAttribute: (name: string) => name === "download" && download,
  });

  it("replaces the page on a plain click on a link to another manual page", () => {
    expect(embeddedClick(click, link("https://help.example/help/rooms/hotels/"), HERE, "/help")).toEqual({
      replace: "https://help.example/help/rooms/hotels/",
    });
    expect(embeddedClick(click, link("https://help.example/help/rooms/?q=hotel"), HERE, "/help")).toEqual({
      replace: "https://help.example/help/rooms/?q=hotel",
    });
    expect(embeddedClick(click, link("https://help.example/help/rooms/#offices"), HERE, "/help")).toEqual({
      replace: "https://help.example/help/rooms/#offices",
    });
  });

  it("opens a plain click on a link out of the manual in a browser tab", () => {
    expect(embeddedClick(click, link("https://github.com/x"), HERE, "/help")).toEqual({ open: "https://github.com/x" });
    expect(embeddedClick(click, link("https://help.example/"), HERE, "/help")).toEqual({
      open: "https://help.example/",
    });
  });

  it("leaves other clicks and links to the browser", () => {
    const manualPage = link("https://help.example/help/rooms/hotels/");
    expect(embeddedClick({ ...click, button: 1 }, manualPage, HERE, "/help")).toBeNull();
    expect(embeddedClick({ ...click, ctrlKey: true }, manualPage, HERE, "/help")).toBeNull();
    expect(embeddedClick({ ...click, defaultPrevented: true }, manualPage, HERE, "/help")).toBeNull();
    expect(embeddedClick(click, null, HERE, "/help")).toBeNull();
    expect(embeddedClick(click, link("https://help.example/help/rooms/hotels/", "_blank"), HERE, "/help")).toBeNull();
    expect(embeddedClick(click, link("https://help.example/help/catalog.json", "", true), HERE, "/help")).toBeNull();
    expect(embeddedClick(click, link("mailto:someone@example.com"), HERE, "/help")).toBeNull();
  });
});
