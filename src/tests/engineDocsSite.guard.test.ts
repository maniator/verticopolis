import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import site from "../../docs/engine-site/pages.json";

/**
 * The engine docs site (`docs/engine-site/`, served at docs.verticopolis.com)
 * is a Starlight site whose pages are files the repository already keeps,
 * listed in its pages.json and copied in by its sync script before a build.
 * `.github/workflows/engine-docs.yml` builds and deploys it; that workflow's
 * own pull request run is the check on the build (AGENTS.md: no tests that
 * mirror CI config text). This guard checks the list: every page and every
 * alias names a real file, and every page is in the sidebar.
 */
const root = resolve(__dirname, "..", "..");

describe("engine docs site", () => {
  it("builds its pages from files that exist", () => {
    const sources = site.pages.map((page) => page.source);
    expect(sources).toContain("packages/verticopolis-engine/README.md");
    expect(sources).toContain("engine-rs/CRATE_README.md");
    for (const path of sources) expect(existsSync(resolve(root, path)), `${path} exists`).toBe(true);
  });

  it("points each alias at a file that exists", () => {
    const targets = Object.entries(site.aliases).filter(([key]) => key !== "$comment");
    expect(targets.length).toBeGreaterThan(0);
    for (const [, path] of targets) expect(existsSync(resolve(root, path)), `${path} exists`).toBe(true);
  });

  it("lists every page in the sidebar", () => {
    const config = readFileSync(resolve(root, "docs/engine-site/astro.config.mjs"), "utf8");
    for (const page of site.pages) expect(config, `the sidebar lists ${page.slug}`).toContain(`slug: "${page.slug}"`);
  });
});
