// Checks every link between help pages in the built site (dist/help): each
// page a link names exists, and each #section it names is an id on that page.
// Run after `astro build`: node help-site/scripts/check-links.mjs. With
// VC_HELP_ORIGIN set, as for a build of the manual's own host, the pages sit
// at the root instead of under /help (help-site/site.mjs).
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/** The path a built page is served at: `rooms/venues/index.html` →
 *  `/help/rooms/venues/`, or `/rooms/venues/` when `base` is the root (""). */
export function servedPath(file, base = "/help") {
  return (
    base +
    "/" +
    file
      .replace(/\\/g, "/")
      .replace(/(^|\/)index\.html$/, "$1")
      .replace(/\.html$/, "/")
  );
}

/** Every id on a page. */
function idsOf(html) {
  return new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
}

/** Links that point at a missing help page or a missing section, as
 *  "from → to" lines. `pages` maps each served path to its HTML. */
export function brokenLinks(pages, base = "/help") {
  const ids = new Map([...pages].map(([path, html]) => [path, idsOf(html)]));
  const broken = [];
  for (const [from, html] of pages) {
    for (const [, href] of html.matchAll(/\shref="([^"]+)"/g)) {
      const url = new URL(href.replace(/&amp;/g, "&"), "https://site" + from);
      if (url.origin !== "https://site" || !url.pathname.startsWith(base + "/")) continue;
      // Built files and the catalog aren't pages.
      const inSite = url.pathname.slice(base.length);
      if (/^\/(_astro|pagefind)\//.test(inSite) || /\.[a-z0-9]+$/i.test(inSite)) continue;
      const path = url.pathname.endsWith("/") ? url.pathname : url.pathname + "/";
      const target = ids.get(path);
      if (!target) broken.push(`${from} → ${href} (no such page)`);
      else if (url.hash && !target.has(decodeURIComponent(url.hash.slice(1))))
        broken.push(`${from} → ${href} (no such section)`);
    }
  }
  return broken;
}

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : name.endsWith(".html") ? [full] : [];
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../dist/help");
  const base = process.env.VC_HELP_ORIGIN ? "" : "/help";
  const pages = new Map(walk(root).map((file) => [servedPath(relative(root, file), base), readFileSync(file, "utf8")]));
  const broken = brokenLinks(pages, base);
  for (const line of broken) console.error(`::error::broken help link: ${line}`);
  console.log(`${pages.size} pages checked, ${broken.length} broken links`);
  process.exit(broken.length ? 1 : 0);
}
