import { describe, expect, it } from "vitest";
import { GAME, GITHUB, barLinks, siteName, twoLengths } from "../../help-site/title-bar.mjs";

/**
 * The help site's title bar (`help-site/title-bar.mjs`), which
 * `TitleBar.astro` draws. These check the markup it is handed.
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
    expect(html).not.toContain('<"one">');
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
});
