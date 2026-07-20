import { describe, it, expect } from "vitest";
import { helpPageTemplate } from "./helpPage";
import { renderToFragment } from "./ui/testing/litTestUtils";
import { HELP_SECTIONS } from "./ui/templates/helpContent";

/**
 * The standalone `/help` page body: the full how-to-play guide. It renders the
 * SAME shared `HELP_SECTIONS` the in-game Help modal renders (so the copy has one
 * source and can never drift), inside the retro page shell with a working "Back
 * to game" anchor. Importing this module runs its `main()` once, which no-ops in
 * the test DOM (no `#app`), so the pure `helpPageTemplate()` is what we assert on.
 */
describe("helpPageTemplate", () => {
  it("leads with the How to Play heading", () => {
    const frag = renderToFragment(helpPageTemplate());
    expect(frag.querySelector("h1")?.textContent).toContain("How to Play");
  });

  it("renders every shared guide section, each under an anchored heading", () => {
    const frag = renderToFragment(helpPageTemplate());
    for (const s of HELP_SECTIONS) {
      const section = frag.querySelector(`section#${s.id}`);
      expect(section, `missing section #${s.id}`).not.toBeNull();
      expect(section!.querySelector("h2")?.textContent).toBe(s.title);
    }
    // The About section is on the page too.
    expect(frag.querySelector("section#about h2")?.textContent).toBe("About");
  });

  it("carries the Classic vs Modern comparison as a deep-linkable section", () => {
    const frag = renderToFragment(helpPageTemplate());
    const compare = frag.querySelector("section#classic-vs-modern");
    expect(compare, "the comparison must be its own #classic-vs-modern section").not.toBeNull();
    const text = compare!.textContent ?? "";
    // Signature phrases from the shared compareTemplate: if this page forked the
    // copy instead of importing it, these would drift.
    expect(text).toContain("Variant households");
    expect(text).toContain("Continuous pricing");
    expect(text).toContain("Smarter scheduling");
    expect(text).toContain("pixel-faithful to 1994");
  });

  it("renders the basics and keyboard help from the shared source", () => {
    const frag = renderToFragment(helpPageTemplate());
    expect(frag.querySelector("section#basics")?.textContent).toContain("Floors first");
    // The keyboard section carries real <kbd> keys.
    expect(frag.querySelectorAll("section#keyboard kbd").length).toBeGreaterThan(0);
  });

  it("carries a real 'Back to game' anchor to the game root", () => {
    const frag = renderToFragment(helpPageTemplate());
    const backs = [...frag.querySelectorAll<HTMLAnchorElement>('a[href="/"]')];
    // The shell renders it twice (title bar + footer); both point at "/".
    expect(backs.length).toBeGreaterThanOrEqual(1);
    for (const a of backs) expect(a.textContent).toContain("Back to game");
  });

  it("links to the sibling sprite gallery at the clean /gallery URL", () => {
    const frag = renderToFragment(helpPageTemplate());
    const gallery = frag.querySelector<HTMLAnchorElement>('a[href="/gallery"]');
    expect(gallery).not.toBeNull();
    expect(gallery!.textContent).toContain("Sprite Gallery");
  });

  it("carries a report call to action linking out to GitHub", () => {
    const frag = renderToFragment(helpPageTemplate());
    const report = frag.querySelector<HTMLAnchorElement>('a[href*="issues/new"]');
    expect(report).not.toBeNull();
    expect(report!.getAttribute("target")).toBe("_blank");
    expect(report!.getAttribute("rel")).toBe("noopener noreferrer");
  });
});
