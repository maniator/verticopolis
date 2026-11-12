// Moves a built docs site under a sub-path, for a pull request preview at
// docs.verticopolis.com/pr-preview/pr-<number>/ (docs-preview.yml).
//
// Astro's own `base` (astro.config.mjs reads DOCS_BASE) moves the assets,
// the search index and Starlight's menu. The pages and the Rust API
// reference's header also carry links written from the site root ("/crate/",
// "/favicon.png"), because the live site sits at the root of its domain. This
// script prefixes those in every built HTML file, leaves a link that already
// has the prefix alone, and marks each page noindex so a preview never shows
// up in a search engine. It matches attribute text, so an example in a page
// that shows `href="/..."` as code is moved too; that only changes the
// preview, never the live site.
//
// Usage: node scripts/preview-base.mjs <dist folder> <base, like /pr-preview/pr-12/>
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** A preview base: /pr-preview/pr-<number>/, nothing else. */
export const PREVIEW_BASE = /^\/pr-preview\/pr-[1-9][0-9]*\/$/;

const NOINDEX = '<meta name="robots" content="noindex">';

/** One root link with the base in front; anything else unchanged. */
export function rebaseLink(link, base) {
  if (!link.startsWith("/") || link.startsWith("//") || link.startsWith(base)) return link;
  return base + link.slice(1);
}

/** Every root link in href, src and srcset attributes of one page, rebased. */
export function rebaseHtml(html, base) {
  const rebased = html
    .replace(/(\s(?:href|src)=)(["'])(.*?)\2/g, (_, attr, quote, link) => `${attr}${quote}${rebaseLink(link, base)}${quote}`)
    .replace(/(\ssrcset=)(["'])(.*?)\2/g, (_, attr, quote, list) => {
      const entries = list.split(",").map((entry) => entry.replace(/^(\s*)(\S+)/, (__, space, url) => space + rebaseLink(url, base)));
      return `${attr}${quote}${entries.join(",")}${quote}`;
    });
  return rebased.includes(NOINDEX) ? rebased : rebased.replace(/<head(\s[^>]*)?>/i, (head) => `${head}${NOINDEX}`);
}

function htmlFiles(folder) {
  return readdirSync(folder, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".html"))
    .map((entry) => join(entry.parentPath, entry.name));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [dist, base] = process.argv.slice(2);
  if (!dist || !base) throw new Error("usage: node scripts/preview-base.mjs <dist folder> <base>");
  if (!PREVIEW_BASE.test(base)) throw new Error(`${base} is not a preview base like /pr-preview/pr-12/`);
  const files = htmlFiles(dist);
  for (const file of files) writeFileSync(file, rebaseHtml(readFileSync(file, "utf8"), base));
  console.log(`moved ${files.length} pages under ${base}`);
}
