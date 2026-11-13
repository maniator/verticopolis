/**
 * The help pages a share card is drawn for, and the record of what each card
 * was drawn from. scripts/gen-help-cards.mjs draws the cards from these pages
 * and writes the record; src/tests/helpSite.test.ts reads both and fails when
 * a page's title or description no longer matches the card's, since the cards
 * are committed pictures of that text and nothing else would notice.
 *
 * Kept apart from gen-help-cards.mjs so the test can read the pages without
 * loading Playwright.
 */
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, resolve } from "node:path";
import { cardFile } from "../help-site/site.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DOCS = join(ROOT, "help-site/src/content/docs");
const CHANGELOG_PAGE = join(ROOT, "help-site/src/pages/changelog.astro");

/** The record of what each card shows, beside the help site's config. It
 *  stays out of public/cards/ so it is not deployed as a card. */
export const CARD_MANIFEST = join(ROOT, "help-site/share-cards.json");

/** The command that redraws one page's card, for a failure message. */
export const REGENERATE = "node scripts/gen-help-cards.mjs";

/** One front-matter field, unquoted. Pages use plain `key: value` lines. */
function field(text, key) {
  const m = text.match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
  return m ? m[1].trim().replace(/^(["'])(.*)\1$/, "$2") : null;
}

/** Every page with a card: its slug (as Starlight names it), title and description. */
export async function helpPages() {
  const pages = [];
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (/\.mdx?$/.test(entry.name)) {
        const text = (await readFile(path, "utf8")).replace(/\r\n/g, "\n");
        const front = text.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? "";
        const slug = relative(DOCS, path)
          .replace(/\\/g, "/")
          .replace(/\.mdx?$/, "")
          .replace(/(^|\/)index$/, "");
        pages.push({ slug, title: field(front, "title"), description: field(front, "description") });
      }
    }
  }
  await walk(DOCS);
  // The release notes page is an Astro page with its front matter inline.
  const changelog = await readFile(CHANGELOG_PAGE, "utf8");
  pages.push({
    slug: "changelog",
    title: changelog.match(/title: "([^"]+)"/)?.[1] ?? null,
    description: changelog.match(/description: "([^"]+)"/)?.[1] ?? null,
  });
  for (const p of pages) {
    if (!p.title || !p.description) throw new Error(`${p.slug || "index"} has no title or description`);
  }
  return pages.sort((a, b) => a.slug.localeCompare(b.slug));
}

/**
 * The manifest after drawing `drawn`: each card file names the title and
 * description it shows. Entries for cards not drawn this time are kept from
 * `previous`, and entries for pages that no longer exist (`pages`) are dropped.
 */
export function cardManifest(pages, drawn, previous = {}) {
  const live = new Set(pages.map((p) => cardFile(p.slug)));
  const next = {};
  for (const [file, entry] of Object.entries(previous)) if (live.has(file)) next[file] = entry;
  for (const p of drawn) next[cardFile(p.slug)] = { title: p.title, description: p.description };
  return Object.fromEntries(Object.entries(next).sort(([a], [b]) => a.localeCompare(b)));
}

/**
 * What is out of date between the pages and the cards' record, one line per
 * problem naming the page and the command that fixes it. Empty when every card
 * shows its page's current title and description.
 */
export function staleCards(pages, manifest) {
  const problems = [];
  const live = new Set();
  for (const p of pages) {
    const file = cardFile(p.slug);
    live.add(file);
    const fix = `run ${REGENERATE} ${p.slug || '""'} in the pinned Playwright image`;
    const drawn = manifest[file];
    if (!drawn) problems.push(`${file}: no record of what this card shows (a new page?); ${fix}`);
    else {
      if (drawn.title !== p.title) problems.push(`${file}: the card says "${drawn.title}" but the page's title is now "${p.title}"; ${fix}`);
      if (drawn.description !== p.description) problems.push(`${file}: the card's description is not the page's current one; ${fix}`);
    }
  }
  for (const file of Object.keys(manifest)) {
    if (!live.has(file)) problems.push(`${file}: recorded, but no page has this card any more; delete the card and run ${REGENERATE}`);
  }
  return problems;
}
