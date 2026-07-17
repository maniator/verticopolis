import { describe, it, expect, vi } from "vitest";
import { helpTemplate } from "./help";
import { renderToFragment, click } from "../testing/litTestUtils";

/**
 * The Help / How-to-play dialog. Package: the semantic structure and a11y hooks
 * (the splash-gated Replay button, the external report link with rel=noopener and
 * its visually-hidden span, the autofocus primary), the inline Replay `@click`
 * dispatch, and the version auto-escape. The report-link routing through
 * the platform wrapper and the Close action live in the controller and are pinned
 * by the showHelp integration tests.
 */

const noop = { onReplay: () => {} };

/** Find a collapsible Help section by its <summary> text. */
function sectionBySummary(frag: DocumentFragment, summary: string): HTMLDetailsElement | undefined {
  return [...frag.querySelectorAll<HTMLDetailsElement>("details.help-modes")].find(
    (d) => d.querySelector("summary")?.textContent?.trim() === summary,
  );
}

describe("helpTemplate structure and a11y", () => {
  it("renders the heading and the primary Got it with autofocus", () => {
    const frag = renderToFragment(helpTemplate(false, "1.2.3", noop));
    expect(frag.querySelector("h2")?.textContent).toBe("How to play");
    const got = frag.querySelector<HTMLButtonElement>('[data-act="close"]')!;
    expect(got.textContent).toBe("Got it");
    expect([...got.classList].sort()).toEqual(["btn", "primary"]);
    expect(got.hasAttribute("autofocus")).toBe(true);
  });

  it("keeps the report link external and screen-reader labeled", () => {
    const frag = renderToFragment(helpTemplate(false, "1.2.3", noop));
    const a = frag.querySelector<HTMLAnchorElement>(".help-report a")!;
    expect(a.getAttribute("target")).toBe("_blank");
    expect(a.getAttribute("rel")).toBe("noopener noreferrer");
    expect(a.getAttribute("href")).toContain("github.com/maniator/verticopolis/issues");
    expect(a.querySelector(".visually-hidden")?.textContent).toBe(" (opens GitHub in a new tab)");
  });

  it("interpolates the app version into the About line", () => {
    const frag = renderToFragment(helpTemplate(false, "9.9.9", noop));
    expect(frag.textContent).toContain("Verticopolis v9.9.9");
  });

  it("opens on the essentials and collapses the reference sections", () => {
    // Cloud's IA rule: essentials open, reference-or-optional collapsed. "The
    // basics" is the only section open on first paint; Going further, Keyboard
    // play, Classic vs Modern, and About are all collapsed so Help opens short.
    const frag = renderToFragment(helpTemplate(false, "1.2.3", noop));
    expect(sectionBySummary(frag, "The basics")?.hasAttribute("open")).toBe(true);
    for (const collapsed of ["Going further", "Keyboard play", "Classic vs Modern", "About"]) {
      const sec = sectionBySummary(frag, collapsed);
      expect(sec, collapsed).not.toBeUndefined();
      expect(sec!.hasAttribute("open"), collapsed).toBe(false);
    }
  });

  it("covers every Modern divergence from gameRules, not just the headline three", () => {
    // Guards against Help drifting out of date as Modern gains behaviors. Each
    // phrase maps to a divergence in src/engine/gameRules.ts.
    const frag = renderToFragment(helpTemplate(false, "1.2.3", noop));
    const text = sectionBySummary(frag, "Classic vs Modern")!.textContent ?? "";
    for (const phrase of [
      "Variant households", // hasVariantHouseholds / sellCondo
      "move out on its own", // condoRelocationChance
      "deeper economy", // overhead / tax / noise erosion / unmet demand
      "Continuous pricing", // priceOptions (continuous vs 4-rung + No Rate)
      "Escalators can serve office floors", // allowsEscalatorOnOfficeFloors
      "switch elevators at any shared stop", // expressTransferNeedsLobby
      "paid exterminator", // infestationRecovery
      "Hovering an invalid spot", // showsPreviewReason
      "school", // demographicRoutines
      "Calendar pace", // calendar choice
      "pixel-faithful to 1994", // the Classic-fidelity report call-out
    ]) {
      expect(text).toContain(phrase);
    }
  });
});

describe("helpTemplate Replay button, gated on the splash", () => {
  it("is enabled with no title off the splash, and dispatches onReplay", () => {
    const onReplay = vi.fn();
    const frag = renderToFragment(helpTemplate(false, "1.2.3", { onReplay }));
    const replay = frag.querySelector<HTMLButtonElement>('[data-act="replay-onboard"]')!;
    expect(replay.disabled).toBe(false);
    expect(replay.hasAttribute("title")).toBe(false);
    click(replay);
    expect(onReplay).toHaveBeenCalledTimes(1);
  });

  it("is disabled with an explaining title while the splash is up", () => {
    const onReplay = vi.fn();
    const frag = renderToFragment(helpTemplate(true, "1.2.3", { onReplay }));
    const replay = frag.querySelector<HTMLButtonElement>('[data-act="replay-onboard"]')!;
    expect(replay.disabled).toBe(true);
    expect(replay.getAttribute("title")).toBe("Start a tower first, then you can replay the intro.");
  });
});

describe("helpTemplate escapes the interpolated version as text", () => {
  it("renders a hostile version string as literal text, injecting no element", () => {
    const hostile = `<img src=x onerror="alert(1)">`;
    const frag = renderToFragment(helpTemplate(false, hostile, noop));
    expect(frag.querySelector("img")).toBeNull();
    expect(frag.textContent).toContain(`Verticopolis v${hostile}`);
  });
});
