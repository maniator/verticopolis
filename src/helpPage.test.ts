import { describe, it, expect } from "vitest";
import { helpPageTemplate } from "./helpPage";
import { renderToFragment } from "./ui/testing/litTestUtils";

/**
 * The standalone `/help` page body. It must render the SAME shared
 * `compareTemplate()` the in-game surfaces render (so the copy has one source
 * and can never drift), inside the retro page shell with a working "Back to
 * game" anchor. Importing this module runs its `main()` once, which no-ops in the
 * test DOM (no `#app`), so the pure `helpPageTemplate()` is what we assert on.
 */
describe("helpPageTemplate", () => {
  it("renders the shared comparison body (divergence phrases + the closer)", () => {
    const frag = renderToFragment(helpPageTemplate());
    const text = frag.textContent ?? "";
    // Signature phrases from the shared compareTemplate: if this page forked the
    // copy instead of importing it, these would drift.
    expect(text).toContain("Variant households");
    expect(text).toContain("Continuous pricing");
    expect(text).toContain("Smarter scheduling");
    expect(text).toContain("pixel-faithful to 1994");
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

  it("leads with the page heading", () => {
    const frag = renderToFragment(helpPageTemplate());
    expect(frag.querySelector("h1")?.textContent).toContain("Classic vs Modern");
  });

  it("carries a report call to action in the footer", () => {
    const frag = renderToFragment(helpPageTemplate());
    const report = frag.querySelector<HTMLAnchorElement>('a[href*="issues/new"]');
    expect(report).not.toBeNull();
    expect(report!.getAttribute("target")).toBe("_blank");
    expect(report!.getAttribute("rel")).toBe("noopener noreferrer");
  });
});
