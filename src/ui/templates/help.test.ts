import { describe, it, expect, vi } from "vitest";
import { helpTemplate } from "./help";
import { helpPrivacyBody } from "./helpContent";
import { renderToFragment, click } from "../testing/litTestUtils";
import { MODERN_RULES } from "../../engine/ruleSets";
import type { GameRules } from "../../engine/gameRules";

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

  it("offers the full-page link in a browser build, external and deep-linked", () => {
    // IS_WRAPPED_BUILD is false under vitest (the mode is "test"), so this is
    // the browser-build shape. The wrapped-build twin, where the anchor must be
    // withheld entirely, lives in helpWrappedLink.test.ts with the constant
    // mocked true (#720).
    const frag = renderToFragment(helpTemplate(false, "1.2.3", noop));
    const a = frag.querySelector<HTMLAnchorElement>('a[data-act="open-help"]')!;
    expect(a, "expected the Open full page link in a browser build").not.toBeNull();
    expect(a.getAttribute("href")).toBe("/help#classic-vs-modern");
    expect(a.getAttribute("target")).toBe("_blank");
    expect(a.getAttribute("rel")).toBe("noopener noreferrer");
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
    for (const collapsed of ["Going further", "Keyboard play", "Classic vs Modern", "About", "Privacy"]) {
      const sec = sectionBySummary(frag, collapsed);
      expect(sec, collapsed).not.toBeUndefined();
      expect(sec!.hasAttribute("open"), collapsed).toBe(false);
    }
  });

  it("carries the Privacy section rendered from the one shared body", () => {
    const frag = renderToFragment(helpTemplate(false, "1.2.3", noop));
    const privacy = sectionBySummary(frag, "Privacy");
    expect(privacy, "the Privacy details section must exist").not.toBeUndefined();
    // Whitespace-normalized containment of the SHARED body's own rendered text:
    // this surface cannot fork the promise, because any wording change must
    // arrive through helpPrivacyBody or this containment fails.
    const norm = (s: string) => s.replace(/\s+/g, " ").trim();
    const shared = norm(renderToFragment(helpPrivacyBody()).textContent ?? "");
    expect(shared.length).toBeGreaterThan(100);
    expect(norm(privacy!.textContent ?? "")).toContain(shared);
  });

  // Drift guard. Every member of the GameRules seam is mapped either to a DISTINCT
  // phrase the "Classic vs Modern" Help copy must contain, or to null when it
  // carries no dedicated player-facing copy (a load-only sanitizer, an internal
  // tuning knob, a UI-only affordance, or a same-direction shape difference not
  // called out in this section). Phrases are per-rule and distinct, so deleting
  // one bullet cannot pass on a phrase another rule happens to share.
  //
  // The PRIMARY guard is the compile-time type: `Record<keyof GameRules, ...>`
  // forces this literal to name every rule, so adding a Modern divergence to the
  // GameRules interface breaks `npm run typecheck` at this line until it is
  // classified (this is what would have caught the hotel late-checkout shipping
  // with no copy). The runtime test below is only a PARTIAL backstop for the
  // transpile-only test path (`npm test` does not type-check): it catches one
  // case, a member present in MODERN_RULES but missing from RULE_TO_HELP. It does
  // NOT detect an interface-only addition (a member added to GameRules but not to
  // MODERN_RULES); typecheck owns that, where MODERN_RULES would itself fail to
  // satisfy GameRules.
  const RULE_TO_HELP: Record<keyof GameRules, string | null> = {
    mode: null, // identity, not a divergence
    hasVariantHouseholds: "Variant households",
    sellCondo: "sets the sale price", // the 2-5 family draw scales the price
    showsPreviewReason: "Hovering an invalid spot",
    allowsEscalatorOnOfficeFloors: "Escalators can serve office floors",
    walkwayWillingnessApplies: "Longer climbs", // Classic refuses a climb past a few flights, Modern lets people climb any number (#384/#503/#509); the "Longer climbs" compare bullet documents the divergence (#502)
    priceOptions: "Continuous pricing",
    condoRelocationChance: "move out on its own",
    operatingOverheadPerUnit: "monthly overhead",
    condoHoldTaxRate: "unsold condos are taxed",
    noiseErosionScale: "noisy office neighbor",
    unmetDemandDrain: "too few reachable shops",
    infestationRecovery: "paid exterminator",
    weekendMultiplier: "weekdays and weekends",
    demographicRoutines: "leave for school and return",
    rainCrowdFactor: "rain thins the crowd",
    hotelDaytimePresence: "linger past checkout", // #304, the late-checkout lunch trip
    elevatorScheduleUX: "Smarter scheduling", // #305, presets + auto-tune + advice vs the raw grid
    quarterlyRentScale: "full 1994 rent lump", // Classic collects the full canon lump each 3-day quarter; Modern smooths per-day income across its calendar choice (spec-classic-economy-canon-cadence)
    // No dedicated player-facing copy (folded, internal, load-only, or UI-only):
    coerceResidents: null, // load-only household sanitizer
    coerceNoRate: null, // load-only No-Rate sanitizer
    churnMultiplier: null, // internal variant-household churn tuning
    housekeepingShift: null, // internal maid-shift window
    housekeepingTriage: null, // internal maid dispatch order
    demandModel: null, // internal commercial-demand magnitudes
    commercialDailyIncome: null, // internal commercial headline magnitudes (#572), same species as demandModel
    lobbyDistanceDrain: null, // subtle band-vs-continuous shape of the lobby-distance pressure
    fitnessHaloBonus: null, // Modern amenity halo; a subtle satisfaction nudge, no dedicated Help copy
    nightclubNoisePenalty: null, // Modern nightclub negative halo; covered by the "new places" copy, no dedicated seam line
    spaSerenityBonus: null, // Modern spa positive halo for hotels; covered by the "new places" copy, no dedicated seam line
    viewPremium: null, // Modern sky bar height-scaled income; covered by the "new places" copy, no dedicated seam line
    daycareFamilyBonus: null, // Modern daycare family-scaled condo halo; covered by the "new places" copy, no dedicated seam line
    bridgingToggleable: null, // Modern build affordance surfaced in New Tower + Settings, not a "Classic vs Modern" compare bullet
  };

  it("classifies every MODERN_RULES member for Help copy (test-path backstop only)", () => {
    // Partial backstop for the transpile-only test path (esbuild strips the
    // Record type): fails only when a member present in MODERN_RULES is missing
    // from RULE_TO_HELP. An interface-only addition is caught by typecheck, not
    // here. Enumerate the live implementation's own keys (MODERN_RULES is a plain
    // object literal, so Object.keys sees all of them).
    for (const member of Object.keys(MODERN_RULES)) {
      expect(
        RULE_TO_HELP,
        `GameRules.${member} is unclassified: add it to RULE_TO_HELP in help.test.ts with a Help phrase, or null if it carries no player-facing "Classic vs Modern" copy.`,
      ).toHaveProperty(member);
    }
  });

  it("maps each rule to a DISTINCT phrase so a deleted bullet cannot pass on a shared one", () => {
    // The copy-sync check below is per-rule substring matching. If two rules
    // shared a phrase, deleting one bullet could still pass on the other rule's
    // match, hiding the drift. Assert uniqueness so the per-rule guard holds.
    const phrases = Object.values(RULE_TO_HELP).filter((p): p is string => p !== null);
    expect(new Set(phrases).size, "RULE_TO_HELP has duplicate phrases; give each rule a distinct substring").toBe(
      phrases.length,
    );
  });

  it("keeps the Classic vs Modern copy in sync with every mapped divergence", () => {
    const frag = renderToFragment(helpTemplate(false, "1.2.3", noop));
    const text = sectionBySummary(frag, "Classic vs Modern")!.textContent ?? "";
    for (const [member, phrase] of Object.entries(RULE_TO_HELP)) {
      if (phrase !== null) {
        expect(text, `Help copy is missing the phrase for GameRules.${member}: "${phrase}"`).toContain(phrase);
      }
    }
    // The Classic-fidelity report call-out is not a rule, but it anchors the
    // section's parity-pride framing, so pin it too.
    expect(text).toContain("pixel-faithful to 1994");
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
