import { describe, it, expect } from "vitest";
import { Simulation } from "../../engine/Simulation";
import { FACILITIES } from "../../engine/facilities";
import { Clock } from "../../engine/Clock";
import { PortSim, describeEngines, type Leg } from "../portKit/portSim";

/**
 * Guards commercial venue occupant behavior:
 *   - A tenanted venue shows `f.population` as its ambient occupant count
 *     during open hours (for the renderer heatmap and lit-window sprite).
 *   - The same venue shows 0 outside its open hours so the heatmap goes dark
 *     after closing time.
 *   - Population values scale with footprint:
 *     shop 20, fastFood 25, restaurant 35.
 */

function setHour(sim: Simulation, hour: number): void {
  // Avoid Clock(0): constructor treats 0 minutes as "use default start time"
  // (7am). Use 1 minute past midnight for hour 0; Math.floor(1/60) = 0.
  // Do not call with hour=0 expecting midnight and then tick to hour 1 --
  // call setHour(sim, 23) + triggerHour() instead to cross the 23->0 boundary.
  sim.clock = new Clock(hour * 60 || 1, sim.clock.calendar);
}

/** Build a minimal tower with a single tenanted commercial venue on a draft. */
function venueDraft(kind: "fastFood" | "restaurant" | "shop"): { draft: Simulation; id: number } {
  const draft = new Simulation(2024, "classic", "realWorld");
  draft.money = 5_000_000;
  for (let x = 0; x < 40; x++) draft.tower.place("lobby", 1, x);
  for (let f = 2; f <= 5; f++) for (let x = 0; x < 40; x++) draft.tower.place("floor", f, x);
  expect(draft.tower.placeTransport("elevatorStandard", 4, 1, 5).ok).toBe(true);
  const result = draft.tower.place(kind, 3, 0);
  expect(result.ok, result.reason).toBe(true);
  draft.tower.units.find((u) => u.id === result.unitId)!.state = "occupied";
  return { draft, id: result.unitId! };
}

/** The venue on `leg` with the clock set to `hour` before the engine loads it.
 *  The draft is the fixture's authoring copy; the engine starts from its save,
 *  so the first hour it steps into fires onHour. `edit` changes the draft's
 *  venue first. `venue()` reads the venue as the engine holds it, and
 *  `triggerHour()` advances one hour so onHour/updatePresence fires. */
function venueFixture(leg: Leg, kind: "fastFood" | "restaurant" | "shop", hour: number, edit?: (draft: Simulation, id: number) => void) {
  const { draft, id } = venueDraft(kind);
  edit?.(draft, id);
  setHour(draft, hour);
  const sim = new PortSim(leg, draft);
  const venue = () => sim.state.tower.units.find((u) => u.id === id)!;
  return { sim, venue, triggerHour: () => sim.tick(60) };
}

// ---- Population values match footprint ----------------------------------------

describe("commercial venue population values scale with footprint", () => {
  it("shop has population 20", () => {
    expect(FACILITIES.shop.population).toBe(20);
  });

  it("fastFood has population 25", () => {
    expect(FACILITIES.fastFood.population).toBe(25);
  });

  it("restaurant has population 35", () => {
    expect(FACILITIES.restaurant.population).toBe(35);
  });

  it("all three are positive (gate for census inclusion)", () => {
    expect(FACILITIES.shop.population).toBeGreaterThan(0);
    expect(FACILITIES.fastFood.population).toBeGreaterThan(0);
    expect(FACILITIES.restaurant.population).toBeGreaterThan(0);
  });
});

// ---- Occupants during open hours ----------------------------------------------

describeEngines("occupants equals f.population while venue is open", (leg: Leg) => {
  it("fast food is open at 12:00 and shows its population", () => {
    const { venue, triggerHour } = venueFixture(leg, "fastFood", 11); // positioned just before target
    triggerHour(); // fires onHour -> updatePresence at hour 12
    expect(venue().occupants).toBe(FACILITIES.fastFood.population);
  });

  it("restaurant is open at 12:00 (lunch window) and shows its population", () => {
    const { venue, triggerHour } = venueFixture(leg, "restaurant", 11);
    triggerHour();
    expect(venue().occupants).toBe(FACILITIES.restaurant.population);
  });

  it("shop is open at 14:00 and shows its population", () => {
    const { venue, triggerHour } = venueFixture(leg, "shop", 13);
    triggerHour();
    expect(venue().occupants).toBe(FACILITIES.shop.population);
  });
});

// ---- Occupants while closed ---------------------------------------------------

describeEngines("occupants is 0 while venue is closed, even when tenanted", (leg: Leg) => {
  it("fast food is closed at 4:00 (before 7am open)", () => {
    const { venue, triggerHour } = venueFixture(leg, "fastFood", 3);
    triggerHour();
    expect(venue().occupants).toBe(0);
  });

  it("restaurant is closed at 9:00 (between lunch and dinner windows)", () => {
    const { venue, triggerHour } = venueFixture(leg, "restaurant", 8);
    triggerHour();
    expect(venue().occupants).toBe(0);
  });

  it("shop is closed at 22:00 (after 21:00 close)", () => {
    const { venue, triggerHour } = venueFixture(leg, "shop", 21);
    triggerHour();
    expect(venue().occupants).toBe(0);
  });

  it("a tenanted-but-closed venue shows 0, not its population", () => {
    // Restaurant is only open 11-14 and 17-23; confirm zero at 3am.
    const { venue, triggerHour } = venueFixture(leg, "restaurant", 2);
    expect(venue().state).toBe("occupied");
    triggerHour();
    expect(venue().occupants).toBe(0);
  });
});

// ---- Transition at boundary ---------------------------------------------------

describeEngines("occupants flips at open/close hour boundaries", (leg: Leg) => {
  it("fast food goes dark after 22:00 and lights up again at 7:00", () => {
    // Inside open window: 21:00 (22-1)
    const { sim, venue, triggerHour } = venueFixture(leg, "fastFood", 20);
    triggerHour(); // now at hour 21
    expect(venue().occupants).toBe(FACILITIES.fastFood.population);

    // Past close: advance one more hour to 22:00
    triggerHour();
    expect(venue().occupants).toBe(0);

    // Re-open at 7:00: the engine runs through the night to 6:00, then steps
    // into the hour that opens the venue.
    sim.tick(8 * 60);
    expect(sim.state.clock.hour).toBe(6);
    triggerHour(); // now at hour 7
    expect(venue().occupants).toBe(FACILITIES.fastFood.population);
  });
});

// Still on the TypeScript Simulation: it writes `customersIn` between two reads,
// and a save does not carry live customers, so it needs a tooling-only write on
// the engine before it can run through the port kit.
describe("v2 spatial congestion reads live customers, never the commercial catalog value", () => {
  it("an occupied fastFood with no customers adds zero floor congestion; live customers add pressure", () => {
    const sim = new Simulation(2024, "modern", "realWorld");
    sim.simModel = "v2";
    sim.money = 1_000_000;
    for (let x = 0; x < 40; x++) sim.tower.place("lobby", 1, x);
    for (let x = 0; x < 40; x++) sim.tower.place("floor", 2, x);
    const r = sim.tower.place("fastFood", 2, 0);
    const u = sim.tower.units.find((x) => x.id === r.unitId)!;
    u.state = "occupied";
    // A single weak shaft so the floor is served (unserved floors are skipped
    // by the spatial model) and 25 riders visibly stress it.
    sim.tower.placeTransport("elevatorStandard", 30, 1, 2);
    sim.tower.setCars(sim.tower.transports[0].id, 1);
    setHour(sim, 12);
    // No live customers: the venue must not stress floor 2 with its catalog 25.
    // The pre-fix code summed residentCount for every present unit, so a lone
    // occupied fastFood faked a full elevator load around the clock.
    expect(sim.congestionAt(2)).toBe(0);
    u.customersIn = 25;
    expect(sim.congestionAt(2)).toBeGreaterThan(0);
  });
});

describeEngines("a venue's first open hour shows its ambient crowd", (leg: Leg) => {
  it("an empty (never-visited) shop is lit in the same hour traffic first opens it", () => {
    // updatePresence runs before collectTrafficIncome inside one onHour, so a
    // newly built venue used to spend its whole first open hour occupied but
    // with 0 occupants (dark windows, cold heatmap, no statistical demand).
    // The economy now stamps the ambient crowd at the empty-to-occupied flip.
    const { venue, triggerHour } = venueFixture(leg, "shop", 9, (draft, id) => {
      const unit = draft.tower.units.find((u) => u.id === id)!;
      unit.state = "empty";
      unit.occupants = 0;
    }); // shop opens at 10
    triggerHour(); // crosses into 10:00: traffic flips it occupied
    expect(venue().state).toBe("occupied");
    expect(venue().occupants).toBe(FACILITIES.shop.population);
  });
});
