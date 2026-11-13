import { describe, it, expect, vi } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { HELP_BASE, OLD_ANCHORS, cardAlt, cardFile, cardUrl, helpPageDetail, landingAction, oldAnchorRedirects, pageJsonLd, sharedHead, sidebar, type SidebarEntry } from "../../help-site/site.mjs";
import { catalogFor } from "./catalogFixture";
import { HELP_PAGES_DIR } from "../build/helpMarkdown";
import { CARD_MANIFEST, REGENERATE, cardManifest, helpPages, staleCards, type CardManifest, type HelpCardPage } from "../../scripts/help-card-pages.mjs";

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
      // Windows lists nested files with backslashes; slugs use slashes.
      .map((f) => f.replace(/\\/g, "/").replace(/\.mdx?$/, "").replace(/\/index$/, ""));
    for (const page of pages) expect(slugs.has(page), page).toBe(true);
  });

  it("links the front page and the release notes inside the site, and no game page", () => {
    // Starlight puts the base in front of a link that starts with a slash, so
    // these stay under /help (the sprite gallery is no longer linked, #2053).
    const links = flatten(sidebar).flatMap((entry) => ("link" in entry ? [entry.link] : []));
    const served = links.filter((l) => l.startsWith("/")).map((l) => new URL(HELP_BASE + l, "https://x.test").pathname);
    expect(served).toEqual(["/help/", "/help/changelog/"]);
  });

  it("carries what the game's old About menu held: the release notes, Report a problem and Privacy", () => {
    // About… in the game opens only About this game; these three moved here.
    const entries = flatten(sidebar);
    const byLabel = (label: string) => entries.find((e) => "label" in e && e.label === label);
    expect(byLabel("Release notes")).toMatchObject({ link: "/changelog/" });
    expect(byLabel("Report a problem")).toMatchObject({ link: expect.stringContaining("github.com/maniator/verticopolis/issues") });
    expect(entries.some((e) => "slug" in e && e.slug === "privacy")).toBe(true);
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

  it("carry each tag the game's pages share that Starlight does not write", () => {
    // Each help page names its own card (src/components/Head.astro), so the
    // game's og:image and twitter:image are the ones left out here; the alt
    // text tags name OG_IMAGE_ALT rather than a string, so this literal match
    // never sees them.
    const starlightWrites = ["og:type", "og:site_name", "og:locale", "twitter:card"];
    const perPage = ["og:image", "twitter:image"];
    const gameTags = [...viteConfig.matchAll(/attrs: \{ (?:name|property): "([^"]+)", content: "([^"]+)" \}/g)]
      .map(([, key, content]) => [key, content])
      .filter(([key]) => !starlightWrites.includes(key) && !perPage.includes(key));
    const siteTags = sharedHead
      .filter((t) => t.tag === "meta")
      .map((t) => [t.attrs.name ?? t.attrs.property, t.attrs.content]);
    expect(gameTags.length).toBeGreaterThan(3);
    for (const [key, content] of gameTags) {
      expect(siteTags, key).toContainEqual([key, content]);
    }
  });
});

describe("search and sharing", () => {
  const pageFiles = readdirSync(pagesDir, { recursive: true, encoding: "utf8" }).filter((f) => /\.mdx?$/.test(f));
  const frontMatter = (file: string, key: string): string | undefined =>
    new RegExp(`^${key}: (.+)$`, "m").exec(readFileSync(resolve(pagesDir, file), "utf8").split("\n---")[0])?.[1];

  it("gives every page a description of its own, for search results and share cards", () => {
    const seen = new Map<string, string>();
    for (const file of pageFiles) {
      const description = frontMatter(file, "description");
      expect(description, file).toBeTruthy();
      expect(seen.get(description!), `${file} repeats a description`).toBeUndefined();
      seen.set(description!, file);
    }
  });

  it("draws a share card for every page, and keeps no card for a page that is gone", () => {
    // A page's Starlight slug: its path without the extension, a folder's
    // index page by the folder's name, and "" for the front page. The release
    // notes are an Astro page of their own (src/pages/changelog.astro).
    const slugs = [
      ...pageFiles.map((f) =>
        f
          .replace(/\\/g, "/")
          .replace(/\.mdx?$/, "")
          .replace(/(^|\/)index$/, ""),
      ),
      "changelog",
    ];
    const cardsDir = resolve(__dirname, "../../help-site/public/cards");
    const cards = new Set(readdirSync(cardsDir));
    for (const slug of slugs) expect(cards.has(cardFile(slug)), `no card for ${slug || "the front page"}: run scripts/gen-help-cards.mjs`).toBe(true);
    expect([...cards].sort()).toEqual(slugs.map(cardFile).sort());
  });

  describe("each card still shows its page's title and description", () => {
    const recorded = (): CardManifest => JSON.parse(readFileSync(CARD_MANIFEST, "utf8")) as CardManifest;
    const page = (pages: HelpCardPage[], slug: string): HelpCardPage => pages.find((p) => p.slug === slug)!;

    it("matches the record of what every card was drawn from", async () => {
      const stale = staleCards(await helpPages(), recorded());
      expect(stale, `stale share cards; redraw them with ${REGENERATE} <slug> in the pinned Playwright image`).toEqual([]);
    });

    it("records exactly the cards on disk, the front page, a section's index page and the release notes included", async () => {
      const cardsDir = resolve(__dirname, "../../help-site/public/cards");
      const manifest = recorded();
      expect(Object.keys(manifest).sort()).toEqual(readdirSync(cardsDir).sort());
      const pages = await helpPages();
      expect(manifest["index.png"]?.title).toBe(page(pages, "").title);
      expect(manifest["rooms.png"]?.title).toBe(page(pages, "rooms").title);
      expect(manifest["changelog.png"]?.description).toBe(page(pages, "changelog").description);
      // The help site has no 404 page of its own (disable404Route), so no card for one.
      expect(manifest["404.png"]).toBeUndefined();
    });

    it("fails on a changed title or description, naming the card and the command that redraws it", async () => {
      const pages = await helpPages();
      const manifest = recorded();
      const was = manifest["rooms-venues.png"].title;
      const renamed = pages.map((p) => (p.slug === "rooms/venues" ? { ...p, title: `${p.title} and more` } : p));
      expect(staleCards(renamed, manifest)).toEqual([
        `rooms-venues.png: the card says "${was}" but the page's title is now "${was} and more"; run ${REGENERATE} rooms/venues in the pinned Playwright image`,
      ]);
      const reworded = pages.map((p) => (p.slug === "" ? { ...p, description: `${p.description}!` } : p));
      expect(staleCards(reworded, manifest)).toEqual([
        `index.png: the card's description is not the page's current one; run ${REGENERATE} "" in the pinned Playwright image`,
      ]);
    });

    it("fails on a new page with no record and on a record left over from a removed page", async () => {
      const pages = await helpPages();
      const manifest = recorded();
      const added = [...pages, { slug: "rooms/casino", title: "Casino", description: "d" }];
      expect(staleCards(added, manifest)).toEqual([expect.stringMatching(/^rooms-casino\.png: no record/)]);
      const removed = pages.filter((p) => p.slug !== "rooms/hotels");
      expect(staleCards(removed, manifest)).toEqual([expect.stringMatching(/^rooms-hotels\.png: recorded, but no page has this card/)]);
    });

    it("updates only the cards drawn, keeps the rest and drops pages that are gone", () => {
      const a = { slug: "a", title: "A", description: "a" };
      const b = { slug: "b/c", title: "B", description: "b" };
      const previous = { "a.png": { title: "old A", description: "old a" }, "b-c.png": { title: "B", description: "b" }, "gone.png": { title: "G", description: "g" } };
      expect(cardManifest([a, b], [a], previous)).toEqual({ "a.png": { title: "A", description: "a" }, "b-c.png": { title: "B", description: "b" } });
      expect(Object.keys(cardManifest([b, a], [b, a]))).toEqual(["a.png", "b-c.png"]);
    });
  });

  it("names each card by its page's slug, at the site's own address", () => {
    expect(cardFile("")).toBe("index.png");
    expect(cardFile("rooms")).toBe("rooms.png");
    expect(cardFile("rooms/hotels")).toBe("rooms-hotels.png");
    expect(cardUrl("rooms/hotels")).toBe("https://verticopolis.com/help/cards/rooms-hotels.png");
    expect(cardAlt("Hotels")).toContain("Hotels");
  });

  it("marks the front page as the site and a room page as an article inside Rooms", () => {
    const home = pageJsonLd({ slug: "", title: "How to Play", description: "d" }) as { "@graph": Record<string, unknown>[] };
    expect(home["@graph"][0]["@type"]).toBe("WebSite");
    expect(home["@graph"][0].url).toBe("https://verticopolis.com/help/");

    const hotels = pageJsonLd({ slug: "rooms/hotels", title: "Hotels", description: "d" }) as {
      "@graph": [Record<string, unknown>, { itemListElement: Record<string, unknown>[] }];
    };
    expect(hotels["@graph"][0]).toMatchObject({ "@type": "Article", headline: "Hotels", url: "https://verticopolis.com/help/rooms/hotels/" });
    expect(hotels["@graph"][1].itemListElement).toEqual([
      { "@type": "ListItem", position: 1, name: "Help", item: "https://verticopolis.com/help/" },
      { "@type": "ListItem", position: 2, name: "Rooms", item: "https://verticopolis.com/help/rooms/" },
      { "@type": "ListItem", position: 3, name: "Hotels", item: "https://verticopolis.com/help/rooms/hotels/" },
    ]);
  });

  it("leaves a section with no page of its own out of the breadcrumbs, so every crumb links", () => {
    const money = pageJsonLd({ slug: "tower/money", title: "Money", description: "d" }) as {
      "@graph": [unknown, { itemListElement: { name: string; item?: string }[] }];
    };
    const crumbs = money["@graph"][1].itemListElement;
    expect(crumbs.map((c) => c.name)).toEqual(["Help", "Money"]);
    for (const crumb of crumbs) expect(crumb.item).toMatch(/^https:\/\/verticopolis\.com\/help\//);
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

describe("the help page view's page name", () => {
  it("names a page by its path under /help, with or without the trailing slash", () => {
    expect(helpPageDetail("/help/rooms/hotels/")).toBe("rooms/hotels");
    expect(helpPageDetail("/help/rooms/hotels")).toBe("rooms/hotels");
    expect(helpPageDetail("/help/changelog/")).toBe("changelog");
    expect(helpPageDetail("/help/first-tower/")).toBe("first-tower");
  });

  it("names the front page home", () => {
    expect(helpPageDetail("/help/")).toBe("home");
    expect(helpPageDetail("/help")).toBe("home");
  });

  it("reports anything that is not a plain page path as other, never the raw text", () => {
    expect(helpPageDetail("/helpful/")).toBe("other");
    expect(helpPageDetail("/")).toBe("other");
    expect(helpPageDetail("/help/Rooms/")).toBe("other");
    expect(helpPageDetail("/help/rooms//hotels/")).toBe("other");
    expect(helpPageDetail("/help/a%20b/")).toBe("other");
    expect(helpPageDetail("/help/" + "a".repeat(81))).toBe("other");
    expect(helpPageDetail("/help/" + "a".repeat(80))).toBe("a".repeat(80));
  });

  it("names every page in the side menu after itself", () => {
    const slugs: string[] = [];
    const walk = (entries: SidebarEntry[]) => {
      for (const e of entries) {
        if ("slug" in e) slugs.push(e.slug);
        else if ("items" in e) walk(e.items);
      }
    };
    walk(sidebar);
    expect(slugs.length).toBeGreaterThan(20);
    for (const slug of slugs) expect(helpPageDetail(`${HELP_BASE}/${slug}/`)).toBe(slug);
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
