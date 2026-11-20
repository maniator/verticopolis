import { describe, expect, it } from "vitest";
import { MANUAL_PAGE_TYPE, gameOriginFor, pageMessage, readPageMessage, replacedBy } from "./manualEmbed";

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
    expect(pageMessage(at("/help/rooms/hotels/", "?q=1", "#rent"), "/help", "Hotels | Verticopolis™ Help")).toEqual({
      type: MANUAL_PAGE_TYPE,
      path: "/rooms/hotels/?q=1#rent",
      title: "Hotels",
    });
    expect(pageMessage(at("/rooms/"), "", "Rooms | Verticopolis Help").title).toBe("Rooms");
    expect(pageMessage(at("/"), "", "").title).toBe("Player's Manual");
  });
});

describe("readPageMessage", () => {
  it("reads a page message and refuses anything else", () => {
    expect(readPageMessage({ type: MANUAL_PAGE_TYPE, path: "/rooms/", title: "Rooms" })).toEqual({
      type: MANUAL_PAGE_TYPE,
      path: "/rooms/",
      title: "Rooms",
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

  it("keeps a long title short", () => {
    expect(readPageMessage({ type: MANUAL_PAGE_TYPE, path: "/", title: "x".repeat(500) })!.title).toHaveLength(200);
  });
});

describe("replacedBy", () => {
  const HERE = "https://help.example/help/rooms/";
  const click = { button: 0, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, defaultPrevented: false };
  const link = (href: string, target = "", download = false) => ({
    href,
    target,
    hasAttribute: (name: string) => name === "download" && download,
  });

  it("follows a plain click on a link to another manual page itself", () => {
    expect(replacedBy(click, link("https://help.example/help/rooms/hotels/"), HERE, "/help")).toBe(
      "https://help.example/help/rooms/hotels/",
    );
    expect(replacedBy(click, link("https://help.example/help/rooms/?q=hotel"), HERE, "/help")).toBe(
      "https://help.example/help/rooms/?q=hotel",
    );
    expect(replacedBy(click, link("https://help.example/help/rooms/#offices"), HERE, "/help")).toBe(
      "https://help.example/help/rooms/#offices",
    );
  });

  it("leaves other clicks and links to the browser", () => {
    const manualPage = link("https://help.example/help/rooms/hotels/");
    expect(replacedBy({ ...click, button: 1 }, manualPage, HERE, "/help")).toBeNull();
    expect(replacedBy({ ...click, ctrlKey: true }, manualPage, HERE, "/help")).toBeNull();
    expect(replacedBy({ ...click, defaultPrevented: true }, manualPage, HERE, "/help")).toBeNull();
    expect(replacedBy(click, null, HERE, "/help")).toBeNull();
    expect(replacedBy(click, link("https://github.com/x"), HERE, "/help")).toBeNull();
    expect(replacedBy(click, link("https://help.example/"), HERE, "/help")).toBeNull();
    expect(replacedBy(click, link("https://help.example/help/rooms/hotels/", "_blank"), HERE, "/help")).toBeNull();
    expect(replacedBy(click, link("https://help.example/help/catalog.json", "", true), HERE, "/help")).toBeNull();
  });
});
