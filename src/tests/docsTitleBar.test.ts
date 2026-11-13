import { describe, expect, it } from "vitest";
import { GAME, GITHUB, barLinks, siteName, twoLengths } from "../../docs/engine-site/title-bar.mjs";
import { SHORT_TITLE } from "../../docs/engine-site/site.mjs";
import { chrome } from "../../docs/engine-site/scripts/rustdoc-chrome.mjs";

/**
 * The title bar the help site, the engine docs and the Rust API reference
 * share (`docs/engine-site/title-bar.mjs`). Both Starlight sites draw it
 * through `TitleBar.astro`; the Rust API reference gets the same markup from
 * `scripts/rustdoc-chrome.mjs`. These check the markup each one is handed.
 */
describe("the docs title bar", () => {
  it("writes a label in full and in its phone length, the short one hidden from screen readers", () => {
    expect(twoLengths("Verticopolis Help", "Help")).toBe(
      '<span class="vc-full">Verticopolis Help</span><span class="vc-short" aria-hidden="true">Help</span>',
    );
  });

  it("escapes the site's name", () => {
    const html = siteName('Tower <"one"> & two', "T&T");
    expect(html).toContain("Tower &lt;&quot;one&quot;&gt; &amp; two");
    expect(html).toContain("T&amp;T");
    expect(html).not.toContain("<\"one\">");
  });

  it("links the game and GitHub, with the game button marked for the help site's Back to game", () => {
    const html = barLinks();
    expect(html).toContain(`<a class="vc-bar-game" href="${GAME}" data-game-link>`);
    expect(html).toContain(twoLengths("Play the game", "Play"));
    expect(html).toContain(`<a class="vc-bar-github" href="${GITHUB}">`);
    expect(html).toContain('<span class="vc-sr-only">GitHub</span>');
  });

  it("points the game button where a site asks", () => {
    expect(barLinks({ game: "/" })).toContain('<a class="vc-bar-game" href="/" data-game-link>');
  });

  it("is the Rust API reference's title bar too", () => {
    const { before, after, head } = chrome("main");
    expect(before).toContain(siteName("Verticopolis engine", SHORT_TITLE));
    expect(before).toContain(barLinks());
    // A phone has no room for GitHub in the bar, so the site menu ends with it.
    expect(before).toMatch(/<li class="vc-top vc-menu-github"><a href="https:\/\/github\.com\/maniator\/verticopolis">GitHub<\/a><\/li><\/ul><\/nav>/);
    // The bar's styles ride in the page head with the rest of the theme.
    expect(head).toContain(".vc-bar-game");
    // On a phone the bar folds into rustdoc's own top bar.
    expect(after).toContain('querySelector("rustdoc-topbar")');
    expect(after).toContain('classList.add("vc-one-bar")');
  });
});
