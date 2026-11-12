// Writes the docs site's header and side menu for the Rust API reference.
// cargo doc writes its own pages under /rust/, so the workflow passes these
// three files to rustdoc (engine-docs.yml):
//
//   head.html    --html-in-header: the game's palette (retro-tokens.css) and
//                rustdoc/theme.css
//   before.html  --html-before-content: the navy title bar and the site menu
//   after.html   --html-after-content: moves the site menu to the top of
//                rustdoc's sidebar, above the crate's own items
//
// The title and the menu come from site.mjs and pages.json, the same lists
// Starlight draws from, so the two stay one menu.
//
// Usage: node scripts/rustdoc-chrome.mjs <output folder>
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { GITHUB, RUST_REFERENCE, sidebar, siteTitle } from "../site.mjs";

const site = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repo = resolve(site, "..", "..");

const escape = (text) =>
  String(text).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

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
  return `<nav class="vc-site-menu" aria-label="Docs"><ul>${items.join("")}</ul></nav>`;
}

// The GitHub mark, as Starlight's header shows it.
const GITHUB_ICON =
  '<svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M12 .3a12 12 0 0 0-3.8 23.38c.6.12.83-.26.83-.57L9 21.07c-3.34.72-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.08-.74.09-.73.09-.73 1.2.09 1.83 1.24 1.83 1.24 1.08 1.83 2.81 1.3 3.5 1 .1-.78.42-1.31.76-1.61-2.67-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.14-.3-.54-1.52.1-3.18 0 0 1-.32 3.3 1.23a11.5 11.5 0 0 1 6 0c2.28-1.55 3.29-1.23 3.29-1.23.64 1.66.24 2.88.12 3.18a4.65 4.65 0 0 1 1.23 3.22c0 4.61-2.8 5.63-5.48 5.92.42.36.81 1.1.81 2.22l-.01 3.29c0 .31.2.69.82.57A12 12 0 0 0 12 .3Z"/></svg>';

export function chrome(ref) {
  const { pages } = JSON.parse(readFileSync(join(site, "pages.json"), "utf8"));
  const titles = new Map(pages.map((page) => [page.slug, page.title]));
  const style = [
    readFileSync(join(repo, "src/styles/retro-tokens.css"), "utf8"),
    readFileSync(join(site, "rustdoc/theme.css"), "utf8"),
  ].join("\n");
  const head = `<style>\n${style}</style>\n`;
  const before =
    `<header class="vc-header"><a class="vc-site-title" href="/"><img src="/favicon.png" alt="" width="40" height="40"><span>${escape(siteTitle(ref))}</span></a>` +
    `<a class="vc-social" href="${GITHUB}"><span class="vc-sr-only">GitHub</span>${GITHUB_ICON}</a></header>\n` +
    `${siteMenu(sidebar, titles)}\n`;
  const after =
    '<script>(function(){var m=document.querySelector(".vc-site-menu"),s=document.querySelector("nav.sidebar");if(m&&s){s.insertBefore(m,s.firstChild);document.documentElement.classList.add("vc-menu-in-sidebar");}})();</script>\n';
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
