import { describe, it, expect, vi } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { HELP_BASE, OG_IMAGE_ALT, landingAction, oldAnchorRedirects, sharedHead, sidebar, type SidebarEntry } from "../../help-site/site.mjs";
import { HELP_PAGES_DIR, parseHelpPage } from "../build/helpMarkdown";

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
    for (const slug of slugs) expect(existsSync(resolve(pagesDir, `${slug}.md`)) || existsSync(resolve(pagesDir, `${slug}.mdx`)), slug).toBe(true);
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

  it("climbs out of the site's base for the pages the game serves", () => {
    // Starlight puts the base in front of a link that starts with a slash.
    const links = flatten(sidebar).flatMap((entry) => ("link" in entry ? [entry.link] : []));
    const served = links.filter((l) => l.startsWith("/")).map((l) => new URL(HELP_BASE + l, "https://x.test").pathname);
    expect(served).toEqual(["/help/", "/help/changelog/", "/gallery"]);
  });
});

describe("the pages' old anchors", () => {
  it("cover every section the old page had", () => {
    const ids = readdirSync(pagesDir)
      .filter((f) => f.endsWith(".md"))
      .map((f) => parseHelpPage(readFileSync(resolve(pagesDir, f), "utf8")).data.helpId)
      .filter(Boolean);
    expect(ids.sort()).toEqual(["basics", "classic-vs-modern", "going-further", "keyboard", "touch"]);
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
