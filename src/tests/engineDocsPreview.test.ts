import { describe, expect, it } from "vitest";
import { PREVIEW_BASE, rebaseHtml, rebaseLink } from "../../docs/engine-site/scripts/preview-base.mjs";
import { chrome } from "../../docs/engine-site/scripts/rustdoc-chrome.mjs";

/**
 * A pull request's docs preview is served under /pr-preview/pr-<number>/
 * (`.github/workflows/docs-preview.yml`), and the built pages still carry
 * links written from the site root. `preview-base.mjs` moves them under the
 * preview's path and keeps the preview out of search engines.
 */
const base = "/pr-preview/pr-12/";

describe("docs preview base", () => {
  it("accepts only a pull request's preview path", () => {
    expect(PREVIEW_BASE.test(base)).toBe(true);
    for (const bad of ["/", "/pr-preview/pr-0/", "/pr-preview/pr-12", "/pr-preview/pr-1/../../", "pr-preview/pr-12/"]) {
      expect(PREVIEW_BASE.test(bad), bad).toBe(false);
    }
  });

  it("moves root links under the preview and leaves every other link alone", () => {
    expect(rebaseLink("/crate/", base)).toBe("/pr-preview/pr-12/crate/");
    expect(rebaseLink("/", base)).toBe(base);
    expect(rebaseLink("/pr-preview/pr-12/_astro/site.css", base)).toBe("/pr-preview/pr-12/_astro/site.css");
    for (const link of ["//cdn.example/x.js", "https://verticopolis.com", "../index.html", "#top", "verticopolis_engine/index.html"]) {
      expect(rebaseLink(link, base), link).toBe(link);
    }
  });

  it("rebases href, src and srcset in a page and marks it noindex once", () => {
    const html =
      '<html><head><title>x</title></head><body><a href="/javascript/">JS</a> <img src=\'/favicon.png\' srcset="/a.png 1x, /pr-preview/pr-12/b.png 2x">' +
      '<a href="https://github.com/maniator/verticopolis">GitHub</a></body></html>';
    const page = rebaseHtml(html, base);
    expect(page).toContain('<head><meta name="robots" content="noindex"><title>');
    expect(page).toContain('href="/pr-preview/pr-12/javascript/"');
    expect(page).toContain("src='/pr-preview/pr-12/favicon.png'");
    expect(page).toContain('srcset="/pr-preview/pr-12/a.png 1x, /pr-preview/pr-12/b.png 2x"');
    expect(page).toContain('href="https://github.com/maniator/verticopolis"');
    expect(rebaseHtml(page, base)).toBe(page);
  });

  it("moves the Rust API reference's header and menu links", () => {
    const { before } = chrome("main");
    const moved = rebaseHtml(before, base);
    expect(moved).toContain('href="/pr-preview/pr-12/crate/"');
    expect(moved).toContain('src="/pr-preview/pr-12/favicon.png"');
    expect(moved).not.toMatch(/(?:href|src)="\/(?!pr-preview\/pr-12\/)/);
  });
});
