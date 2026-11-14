import { describe, expect, it } from "vitest";
import type { PersonDetail } from "../../simport/personCards";
import { catalogFacility } from "../../catalog/catalogTypes";
import { catalogFor } from "../../tests/catalogFixture";
import { renderToFragment } from "../testing/litTestUtils";
import { PERSON_FOLLOW_ACTION, personCardTemplate, personNow, personRole, personWhy, placeWords, type PersonCardInput } from "./personCard";

const catalog = catalogFor("classic");

function person(over: Partial<PersonDetail> = {}): PersonDetail {
  return {
    id: 5,
    state: "waiting",
    floor: 1,
    x: 30,
    staff: false,
    purpose: "toWork",
    returning: false,
    shift: null,
    from: { place: "lobby", floor: 1 },
    to: { place: "room", id: 7, kind: "office", floor: 12 },
    wait: 30,
    waitMinutes: 15,
    tripWaitMinutes: 19.6,
    shaftId: 3,
    ...over,
  };
}

function card(over: Partial<PersonCardInput> = {}): DocumentFragment {
  return renderToFragment(personCardTemplate({ person: person(), gone: false, catalog, shaftKind: "elevatorStandard", mood: "impatient", following: false, ...over }));
}

const field = (f: DocumentFragment, name: string) => f.querySelector(`[data-field="${name}"]`)?.textContent;

describe("the person card", () => {
  it("says who, why, from where, to where, now and the wait", () => {
    const f = card();
    expect(f.querySelector(".win-title")?.textContent).toContain("Office worker");
    expect(field(f, "why")).toBe("Coming in to work");
    expect(field(f, "from")).toBe("Outside, through the lobby");
    expect(field(f, "to")).toBe(`${catalogFacility(catalog, "office").name}, floor 12`);
    expect(field(f, "now")).toBe(`Waiting for the ${catalogFacility(catalog, "elevatorStandard").name}`);
    expect(field(f, "waited")).toBe("20 min this trip");
    expect(field(f, "mood")).toBe("Getting impatient");
  });

  it("offers Follow, and Stop following while it follows", () => {
    const off = card().querySelector(`[data-edit="${PERSON_FOLLOW_ACTION}"]`);
    expect(off?.textContent?.trim()).toBe("Follow");
    const on = card({ following: true }).querySelector(`[data-edit="${PERSON_FOLLOW_ACTION}"]`);
    expect(on?.textContent?.trim()).toBe("Stop following");
    // The label says what a press does; no pressed state on top of it.
    expect(on?.hasAttribute("aria-pressed")).toBe(false);
  });

  it("says when they left the tower and offers no follow", () => {
    const f = card({ gone: true });
    expect(field(f, "now")).toBe("Left the tower");
    expect(f.querySelector(`[data-edit="${PERSON_FOLLOW_ACTION}"]`)).toBeNull();
    expect(f.textContent).toContain("They left the tower.");
  });

  it("names a housekeeper's base and step", () => {
    const keeper = person({
      staff: true,
      purpose: "housekeeping",
      shift: "job",
      from: { place: "room", id: 2, kind: "housekeeping", floor: 4 },
      to: { place: "room", id: 9, kind: "hotelSingle", floor: 6 },
      state: "dwelling",
    });
    const f = card({ person: keeper, mood: "content" });
    expect(f.querySelector(".win-title")?.textContent).toContain("Housekeeper");
    expect(f.textContent).toContain("Works from");
    expect(f.textContent).toContain("Heading to");
    expect(field(f, "why")).toBe("Cleaning hotel rooms");
    expect(field(f, "now")).toBe("Cleaning a room");
  });
});

describe("the person card's words", () => {
  it("gives each trip its own reason", () => {
    expect(personWhy(person({ purpose: "fromWork" }))).toBe("Heading home from work");
    expect(personWhy(person({ purpose: "meal" }))).toBe("Going out to eat");
    expect(personWhy(person({ purpose: "meal", returning: true }))).toBe("Heading back after a meal");
    expect(personWhy(person({ purpose: "schoolRun", from: { place: "room", id: 1, kind: "condo", floor: 3 } }))).toBe("Taking the kids to school");
    expect(personWhy(person({ purpose: "schoolRun" }))).toBe("Back from the school run");
    expect(personWhy(person({ purpose: "salesCall" }))).toBe("Off on a sales call");
    expect(personWhy(person({ purpose: "unknown" }))).toBe("Out and about");
  });

  it("names the role from the room they belong to", () => {
    const hotel = { place: "room", id: 1, kind: "hotelSingle", floor: 5 } as const;
    expect(personRole(person({ purpose: "returnHome", to: hotel }))).toBe("Hotel guest");
    expect(personRole(person({ purpose: "leaveHome", from: { place: "room", id: 1, kind: "condo", floor: 5 } }))).toBe("Resident");
    expect(personRole(person({ purpose: "meal", returning: true, to: { place: "room", id: 1, kind: "office", floor: 5 } }))).toBe("Office worker");
    expect(personRole(person({ purpose: "visit", from: { place: "lobby", floor: 1 } }))).toBe("Visitor");
    expect(personRole(person({ purpose: "schoolRun" }))).toBe("Parent");
  });

  it("words every kind of end", () => {
    expect(placeWords({ place: "floor", floor: 0 }, catalog)).toBe("Floor B1");
    expect(placeWords({ place: "lobby", floor: 15 }, catalog)).toBe("Sky lobby, floor 15");
    expect(placeWords({ place: "metro", floor: -1 }, catalog)).toBe("Outside, by Metro");
    expect(placeWords({ place: "none" }, catalog)).toBe("—");
  });

  it("says what they do now without a shaft too", () => {
    expect(personNow(person({ state: "riding" }), "Escalator")).toBe("Riding the Escalator");
    expect(personNow(person({ state: "toDest" }), null)).toBe("Walking");
    expect(personNow(person({ state: "dwelling", purpose: "meal" }), null)).toBe("Eating");
  });
});
