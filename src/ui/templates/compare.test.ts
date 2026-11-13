import { describe, it, expect, vi, afterEach } from "vitest";
import { compareTemplate } from "./compare";
import { renderToFragment } from "../testing/litTestUtils";
import type { CatalogRules } from "../../catalog/catalogTypes";
import { catalogFor } from "../../tests/catalogFixture";

/**
 * The Classic and Modern summary the founding screen and the in-game Compare
 * modal show: the Help site page's summary and at-a-glance table.
 */

const text = () => (renderToFragment(compareTemplate()).textContent ?? "").replace(/\s+/g, " ");

describe("the Classic and Modern summary", () => {
  // Drift guard. Each Classic and Modern divergence the player can notice maps
  // to a DISTINCT phrase the summary must contain. Phrases are per-rule and
  // distinct, so deleting one row cannot pass on a phrase another rule shares.
  //
  // The mode rules the Rust engine publishes in its catalog (`CatalogRules`)
  // are keyed by their catalog names, and the `Record<keyof CatalogRules, ...>`
  // type makes this literal name each one, so a new catalog rule breaks
  // `npm run typecheck` here until it is classified (a phrase, or null for a
  // rule with no player-facing summary line). The runtime test below is the
  // backstop for the transpile-only test path. The other entries are the
  // divergences the engine draws without a catalog rule.
  const CATALOG_RULE_TO_HELP: Record<keyof CatalogRules, string | null> = {
    variantHouseholds: "Households of two to five",
    previewNamesRefusal: "Hovering a refused spot says why first",
    scheduleAssist: "Adds presets, auto-tune and advice", // #305
    buildsWhilePaused: "Building while paused", // #1936
    exportsTo1994: "Export a .TDT for the original game",
    quotesLobbyDistance: null, // a wording detail of the tenant card's lobby warning
    tallSkyLobbies: "Sky lobbies can rise too", // #308, Classic raises only the ground lobby
    maxLobbyHeight: null, // the same 3-story cap in both modes
  };
  const RULE_TO_HELP: Record<string, string | null> = {
    ...CATALOG_RULE_TO_HELP,
    sellCondo: "a bigger household pays more",
    allowsEscalatorOnOfficeFloors: "Never to an office floor",
    walkwayWillingnessApplies: "People climb as far as they must", // #384/#503/#509
    priceOptions: "A four-step ladder, plus No Rate",
    condoRelocationChance: "families sometimes move away",
    operatingOverheadPerUnit: "overhead on each room",
    condoHoldTaxRate: "a tax on unsold condos",
    noiseErosionScale: "a noisy neighbor can wear a tenant down to notice",
    unmetDemandDrain: "too few shops nearby",
    infestationRecovery: "call an exterminator",
    weekendMultiplier: "each kind of shop with its own weekend",
    demographicRoutines: "school runs",
    rainCrowdFactor: "rain thins the crowd less",
    hotelDaytimePresence: "late checkouts", // #304
    quarterlyRentScale: "The whole quarter's rent every three days",
  };

  it("classifies every mode rule the engine's catalog publishes (test-path backstop)", () => {
    for (const mode of ["classic", "modern"] as const) {
      for (const rule of Object.keys(catalogFor(mode).rules)) {
        expect(
          CATALOG_RULE_TO_HELP,
          `catalog rule ${rule} is unclassified: add it to CATALOG_RULE_TO_HELP in compare.test.ts with a phrase, or null if it carries no player-facing Classic and Modern copy.`,
        ).toHaveProperty(rule);
      }
    }
  });

  it("maps each rule to a DISTINCT phrase so a deleted row cannot pass on a shared one", () => {
    const phrases = Object.values(RULE_TO_HELP).filter((p): p is string => p !== null);
    expect(new Set(phrases).size).toBe(phrases.length);
  });

  it("names every mapped divergence", () => {
    const summary = text();
    for (const [member, phrase] of Object.entries(RULE_TO_HELP)) {
      if (phrase !== null) expect(summary, `the summary is missing the phrase for ${member}: "${phrase}"`).toContain(phrase);
    }
    expect(summary).toContain("SimTower as it was in 1994");
  });

  it("stops before the site's pictures", () => {
    const frag = renderToFragment(compareTemplate());
    expect(frag.querySelector("h2")).toBeNull();
    expect(frag.querySelector("img")).toBeNull();
    expect(frag.querySelector("table")).not.toBeNull();
  });
});

describe("a manual link in the summary", () => {
  afterEach(() => vi.restoreAllMocks());

  it("opens its page in a new tab, marked as opened by the game, and leaves the game where it is", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const host = document.createElement("div");
    host.append(renderToFragment(compareTemplate()));
    document.body.append(host);
    const link = host.querySelector<HTMLAnchorElement>('a[href="/help/tower/clock/"]')!;
    expect(link, "the calendar row links the clock page").not.toBeNull();
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    link.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    expect(open).toHaveBeenCalledWith("/help/tower/clock/?from=game", "_blank", "noopener");
    host.remove();
  });
});
