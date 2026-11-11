import { it, expect } from "vitest";
import { catalogFacts, newSeededDraft, LOT_WIDTH } from "../portKit/draftFixtures";
import { PortSim, describeEngines, type Leg } from "../portKit/portSim";

/** The cinema's two-tier film booking (FAQ), on both engines. Moved from
 *  faqComplete.integration.test.ts, where it ran on the sampled v1 model to
 *  stay inside the CI timeout; the engine runs the hourly model only. Modern
 *  books films each period; Classic books none, and the player pays only to
 *  change a film (#1932). */

const W = LOT_WIDTH;
const C = Math.floor(W / 2);

describeEngines("Cinema film booking (FAQ)", (leg: Leg) => {
  /** The maintenance charges a lone cinema's tower logs over a year of the
   *  canon calendar (3-day periods) in `mode`. */
  function yearOfCharges(mode: "classic" | "modern"): Set<number> {
    const draft = newSeededDraft(3, mode, "canon");
    draft.money = 1e12;
    draft.star = 1; // star 1 gates random fires (which would gut the lone cinema); this
    // test only exercises the recurring booking economy, which is star-independent.
    for (const [kind, floor] of [["lobby", 1], ["floor", 2], ["floor", 3]] as const) {
      for (let x = C; x < W; x++) draft.tower.place(kind, floor, x);
      for (let x = C - 1; x >= 0; x--) draft.tower.place(kind, floor, x);
    }
    expect(draft.tower.place("cinema", 2, 0).unitId, "the cinema stands").toBeDefined();
    const sim = new PortSim(leg, draft);
    // The log reads "Monthly maintenance paid" under real-world and
    // "Maintenance paid" under canon; match either. Read each day, since the
    // log keeps only its recent entries.
    const charges = new Set<number>();
    for (let d = 0; d < 365; d++) {
      sim.tick(60 * 24);
      for (const e of sim.state.log) {
        if (/maintenance paid/i.test(e.text)) charges.add(Number(e.text.replace(/[^0-9]/g, "")));
      }
    }
    return charges;
  }

  it("blockbuster vs average film: two-tier booking cost exists and both occur (Modern)", () => {
    const ECONOMY = catalogFacts("modern").economy as unknown as { readonly cinemaBookingMonthly: number; readonly cinemaBookingBlockbusterMonthly: number; readonly calendars: readonly { readonly key: string; readonly maintenancePeriodDays: number }[] };
    expect(ECONOMY.cinemaBookingBlockbusterMonthly).toBeGreaterThan(ECONOMY.cinemaBookingMonthly);
    // Modern adds a fixed operating overhead to each period, so the two tiers
    // show as two charges a booking's difference apart, scaled to the canon
    // 3-day period (1/10 of a real-world 30-day charge).
    const canon = ECONOMY.calendars.find((c) => c.key === "canon")!;
    const scale = canon.maintenancePeriodDays / 30;
    const charges = [...yearOfCharges("modern")];
    const gap = Math.round((ECONOMY.cinemaBookingBlockbusterMonthly - ECONOMY.cinemaBookingMonthly) * scale);
    expect(charges.some((c) => charges.includes(c + gap)), "a blockbuster period and an average period").toBe(true);
  }, 60_000);

  it("Classic books no film: a lone cinema's tower pays no maintenance", () => {
    // In Classic the cinema's only recurring cost was the booking.
    expect([...yearOfCharges("classic")].filter((c) => c > 0)).toEqual([]);
  }, 60_000);
});

/** Blockbuster as a choice (economy depth #5), on both engines. Moved from
 *  economyDepth.integration.test.ts, where it ran on the sampled v1 model. The
 *  policy is set on the draft (the save carries it) and the engine's unit card
 *  answers whether the cinema is showing a blockbuster. */
describeEngines("Cinema film policy (economy depth #5)", (leg: Leg) => {
  const MONTH = 60 * 24 * 31;

  // Modern: the policy picks the booking, and Classic books none (#1932).
  function cinemaSim(seed: number, policy: "feature" | "blockbuster"): { sim: PortSim; id: number } {
    const draft = newSeededDraft(seed, "modern");
    draft.money = 1e9;
    draft.star = 1;
    for (const [kind, floor] of [["lobby", 1], ["floor", 2], ["floor", 3]] as const) {
      for (let x = C; x < W; x++) draft.tower.place(kind, floor, x);
      for (let x = C - 1; x >= 0; x--) draft.tower.place(kind, floor, x);
    }
    const id = draft.tower.place("cinema", 2, 0).unitId!;
    const cinema = draft.tower.getUnit(id)!;
    cinema.filmPolicy = policy; // the save carries the policy
    expect(draft.tower.getUnit(id)!.filmPolicy).toBe(policy);
    return { sim: new PortSim(leg, draft), id };
  }

  it("policy 'feature' never books a blockbuster", () => {
    const { sim, id } = cinemaSim(3, "feature");
    for (let m = 0; m < 12; m++) {
      sim.tick(MONTH);
      expect(sim.unitCard(id).blockbuster).not.toBe(1);
    }
  }, 60_000);

  it("policy 'blockbuster' always books one", () => {
    const { sim, id } = cinemaSim(4, "blockbuster");
    sim.tick(MONTH);
    expect(sim.unitCard(id).blockbuster).toBe(1);
  });
});
