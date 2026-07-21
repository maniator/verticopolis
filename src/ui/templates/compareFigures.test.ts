import { describe, it, expect } from "vitest";
import { compareFigures } from "./compareFigures";
import { renderToFragment } from "../testing/litTestUtils";

/**
 * The `/help` page's paired Classic vs Modern stills. The shortlisted
 * divergences that read as a visual pair render as Modern-beside-Classic figures
 * with real captures; the frameless divergences are left to the guide text above
 * the section, not repeated as image-less cards.
 */
describe("compareFigures", () => {
  it("renders a Modern-and-Classic image pair for each shortlisted divergence", () => {
    const frag = renderToFragment(compareFigures());
    const figures = [...frag.querySelectorAll("figure.compare-figure")];
    const withImages = figures.filter((f) => f.querySelector("img"));
    // Four visual pairs today; each pair is exactly two shots (Modern, Classic).
    expect(withImages.length).toBe(4);
    for (const fig of withImages) {
      const imgs = [...fig.querySelectorAll("img")];
      expect(imgs.length).toBe(2);
      // Every capture is lazy-loaded and carries alt text and a real src.
      for (const img of imgs) {
        expect(img.getAttribute("loading")).toBe("lazy");
        expect(img.getAttribute("alt")).toBeTruthy();
        expect(img.getAttribute("src")).toBeTruthy();
      }
      const labels = [...fig.querySelectorAll(".compare-shot-label")].map((l) => l.textContent);
      expect(labels).toEqual(["Modern", "Classic"]);
    }
  });

  it("labels each pair with its divergence and a shared caption", () => {
    const frag = renderToFragment(compareFigures());
    const titles = [...frag.querySelectorAll(".compare-figure-title")].map((t) => t.textContent);
    expect(titles).toContain("Founding a tower");
    expect(titles).toContain("Pricing a unit");
    expect(titles).toContain("Elevator scheduling");
    expect(titles).toContain("Tenancy and economy");
    for (const fig of frag.querySelectorAll("figure.compare-figure")) {
      expect((fig.querySelector(".compare-figure-note")?.textContent?.length ?? 0) > 0).toBe(true);
    }
  });

  it("shows only visual pairs (no image-less cards that would repeat the guide text)", () => {
    const frag = renderToFragment(compareFigures());
    // Every figure carries an image pair; frameless divergences are covered by
    // the guide text above the section, not repeated here.
    for (const fig of frag.querySelectorAll("figure.compare-figure")) {
      expect(fig.querySelectorAll("img").length).toBe(2);
    }
  });
});
