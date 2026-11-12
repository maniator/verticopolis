import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { NOT_FOUND_LINKS, notFoundPageTemplate } from "./notFoundPage";
import { renderToFragment } from "./ui/testing/litTestUtils";

/**
 * The site's "page not found" page (`404.html`). Importing the module runs its
 * `main()` once, which no-ops in the test DOM (no `#app`), so the pure
 * template is what these assert on.
 */

describe("notFoundPageTemplate", () => {
  it("says the page was not found and names the missing address as text", () => {
    const frag = renderToFragment(notFoundPageTemplate("/help/<b>nope</b>"));
    expect(frag.querySelector("h1")?.textContent).toBe("Page not found");
    const code = frag.querySelector(".page-lede code");
    expect(code?.textContent).toBe("/help/<b>nope</b>");
    expect(code?.querySelector("b")).toBeNull();
  });

  it("links to the game and to each standalone page", () => {
    const frag = renderToFragment(notFoundPageTemplate("/x"));
    const links = [...frag.querySelectorAll<HTMLAnchorElement>(".page-links a.btn")];
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["/", "/help", "/help/changelog", "/gallery"]);
    expect(links[0].classList.contains("primary")).toBe(true);
    expect(NOT_FOUND_LINKS.map((l) => l.href)).toEqual(["/help", "/help/changelog", "/gallery"]);
  });

  it("frames the page in the retro shell with Back to game pointing at the game", () => {
    const frag = renderToFragment(notFoundPageTemplate("/x"));
    expect(frag.querySelector(".page-win .win-title")?.textContent).toContain("Page not found");
    const back = [...frag.querySelectorAll('[data-act="back-to-game"]')];
    expect(back.length).toBeGreaterThan(0);
    for (const a of back) expect(a.getAttribute("href")).toBe("/");
    expect(frag.querySelector("#back-note")).toBeNull();
    // The title bar holds only Back to game, so it fits a phone screen.
    expect([...frag.querySelectorAll(".page-nav a")].map((a) => a.getAttribute("href"))).toEqual(["/"]);
  });

  it("closes the tab on Back to game when the game opened it", () => {
    const frag = renderToFragment(notFoundPageTemplate("/x", true));
    expect(frag.querySelector("#back-note")).not.toBeNull();
    const close = vi.spyOn(window, "close").mockImplementation(() => {});
    try {
      const click = new MouseEvent("click", { cancelable: true, bubbles: true });
      frag.querySelector('a[data-act="back-to-game"]')!.dispatchEvent(click);
      expect(click.defaultPrevented).toBe(true);
      expect(close).toHaveBeenCalledTimes(1);
    } finally {
      close.mockRestore();
    }
  });
});

describe("404.html", () => {
  const page = readFileSync(resolve(__dirname, "404.html"), "utf8");

  it("resolves its relative asset URLs from the site root, so it works at any depth", () => {
    // The build writes "./assets/..." (base "./"); served at /help/a/b they
    // would point into /help/a/ without the base element, first in the head.
    const head = page.slice(page.indexOf("<head>"), page.indexOf("</head>"));
    expect(head).toMatch(/^<head>\s*(<!--[\s\S]*?-->\s*)?<base href="\/" \/>/);
  });

  it("is not indexed", () => {
    expect(page).toContain('<meta name="robots" content="noindex" />');
  });
});
