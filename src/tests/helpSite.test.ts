import { describe, it, expect, vi } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { HELP_BASE, OG_IMAGE_ALT, OLD_ANCHORS, landingAction, oldAnchorRedirects, sharedHead, sidebar, type SidebarEntry } from "../../help-site/site.mjs";
import { catalogFor } from "./catalogFixture";
import { HELP_PAGES_DIR } from "../build/helpMarkdown";

const pagesDir = resolve(__dirname, "../..", HELP_PAGES_DIR);

/** Runs the redirect script against a fake location and returns where it sent
 *  the browser, or null when it stayed put. */
function redirect(helpIds: Record<string, string>, pathname: string, hash: string, search = ""): string | null {
  const replace = vi.fn();
  const location = { pathname, hash, search, replace };
  new Function("location", oldAnchorRedirects(helpIds))(location);
  return replace.mock.calls.length ? (replace.mock.calls[0][0] as string) : null;
}

function flatten(entries: SidebarEntry[]): SidebarEntry[] {
  return entries.flatMap((entry) => ("items" in entry ? flatten(entry.items) : [entry]));
}

describe("the old /help#section redirect", () => {
  const ids = { basics: "getting-started", touch: "phones" };

  it("sends an old anchor on /help to its page, keeping the query", () => {
    expect(redirect(ids, "/help", "#touch")).toBe("/help/phones/");
    expect(redirect(ids, "/help/", "#basics", "?from=game")).toBe("/help/getting-started/?from=game");
  });

  it("leaves an unknown anchor, another page and the inherited object keys alone", () => {
    expect(redirect(ids, "/help", "#nope")).toBeNull();
    expect(redirect(ids, "/help", "")).toBeNull();
    expect(redirect(ids, "/help", "#constructor")).toBeNull();
    expect(redirect(ids, "/help/keyboard/", "#touch")).toBeNull();
  });
});

describe("the side menu", () => {
  it("names only pages that exist", () => {
    const slugs = flatten(sidebar).flatMap((entry) => ("slug" in entry ? [entry.slug] : []));
    expect(slugs.length).toBeGreaterThan(0);
    const exists = (slug: string) => [`${slug}.md`, `${slug}.mdx`, `${slug}/index.mdx`].some((f) => existsSync(resolve(pagesDir, f)));
    for (const slug of slugs) expect(exists(slug), slug).toBe(true);
  });

  it("lists every page but the front page", () => {
    const slugs = new Set(flatten(sidebar).flatMap((entry) => ("slug" in entry ? [entry.slug] : [])));
    // Every page in every folder, a folder's own index page by the folder's
    // name (Starlight's slug for rooms/index.mdx is "rooms").
    const pages = readdirSync(pagesDir, { recursive: true, encoding: "utf8" })
      .filter((f) => /\.mdx?$/.test(f) && f !== "index.md")
      .map((f) => f.replace(/\.mdx?$/, "").replace(/\/index$/, ""));
    for (const page of pages) expect(slugs.has(page), page).toBe(true);
  });

  it("links the front page and the release notes inside the site, and no game page", () => {
    // Starlight puts the base in front of a link that starts with a slash, so
    // these stay under /help (the sprite gallery is no longer linked, #2053).
    const links = flatten(sidebar).flatMap((entry) => ("link" in entry ? [entry.link] : []));
    const served = links.filter((l) => l.startsWith("/")).map((l) => new URL(HELP_BASE + l, "https://x.test").pathname);
    expect(served).toEqual(["/help/", "/help/changelog/"]);
  });
});

describe("the pages' old anchors", () => {
  // The sections of the old one-page /help that prod served before #2053.
  // "going-further" and "about" stay on the front page, which links on.
  it("send every old section that has a page of its own to a page that exists", () => {
    expect(Object.keys(OLD_ANCHORS).sort()).toEqual(["basics", "classic-vs-modern", "keyboard", "privacy", "touch"]);
    const exists = (slug: string) => [`${slug}.md`, `${slug}.mdx`, `${slug}/index.mdx`].some((f) => existsSync(resolve(pagesDir, f)));
    for (const [id, slug] of Object.entries(OLD_ANCHORS)) expect(exists(slug), `${id} → ${slug}`).toBe(true);
  });
});

describe("the manual's own words, checked against the engine", () => {
  const page = (file: string) => readFileSync(resolve(pagesDir, file), "utf8");

  it("tells players what happens if the game engine stops", () => {
    const text = page("your-towers/saving.mdx");
    expect(text).toContain("If the game engine crashes, the game reloads your tower from its last autosave.");
    expect(text).toContain("Your saves are still on your device, and **Reload** tries again.");
  });

  it("gives the Wedding Hall and the top floor the size both catalogs state (#1987)", () => {
    // The pages are written for the standard lot. A lot whose top moves (the
    // Tall lot, #1983) needs its own line here.
    const words: Record<number, string> = { 5: "five" };
    for (const mode of ["classic", "modern"] as const) {
      const catalog = catalogFor(mode);
      const hall = catalog.facilities.find((f) => f.key === "weddingHall")!;
      expect(page("rooms/wedding-hall.mdx"), mode).toContain(`It is ${hall.width} tiles wide and ${words[hall.floors]} floors tall`);
      expect(page("rooms/wedding-hall.mdx"), mode).toContain(`Nothing else may reach floor ${catalog.world.maxFloor}`);
      expect(page("building/floors-and-lobbies.mdx"), mode).toContain(`You can build up to **floor ${catalog.world.maxFloor}**`);
    }
  });
});

describe("the shared head tags", () => {
  const viteConfig = readFileSync(resolve(__dirname, "../../vite.config.ts"), "utf8");

  it("use the game's share card alt text", () => {
    const alt = viteConfig.match(/const OG_IMAGE_ALT =\s*"([^"]+)"/)?.[1];
    expect(alt).toBeTruthy();
    expect(OG_IMAGE_ALT).toBe(alt);
  });

  it("carry each tag the game's pages share that Starlight does not write", () => {
    // The alt text tags name OG_IMAGE_ALT rather than a string, so this
    // literal match leaves them to the test above.
    const starlightWrites = ["og:type", "og:site_name", "og:locale", "twitter:card"];
    const gameTags = [...viteConfig.matchAll(/attrs: \{ (?:name|property): "([^"]+)", content: "([^"]+)" \}/g)]
      .map(([, key, content]) => [key, content])
      .filter(([key]) => !starlightWrites.includes(key));
    const siteTags = sharedHead
      .filter((t) => t.tag === "meta")
      .map((t) => [t.attrs.name ?? t.attrs.property, t.attrs.content]);
    expect(gameTags.length).toBeGreaterThan(5);
    for (const [key, content] of gameTags) {
      expect(siteTags, key).toContainEqual([key, content]);
    }
  });
});

describe("the analytics landing", () => {
  const origin = "https://verticopolis.com";

  it("counts a page view from outside the site as a landing, the release notes apart", () => {
    expect(landingAction("/help/", "", origin)).toBe("page_help");
    expect(landingAction("/help/keyboard/", `${origin}/`, origin)).toBe("page_help");
    expect(landingAction("/help/changelog/", "https://www.reddit.com/r/x", origin)).toBe("page_changelog");
    expect(landingAction("/help/changelog", `${origin}/help-me`, origin)).toBe("page_changelog");
  });

  it("does not count a step from one help page to another", () => {
    expect(landingAction("/help/keyboard/", `${origin}/help/`, origin)).toBeNull();
    expect(landingAction("/help/changelog/", `${origin}/help`, origin)).toBeNull();
    expect(landingAction("/help/", "https://elsewhere.test/help/", origin)).toBe("page_help");
  });
});

describe("the help site's cache headers", () => {
  type Rule = { source: string; headers: { key: string; value: string }[] };
  const rules = (JSON.parse(readFileSync(resolve(__dirname, "../../vercel.json"), "utf8")) as { headers: Rule[] }).headers;
  // Vercel sources are path-to-regexp; the ones here only use `(.*)` and `(a|b)` groups.
  const matches = (source: string, path: string) => new RegExp(`^${source.replace(/\./g, "\\.").replace(/\\\.\*/g, ".*")}$`).test(path);
  const immutable = (path: string) =>
    rules.some((r) => matches(r.source, path) && r.headers.some((h) => h.key === "Cache-Control" && h.value.includes("immutable")));

  it("keeps Astro's and Pagefind's content-hashed files for a year", () => {
    expect(immutable("/help/_astro/Sprite.astro_astro_type_script_index_0_lang.B-Iva01u.js")).toBe(true);
    expect(immutable("/help/_astro/ec.w36nc.css")).toBe(true);
    expect(immutable("/help/pagefind/fragment/en_1144b33.pf_fragment")).toBe(true);
    expect(immutable("/help/pagefind/index/en_15b0e9b.pf_index")).toBe(true);
  });

  it("never pins a file whose name stays the same when it changes", () => {
    for (const path of [
      "/help/",
      "/help/rooms/venues/",
      "/help/catalog.json",
      "/help/sitemap-index.xml",
      "/help/pagefind/pagefind.js",
      "/help/pagefind/pagefind-entry.json",
      "/help/pagefind/wasm.en.pagefind",
      "/engine/verticopolis_engine_bg.wasm",
      "/sw.js",
      "/version.json",
    ]) {
      expect(immutable(path), path).toBe(false);
    }
  });
});

describe("the link check", () => {
  it("finds a link to a missing page or a missing section, and passes the rest", async () => {
    const { brokenLinks, servedPath } = await import("../../help-site/scripts/check-links.mjs");
    expect(servedPath("rooms/venues/index.html")).toBe("/help/rooms/venues/");
    expect(servedPath("index.html")).toBe("/help/");
    const pages = new Map([
      ["/help/", '<a href="/help/rooms/#spa">ok</a><a href="/help/rooms/#nope">x</a><a href="/help/gone/">x</a>'],
      ["/help/rooms/", '<h2 id="spa">Spa</h2><a href="/help/">home</a><a href="/help/catalog.json">data</a><a href="https://example.com/">out</a>'],
    ]);
    expect(brokenLinks(pages)).toEqual(["/help/ → /help/rooms/#nope (no such section)", "/help/ → /help/gone/ (no such page)"]);
  });
});
