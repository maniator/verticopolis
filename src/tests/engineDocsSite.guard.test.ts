import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";

/**
 * The engine docs site (`docs/engine-site/`, served at docs.verticopolis.com)
 * is an mdBook whose pages include files the repository already keeps.
 * `.github/workflows/engine-docs.yml` builds and deploys it; that workflow's
 * own pull request run is the check on its wiring (AGENTS.md: no tests that
 * mirror CI config text). This guard checks the book's own sources: every
 * include names a real file, and every page is in the summary.
 */
const root = resolve(__dirname, "..", "..");
const site = resolve(root, "docs/engine-site/src");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const pages = readdirSync(site).filter((name) => name.endsWith(".md") && name !== "SUMMARY.md");

/** Every `{{#include path}}` in the site's pages, as repository paths. */
const included = pages.flatMap((page) =>
  [...readFileSync(resolve(site, page), "utf8").matchAll(/\{\{#include ([^}\s]+)\}\}/g)].map((m) => relative(root, resolve(dirname(resolve(site, page)), m[1]!)).replace(/\\/g, "/")),
);

describe("engine docs site", () => {
  it("includes only files that exist", () => {
    expect(included.length).toBeGreaterThanOrEqual(5);
    for (const path of included) expect(existsSync(resolve(root, path)), `${path} exists`).toBe(true);
    expect(included).toContain("packages/verticopolis-engine/README.md");
    expect(included).toContain("engine-rs/CRATE_README.md");
  });

  it("lists every page in the summary", () => {
    const summary = read("docs/engine-site/src/SUMMARY.md");
    for (const page of pages) expect(summary, `SUMMARY.md links ${page}`).toContain(`(${page})`);
  });
});
