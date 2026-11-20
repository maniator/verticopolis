import { describe, it, expect } from "vitest";
import { HELP_SCHEMES, HELP_SCHEME_COOKIE, HELP_SCHEME_KEY, schemeBootScript } from "../../help-site/site.mjs";
import { DEFAULT_SCHEME, SCHEMES, SCHEME_COOKIE } from "../ui/appearance/appearancePrefs";
import { SCHEME_PARAM, fromGameHref } from "../ui/fromGame";

/** A Storage stand-in over `store`; `blocked` makes every call throw. */
function storageOver(store: Map<string, string>, blocked = false) {
  return {
    getItem: (k: string) => {
      if (blocked) throw new Error("blocked");
      return store.get(k) ?? null;
    },
    setItem: (k: string, v: string) => {
      if (blocked) throw new Error("blocked");
      store.set(k, v);
    },
  };
}

/** Runs the manual's head script for a page at `search`, with `kept` in its
 *  storage, and returns the scheme it dressed the page in and what it kept.
 *  `cookie` is the page's cookie line on the manual's own host (an Error makes
 *  reading it throw); without it the script is the one a build that keeps the
 *  manual under /help runs. `tab` is the tab's sessionStorage, shared between
 *  calls to model later pages in the same tab. */
function boot(
  search: string,
  kept: string | null,
  blocked = false,
  cookie?: string | Error,
  tab: Map<string, string> = new Map(),
): { worn: string | null; kept: string | null } {
  const store = new Map<string, string>(kept === null ? [] : [[HELP_SCHEME_KEY, kept]]);
  const root = document.createElement("html");
  const doc = {
    documentElement: root,
    get cookie(): string {
      if (cookie instanceof Error) throw cookie;
      return cookie ?? "";
    },
  };
  const script = schemeBootScript(cookie !== undefined);
  new Function("location", "localStorage", "sessionStorage", "document", script)(
    { search },
    storageOver(store, blocked),
    storageOver(tab, blocked),
    doc,
  );
  return { worn: root.getAttribute("data-scheme"), kept: store.get(HELP_SCHEME_KEY) ?? null };
}

describe("the manual wears the game's appearance scheme", () => {
  it("knows every scheme the game offers besides Standard", () => {
    expect(HELP_SCHEMES).toEqual(SCHEMES.filter((id) => id !== DEFAULT_SCHEME));
    expect(HELP_SCHEME_KEY).toBe("vc.appearance");
    expect(HELP_SCHEME_COOKIE).toBe(SCHEME_COOKIE);
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

  it("on its own host, wears the scheme the game's cookie shares, over the kept one", () => {
    expect(boot("", "standard", false, `other=1; ${SCHEME_COOKIE}=skyline`)).toEqual({
      worn: "skyline",
      kept: "skyline",
    });
    expect(boot("", "skyline", false, `${SCHEME_COOKIE}=standard; other=1`)).toEqual({ worn: null, kept: "standard" });
  });

  it("on its own host, falls back to the kept scheme when the cookie is missing or unknown", () => {
    expect(boot("", "high_contrast", false, "")).toEqual({ worn: "high_contrast", kept: "high_contrast" });
    expect(boot("", "high_contrast", false, `${SCHEME_COOKIE}=luna`)).toEqual({
      worn: "high_contrast",
      kept: "high_contrast",
    });
    expect(boot("", null, true, `${SCHEME_COOKIE}=skyline`).worn).toBe("skyline");
  });

  it("lets a game link win over the cookie", () => {
    expect(boot("?from=game&scheme=high_contrast", null, false, `${SCHEME_COOKIE}=skyline`)).toEqual({
      worn: "high_contrast",
      kept: "high_contrast",
    });
  });

  it("under /help on the game's origin, never reads a cookie", () => {
    expect(schemeBootScript(false)).not.toContain(SCHEME_COOKIE);
  });

  it("on its own host, keeps the game link's scheme for the rest of the tab, over the cookie", () => {
    const tab = new Map<string, string>();
    const cookie = `${SCHEME_COOKIE}=skyline`;
    expect(boot("?from=game&scheme=high_contrast", "skyline", false, cookie, tab).worn).toBe("high_contrast");
    // A reload (the flag is stripped) and the next page, in the same tab.
    expect(boot("", "high_contrast", false, cookie, tab).worn).toBe("high_contrast");
    expect(boot("", "high_contrast", false, cookie, tab).worn).toBe("high_contrast");
    // A link with no scheme pins Standard for the tab the same way.
    const plain = new Map<string, string>();
    boot("?from=game&via=game_menu", null, false, cookie, plain);
    expect(boot("", null, false, cookie, plain).worn).toBeNull();
  });

  it("on its own host, a new tab with no pin wears the cookie", () => {
    expect(boot("", "high_contrast", false, `${SCHEME_COOKIE}=skyline`, new Map()).worn).toBe("skyline");
  });

  it("on its own host, still falls back to the kept scheme when reading the cookie throws", () => {
    expect(boot("", "high_contrast", false, new Error("opaque origin")).worn).toBe("high_contrast");
  });

  it("under /help on the game's origin, pins nothing for the tab", () => {
    const tab = new Map<string, string>();
    boot("?from=game&scheme=skyline", null, false, undefined, tab);
    expect(tab.size).toBe(0);
  });
});
