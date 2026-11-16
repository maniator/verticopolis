import { describe, it, expect, vi } from "vitest";
import { STAR_DUTY_LABELS, starUpScreen, starUpTemplate } from "./starUp";
import { renderToFragment, click } from "../testing/litTestUtils";
import { catalogFor } from "../../tests/catalogFixture";
import { statsScreenFor } from "../../tests/fixtures/statsScreens";
import type { StatsReport } from "../../simport/panels";

/**
 * The star-up message box: what it shows for a climb, read from the pinned
 * catalogs (the engine's published rooms, unlock ratings and duties) and a
 * hand-built stats answer standing in for the engine's report, and the OK
 * action. The frame loop's latch is pinned in `starUpFlow.test.ts`.
 */

/** A stats answer at three stars: offices needing 12 spaces, 3 working. */
function report(over: Partial<StatsReport> = {}): StatsReport {
  return statsScreenFor({
    mode: "modern",
    report: {
      functionalParking: 3,
      parkingDemand: { officePop: 72, offices: 12, suites: 0, homes: 0, total: 12, coverage: 0.25, short: true },
      nextStar: { star: 4, isTower: false, popHave: 1_234, popNeed: 5_000, popMet: false, gates: [{ id: "medical", met: false }], allMet: false },
      ...over,
    },
  }).report;
}

const text = (frag: DocumentFragment) => (frag.textContent ?? "").replace(/\s+/g, " ");

describe("starUpScreen", () => {
  it("lists the rooms whose unlock rating lies in the climb, for the mode", () => {
    const classic = catalogFor("classic");
    const screen = starUpScreen(1, 2, classic, () => {
      throw new Error("Classic reads no report");
    });
    const want = classic.facilities.filter((f) => f.available && f.minStar === 2).map((f) => f.name);
    expect(want.length).toBeGreaterThan(0);
    expect(screen.rooms).toEqual(want);
    expect(screen.star).toBe(2);
    // Classic has no heads-up, so the engine's report is never asked for.
    expect(screen.headsUp).toBeNull();
  });

  it("covers every rating of a climb of two at once", () => {
    const modern = catalogFor("modern");
    const screen = starUpScreen(1, 3, modern, () => report());
    const want = modern.facilities.filter((f) => f.available && f.minStar > 1 && f.minStar <= 3).map((f) => f.name);
    expect(screen.rooms).toEqual(want);
    expect(screen.headsUp!.duties).toEqual(modern.rules.starDuties.filter((d) => d.star === 2 || d.star === 3).map((d) => d.id));
  });

  it("adds the Modern heads-up: the duties, the parking as it stands and the next rating", () => {
    const modern = catalogFor("modern");
    const ask = vi.fn(() => report());
    const screen = starUpScreen(2, 3, modern, ask);
    expect(ask).toHaveBeenCalledOnce();
    expect(screen.headsUp!.duties).toEqual(modern.rules.starDuties.filter((d) => d.star === 3).map((d) => d.id));
    expect(screen.headsUp!.duties).toContain("officeParking");
    expect(screen.headsUp!.parking).toEqual({ need: 12, have: 3, short: true });
    expect(screen.headsUp!.next?.star).toBe(4);
  });

  it("shows no parking line on a climb that starts no parking duty", () => {
    const screen = starUpScreen(3, 4, catalogFor("modern"), () => report());
    expect(screen.headsUp!.duties).not.toContain("officeParking");
    expect(screen.headsUp!.parking).toBeNull();
  });
});

describe("starUpTemplate", () => {
  it("names the rating and the new rooms, with an OK button that dispatches onOk", () => {
    const onOk = vi.fn();
    const frag = renderToFragment(starUpTemplate({ star: 2, rooms: ["Hotel Single Room", "Security"], headsUp: null, topFloor: 100 }, onOk));
    expect(frag.querySelector("h2")!.textContent).toContain("Star Rating");
    expect(frag.querySelector(".star-up-rating")!.textContent).toBe("★★");
    expect(text(frag)).toContain("Your tower is now rated 2 stars.");
    expect(text(frag)).toContain("You can now build: Hotel Single Room, Security.");
    expect(frag.querySelector(".star-up-duties")).toBeNull();
    expect(frag.querySelector(".stats-section")).toBeNull();
    click(frag.querySelector('[data-act="ok"]')!);
    expect(onOk).toHaveBeenCalledOnce();
  });

  it("words each duty, marks a short parking line, and draws the next rating's checklist", () => {
    const screen = starUpScreen(2, 3, catalogFor("modern"), () => report());
    const frag = renderToFragment(starUpTemplate(screen, () => {}));
    const lines = [...frag.querySelectorAll(".star-up-duties li")].map((li) => li.textContent);
    expect(lines).toEqual(screen.headsUp!.duties.map((d) => STAR_DUTY_LABELS[d]));
    const parking = frag.querySelector(".star-up-parking")!;
    expect(parking.textContent).toContain("needs 12 spaces and has 3 working");
    expect(parking.classList.contains("short")).toBe(true);
    expect(text(frag)).toContain("Next: 4★");
    // Inside the stats grid, so the header never takes the box's sticky title-bar rule.
    expect(frag.querySelector(".stats-section")!.parentElement!.classList.contains("stats-grid")).toBe(true);
    expect(text(frag)).toContain("1,234 / 5,000");
  });

  it("leaves the parking line plain when the tower has enough", () => {
    const enough = report({ functionalParking: 1, parkingDemand: { officePop: 6, offices: 1, suites: 0, homes: 0, total: 1, coverage: null, short: false } });
    const frag = renderToFragment(starUpTemplate(starUpScreen(2, 3, catalogFor("modern"), () => enough), () => {}));
    const parking = frag.querySelector(".star-up-parking")!;
    expect(parking.textContent).toContain("needs 1 space and has 1 working");
    expect(parking.classList.contains("short")).toBe(false);
  });
});
