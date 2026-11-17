import { describe, it, expect } from "vitest";
import { HELP_SCHEMES, HELP_SCHEME_KEY, schemeBootScript } from "../../help-site/site.mjs";
import { DEFAULT_SCHEME, SCHEMES } from "../ui/appearance/appearancePrefs";
import { SCHEME_PARAM, fromGameHref } from "../ui/fromGame";

/** Runs the manual's head script for a page at `search`, with `kept` in its
 *  storage, and returns the scheme it dressed the page in and what it kept. */
function boot(search: string, kept: string | null, blocked = false): { worn: string | null; kept: string | null } {
  const store = new Map<string, string>(kept === null ? [] : [[HELP_SCHEME_KEY, kept]]);
  const storage = {
    getItem: (k: string) => {
      if (blocked) throw new Error("blocked");
      return store.get(k) ?? null;
    },
    setItem: (k: string, v: string) => {
      if (blocked) throw new Error("blocked");
      store.set(k, v);
    },
  };
  const root = document.createElement("html");
  new Function("location", "localStorage", "document", schemeBootScript())({ search }, storage, { documentElement: root });
  return { worn: root.getAttribute("data-scheme"), kept: store.get(HELP_SCHEME_KEY) ?? null };
}

describe("the manual wears the game's appearance scheme", () => {
  it("knows every scheme the game offers besides Standard", () => {
    expect(HELP_SCHEMES).toEqual(SCHEMES.filter((id) => id !== DEFAULT_SCHEME));
    expect(HELP_SCHEME_KEY).toBe("vc.appearance");
  });

  it("wears and keeps the scheme a game link names", () => {
    const search = new URL(fromGameHref("https://help.example/rooms/", "stats", "skyline")).search;
    expect(boot(search, null)).toEqual({ worn: "skyline", kept: "skyline" });
  });

  it("goes back to Standard when the game opens it with no scheme", () => {
    expect(boot("?from=game&via=game_menu", "skyline")).toEqual({ worn: null, kept: "standard" });
  });

  it("ignores a scheme it does not know", () => {
    expect(boot(`?from=game&${SCHEME_PARAM}=luna`, "skyline")).toEqual({ worn: null, kept: "standard" });
  });

  it("wears the kept scheme on a visit the game did not open", () => {
    expect(boot("", "high_contrast")).toEqual({ worn: "high_contrast", kept: "high_contrast" });
    expect(boot("", "standard").worn).toBeNull();
    expect(boot(`?${SCHEME_PARAM}=skyline`, null)).toEqual({ worn: null, kept: null });
  });

  it("still dresses the page from the link when storage is blocked", () => {
    expect(boot("?from=game&scheme=skyline", null, true).worn).toBe("skyline");
    expect(boot("", null, true).worn).toBeNull();
  });
});
