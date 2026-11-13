import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import site from "../../docs/engine-site/pages.json";
import { RUST_REFERENCE, sidebar } from "../../docs/engine-site/site.mjs";
import { chrome } from "../../docs/engine-site/scripts/rustdoc-chrome.mjs";

/**
 * The engine docs site (`docs/engine-site/`, served at docs.verticopolis.com)
 * is a Starlight site whose pages are files the repository already keeps,
 * listed in its pages.json and copied in by its sync script before a build.
 * `.github/workflows/engine-docs.yml` builds and deploys it; that workflow's
 * own pull request run is the check on the build (AGENTS.md: no tests that
 * mirror CI config text). This guard checks the list: every page and every
 * alias names a real file, and every page is in the side menu (`site.mjs`),
 * which the Rust API reference draws too (`scripts/rustdoc-chrome.mjs`).
 */
const root = resolve(__dirname, "..", "..");

describe("engine docs site", () => {
  it("builds its pages from files that exist", () => {
    const sources = site.pages.map((page) => page.source);
    expect(sources).toContain("docs/engine-site/guides/javascript.md");
    expect(sources).toContain("docs/engine-site/guides/crate.md");
    for (const path of sources) expect(existsSync(resolve(root, path)), `${path} exists`).toBe(true);
  });

  it("points each alias at a file that exists", () => {
    const targets = Object.entries(site.aliases).filter(([key]) => key !== "$comment");
    expect(targets.length).toBeGreaterThan(0);
    for (const [, path] of targets) expect(existsSync(resolve(root, path)), `${path} exists`).toBe(true);
  });

  it("lists every page in the side menu", () => {
    const slugs = sidebar.flatMap((entry) => ("items" in entry ? entry.items : [entry])).map((entry) => entry.slug);
    for (const page of site.pages) expect(slugs, `the side menu lists ${page.slug}`).toContain(page.slug);
  });

  it("draws the same menu into the Rust API reference", () => {
    const { before, head, after } = chrome("engine-v1.2.3");
    expect(before).toContain("Verticopolis engine 1.2.3");
    for (const page of site.pages) expect(before, `the reference's menu links ${page.slug}`).toContain(`<a href="/${page.slug}/">${page.title}</a>`);
    expect(before).toContain(`<a href="${RUST_REFERENCE}" aria-current="page">Rust API reference</a>`);
    expect(head).toContain("--r-title");
    expect(after).toContain("nav.sidebar");
  });
});
