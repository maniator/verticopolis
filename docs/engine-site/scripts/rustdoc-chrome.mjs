// Writes the docs site's header and side menu for the Rust API reference.
// cargo doc writes its own pages under /rust/, so the workflow passes these
// three files to rustdoc (engine-docs.yml):
//
//   head.html    --html-in-header: the game's palette (retro-tokens.css), the
//                shared title bar's styles (src/styles/title-bar.css) and
//                rustdoc/theme.css
//   before.html  --html-before-content: the navy title bar and the site menu
//   after.html   --html-after-content: moves the site menu to the top of
//                rustdoc's sidebar, above the crate's own items, and on a
//                phone folds the title bar into rustdoc's own top bar, so
//                the page has one bar and one menu button
//
// The title and the menu come from site.mjs and pages.json, the same lists
// Starlight draws from, so the two stay one menu. The title bar's markup is
// title-bar.mjs, the one the docs site and the help site draw.
//
// Usage: node scripts/rustdoc-chrome.mjs <output folder>
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { GITHUB, RUST_REFERENCE, SHORT_TITLE, sidebar, siteTitle } from "../site.mjs";
import { barLinks, escapeHtml as escape, siteName } from "../title-bar.mjs";

const site = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repo = resolve(site, "..", "..");

/** One menu entry as a link; a slug takes its title and path from pages.json. */
function link(entry, titles) {
  const label = entry.label ?? titles.get(entry.slug);
  if (label === undefined) throw new Error(`site.mjs names a page pages.json does not list: ${entry.slug}`);
  const href = entry.link ?? `/${entry.slug}/`;
  const current = href === RUST_REFERENCE ? ' aria-current="page"' : "";
  return `<li><a href="${escape(href)}"${current}>${escape(label)}</a></li>`;
}

/** The site menu, drawn the way Starlight draws it: top links, then labeled groups. */
export function siteMenu(entries, titles) {
  const items = entries.map((entry) =>
    entry.items
      ? `<li><details open><summary>${escape(entry.label)}</summary><ul>${entry.items
          .map((item) => link(item, titles))
          .join("")}</ul></details></li>`
      : link(entry, titles).replace("<li>", '<li class="vc-top">'),
  );
  // A phone's title bar has no room for GitHub, so the menu ends with it
  // there, as Starlight's phone menu does.
  items.push(`<li class="vc-top vc-menu-github"><a href="${GITHUB}">GitHub</a></li>`);
  return `<nav class="vc-site-menu" aria-label="Docs"><ul>${items.join("")}</ul></nav>`;
}

export function chrome(ref) {
  const { pages } = JSON.parse(readFileSync(join(site, "pages.json"), "utf8"));
  const titles = new Map(pages.map((page) => [page.slug, page.title]));
  const style = [
    readFileSync(join(repo, "src/styles/retro-tokens.css"), "utf8"),
    readFileSync(join(site, "src/styles/title-bar.css"), "utf8"),
    readFileSync(join(site, "rustdoc/theme.css"), "utf8"),
  ].join("\n");
  const head = `<style>\n${style}</style>\n`;
  const title = `<a class="vc-bar-title" href="/"><img src="/favicon.png" alt="" width="40" height="40">${siteName(siteTitle(ref), SHORT_TITLE)}</a>`;
  const before =
    `<header class="vc-header"><div class="vc-bar">${title}<div class="vc-bar-links">${barLinks()}</div></div></header>\n` +
    `${siteMenu(sidebar, titles)}\n`;
  // The site menu moves into rustdoc's sidebar, which a phone opens with
  // rustdoc's menu button. A phone shows rustdoc's top bar (its menu button,
  // settings and help) in place of the title bar, so the title and the links
  // join it there; rustdoc/theme.css hides the title bar and rustdoc's own
  // heading in that bar once the class is set.
  const after =
    "<script>(function(){" +
    'var d=document.documentElement,m=document.querySelector(".vc-site-menu"),s=document.querySelector("nav.sidebar");' +
    'if(m&&s){s.insertBefore(m,s.firstChild);d.classList.add("vc-menu-in-sidebar");}' +
    'var t=document.querySelector("rustdoc-topbar"),b=document.querySelector(".vc-header .vc-bar");' +
    'if(t&&b){for(var i=0;i<b.children.length;i++)t.appendChild(b.children[i].cloneNode(true));d.classList.add("vc-one-bar");}' +
    "})();</script>\n";
  return { head, before, after };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = process.argv[2];
  if (!out) throw new Error("usage: node scripts/rustdoc-chrome.mjs <output folder>");
  mkdirSync(out, { recursive: true });
  const files = chrome(process.env.DOCS_REF ?? "");
  writeFileSync(join(out, "head.html"), files.head);
  writeFileSync(join(out, "before.html"), files.before);
  writeFileSync(join(out, "after.html"), files.after);
  console.log(`wrote the Rust API reference's header and menu to ${out}`);
}
