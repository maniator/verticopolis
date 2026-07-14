import { describe, it, expect, vi } from "vitest";
import { eventChoiceHtml } from "../uiTemplates";
import { eventChoiceTemplate } from "./eventChoice";
import { renderToFragment, assertDomEquivalent, click } from "../testing/litTestUtils";

/**
 * The emergency event-choice dialog. Its per-aspect package: a semantic structure
 * check, the inline `@click` dispatch (accept/decline), hostile input rendered as
 * text (lit auto-escape), and the transitional `assertDomEquivalent` guard against
 * `eventChoiceHtml`. The live single-resolve behavior across all four dismissal
 * paths (buttons, Esc, backdrop, x) lives in the controller and is pinned by
 * `uiDialogs.integration.test.ts`.
 */

const noop = { onAccept: () => {}, onDecline: () => {} };

describe("eventChoiceTemplate structure", () => {
  it("renders the emergency heading, message, and a two-button actions row", () => {
    const frag = renderToFragment(eventChoiceTemplate("A fire has broken out!", "$50,000", noop));
    expect(frag.querySelector("h2")?.textContent).toBe("⚠️ Emergency");
    expect(frag.querySelector("p")?.textContent).toBe("A fire has broken out!");
    expect(frag.querySelectorAll(".modal-actions button")).toHaveLength(2);
  });

  it("Accept is the primary and reads 'Pay <cost>'; Decline is secondary", () => {
    const frag = renderToFragment(eventChoiceTemplate("Bomb threat!", "$100,000", noop));
    const accept = frag.querySelector('[data-act="accept"]')!;
    const decline = frag.querySelector('[data-act="decline"]')!;
    expect(accept.textContent).toBe("Pay $100,000");
    // Pin the FULL class set (not just contains) so a stray extra class is caught.
    expect([...accept.classList].sort()).toEqual(["btn", "primary"]);
    expect(decline.textContent).toBe("Decline");
    expect([...decline.classList]).toEqual(["btn"]);
    // NOTE: this reads the bare template. In a live mount, finishModal appends the
    // title-bar close INTO the top-level h2, so the mounted h2.textContent differs.
  });

  it("renders no [data-act=close] button (the x closes via the cancel path)", () => {
    const frag = renderToFragment(eventChoiceTemplate("T", "$1", noop));
    expect(frag.querySelector('[data-act="close"]')).toBeNull();
  });
});

describe("eventChoiceTemplate inline actions", () => {
  it("Accept dispatches onAccept, not onDecline", () => {
    const onAccept = vi.fn();
    const onDecline = vi.fn();
    const frag = renderToFragment(eventChoiceTemplate("T", "$1", { onAccept, onDecline }));
    click(frag.querySelector('[data-act="accept"]')!);
    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(onDecline).not.toHaveBeenCalled();
  });

  it("Decline dispatches onDecline, not onAccept", () => {
    const onAccept = vi.fn();
    const onDecline = vi.fn();
    const frag = renderToFragment(eventChoiceTemplate("T", "$1", { onAccept, onDecline }));
    click(frag.querySelector('[data-act="decline"]')!);
    expect(onDecline).toHaveBeenCalledTimes(1);
    expect(onAccept).not.toHaveBeenCalled();
  });
});

describe("eventChoiceTemplate escapes interpolated copy as text", () => {
  it("renders hostile message markup as literal text, injecting no element", () => {
    const hostile = `<img src=x onerror="alert(1)">`;
    const frag = renderToFragment(eventChoiceTemplate(hostile, "$1", noop));
    expect(frag.querySelector("img")).toBeNull();
    expect(frag.querySelector("p")?.textContent).toBe(hostile);
  });

  it("escapes hostile costLabel too (it lands in the primary button as text)", () => {
    const hostile = `<b>free</b>`;
    const frag = renderToFragment(eventChoiceTemplate("T", hostile, noop));
    expect(frag.querySelector('[data-act="accept"] b')).toBeNull();
    expect(frag.querySelector('[data-act="accept"]')?.textContent).toBe(`Pay ${hostile}`);
  });
});

describe("eventChoiceTemplate matches the legacy eventChoiceHtml structure", () => {
  it("assertDomEquivalent holds for a real multi-word message (the transitional guard)", () => {
    expect(() =>
      assertDomEquivalent(eventChoiceHtml("A fire has broken out!", "$50,000"), eventChoiceTemplate("A fire has broken out!", "$50,000", noop)),
    ).not.toThrow();
  });

  it("holds for a message with an apostrophe and emoji (the production input class)", () => {
    // The real EventSystem messages carry apostrophes/emoji but no HTML entities,
    // so the legacy raw interpolation and lit's escaping still agree.
    const msg = "Your tower's sprinklers failed! 🔥";
    expect(() =>
      assertDomEquivalent(eventChoiceHtml(msg, "$12,500"), eventChoiceTemplate(msg, "$12,500", noop)),
    ).not.toThrow();
  });

  it("holds at the boundary: empty message and cost", () => {
    expect(() => assertDomEquivalent(eventChoiceHtml("", ""), eventChoiceTemplate("", "", noop))).not.toThrow();
  });
});
