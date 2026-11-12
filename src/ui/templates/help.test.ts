import { describe, it, expect, vi } from "vitest";
import { helpTemplate } from "./help";
import { HELP_SECTIONS, helpPrivacyBody } from "./helpContent";
import { renderToFragment, click } from "../testing/litTestUtils";
import type { CatalogRules } from "../../catalog/catalogTypes";
import { catalogFor } from "../../tests/catalogFixture";

/**
 * The Help / How-to-play dialog. Package: the semantic structure and a11y hooks
 * (the splash-gated Replay button, the external report link with rel=noopener and
 * its visually-hidden span, the autofocus primary), the inline Replay `@click`
 * dispatch, and the version auto-escape. The Close action lives in the
 * controller and is pinned by the showHelp integration tests.
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

  it("offers the full-page link, external and deep-linked", () => {
    const frag = renderToFragment(helpTemplate(false, "1.2.3", noop));
    const a = frag.querySelector<HTMLAnchorElement>('a[data-act="open-help"]')!;
    expect(a, "expected the Open full page link").not.toBeNull();
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

  it("says what the engine reliability rows report", () => {
    const text = (renderToFragment(helpPrivacyBody()).textContent ?? "").replace(/\s+/g, " ");
    expect(text).toContain("whether you started playing, and a short code if the engine stopped. None of it identifies you.");
    expect(text).not.toContain("test group");
  });

  it("tells players what happens if the game engine stops, and offers no engine choice", () => {
    const text = HELP_SECTIONS.map((s) => renderToFragment(s.body()).textContent ?? "").join(" ").replace(/\s+/g, " ");
    expect(text).toContain("If the game engine crashes, the game reloads your tower from its last autosave.");
    expect(text).toContain("Your saves stay on your device, and Reload tries again.");
    expect(text).not.toContain("Game engine");
  });

  // Drift guard. Each Classic vs Modern divergence the player can notice maps
  // to a DISTINCT phrase the "Classic vs Modern" Help copy must contain.
  // Phrases are per-rule and distinct, so deleting one bullet cannot pass on a
  // phrase another rule happens to share.
  //
  // The mode rules the Rust engine publishes in its catalog (`CatalogRules`)
  // are keyed by their catalog names, and the `Record<keyof CatalogRules, ...>`
  // type makes this literal name each one, so a new catalog rule breaks
  // `npm run typecheck` here until it is classified (a phrase, or null for a
  // rule with no player-facing compare bullet). The runtime test below is the
  // backstop for the transpile-only test path: it reads the catalog fixture's
  // own rule keys. The other entries are the divergences the engine draws
  // without a catalog rule, named as the Help copy names them.
  const CATALOG_RULE_TO_HELP: Record<keyof CatalogRules, string | null> = {
    variantHouseholds: "Variant households",
    previewNamesRefusal: "Hovering an invalid spot",
    scheduleAssist: "Smarter scheduling", // #305, presets + auto-tune + advice vs the raw grid
    buildsWhilePaused: "Build while paused", // #1936, Classic refuses placement at speed 0
    exportsTo1994: null, // the export dialog explains it where the choice is disabled
    quotesLobbyDistance: null, // a wording detail of the tenant card's lobby warning
  };
  const RULE_TO_HELP: Record<string, string | null> = {
    ...CATALOG_RULE_TO_HELP,
    sellCondo: "sets the sale price", // the 2-5 family draw scales the price
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
    quarterlyRentScale: "full 1994 rent lump", // Classic collects the full canon lump each 3-day quarter; Modern smooths per-day income across its calendar choice (spec-classic-economy-canon-cadence)
  };

  it("classifies every mode rule the engine's catalog publishes (test-path backstop)", () => {
    for (const mode of ["classic", "modern"] as const) {
      for (const rule of Object.keys(catalogFor(mode).rules)) {
        expect(
          CATALOG_RULE_TO_HELP,
          `catalog rule ${rule} is unclassified: add it to CATALOG_RULE_TO_HELP in help.test.ts with a Help phrase, or null if it carries no player-facing "Classic vs Modern" copy.`,
        ).toHaveProperty(rule);
      }
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
        expect(text, `Help copy is missing the phrase for ${member}: "${phrase}"`).toContain(phrase);
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

describe("helpTemplate engine diagnostics (#963)", () => {
  const report = {
    state: "ok" as const,
    summary: "The Rust engine is running and matches this build.",
    rows: [{ label: "Engine crate", value: "example-engine 9.8.7" }],
    text: "Verticopolis diagnostics",
  };

  it("renders the report and a Copy diagnostics button inside About", () => {
    const frag = renderToFragment(helpTemplate(false, "1.2.3", noop, "", report));
    const about = sectionBySummary(frag, "About")!;
    const block = about.querySelector(".help-diagnostics")!;
    expect(block.getAttribute("data-state")).toBe("ok");
    expect(block.querySelector("dt")?.textContent).toBe("Engine crate");
    expect(block.querySelector("dd")?.textContent).toBe("example-engine 9.8.7");
    expect(block.querySelector('[data-act="copy-diagnostics"]')?.textContent?.trim()).toBe("Copy diagnostics");
    expect(block.querySelector(".help-diagnostics-status")?.getAttribute("role")).toBe("status");
  });

  it("renders no block when no report is passed", () => {
    const frag = renderToFragment(helpTemplate(false, "1.2.3", noop));
    expect(frag.querySelector(".help-diagnostics")).toBeNull();
  });
});


describe("the guide's wedding hall copy (#1987)", () => {
  // The guide is prerendered without a tower, so it words the standard lot.
  // It must agree with what both catalogs state; a lot whose top moves (the
  // Tall lot, #1983) needs its own line here.
  it("stands the hall on the top floor and at the size both catalogs state", () => {
    const text = renderToFragment(helpTemplate(false, "1.2.3", noop)).textContent ?? "";
    const words: Record<number, string> = { 5: "five" };
    for (const mode of ["classic", "modern"] as const) {
      const catalog = catalogFor(mode);
      const hall = catalog.facilities.find((f) => f.key === "weddingHall")!;
      const top = catalog.world.maxFloor;
      expect(text, mode).toContain(`floor-${top} payoff`);
      expect(text, mode).toContain(`(${hall.width} tiles wide and ${words[hall.floors]} floors tall) on floor ${top}`);
    }
  });
});
