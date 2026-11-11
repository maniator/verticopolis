import { it, expect } from "vitest";
import { catalogFacts, newSeededDraft, LOT_WIDTH } from "../portKit/draftFixtures";
import { PortSim, describeEngines, type Leg } from "../portKit/portSim";

/** The cinema's two-tier film booking (FAQ), on both engines. Moved from
 *  faqComplete.integration.test.ts, where it ran on the sampled v1 model to
 *  stay inside the CI timeout; the engine runs the hourly model only. */

const W = LOT_WIDTH;
const C = Math.floor(W / 2);

describeEngines("Cinema film booking (FAQ)", (leg: Leg) => {
  it("blockbuster vs average film: two-tier booking cost exists and both occur", () => {
    // Classic's economy from the engine's catalog.
    const ECONOMY = catalogFacts("classic").economy as unknown as { readonly cinemaBookingMonthly: number; readonly cinemaBookingBlockbusterMonthly: number; readonly calendars: readonly { readonly maintenancePeriodDays: number }[] };
    expect(ECONOMY.cinemaBookingBlockbusterMonthly).toBeGreaterThan(ECONOMY.cinemaBookingMonthly);
    // Classic on purpose: this isolates the cinema BOOKING mechanic (which exists
    // in both modes) from the Modern-only operating overhead, so the assertion
    // reads the booking cost alone rather than folding in an unrelated sink.
    const draft = newSeededDraft(3);
    draft.money = 1e12;
    draft.star = 1; // star 1 gates random fires (which would gut the lone cinema); this
    // test only exercises the recurring booking economy, which is star-independent.
    for (const [kind, floor] of [["lobby", 1], ["floor", 2], ["floor", 3]] as const) {
      for (let x = C; x < W; x++) draft.tower.place(kind, floor, x);
      for (let x = C - 1; x >= 0; x--) draft.tower.place(kind, floor, x);
    }
    draft.tower.place("cinema", 2, 0); // in Classic the cinema's only recurring cost is the film booking
    const sim = new PortSim(leg, draft);
    // The booking is the tower's only upkeep here, so the maintenance charge IS
    // the booking, scaled to the calendar's period (Classic's canon 3-day period
    // is 1/10). The log reads "Monthly maintenance paid" under real-world and
    // "Maintenance paid" under canon; match either. Read each day, since the log
    // keeps only its recent entries.
    const scale = ECONOMY.calendars[0].maintenancePeriodDays / 30;
    const bookings = new Set<number>();
    for (let d = 0; d < 365; d++) {
      sim.tick(60 * 24);
      for (const e of sim.state.log) {
        if (/maintenance paid/i.test(e.text)) bookings.add(Number(e.text.replace(/[^0-9]/g, "")));
      }
    }
    expect(bookings.has(Math.round(ECONOMY.cinemaBookingBlockbusterMonthly * scale)), "some blockbuster periods").toBe(true);
    expect(bookings.has(Math.round(ECONOMY.cinemaBookingMonthly * scale)), "some average periods").toBe(true);
  }, 60_000);
});

/** Blockbuster as a choice (economy depth #5), on both engines. Moved from
 *  economyDepth.integration.test.ts, where it ran on the sampled v1 model. The
 *  policy is set on the draft (the save carries it) and the engine's unit card
 *  answers whether the cinema is showing a blockbuster. */
describeEngines("Cinema film policy (economy depth #5)", (leg: Leg) => {
  const MONTH = 60 * 24 * 31;

  function cinemaSim(seed: number, policy: "feature" | "blockbuster"): { sim: PortSim; id: number } {
    const draft = newSeededDraft(seed);
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
