import { describe, expect, it } from "vitest";
import { PersonCards } from "./personCards";
import { LAYOUT, code, mockPort, record } from "../tests/portKit/mockPort";

/**
 * The person card decoder over a mock port: the read it asks for and what it
 * decodes from a record encoded from the engine's layout. The card on the Rust
 * engine is pinned by the crate's `wasm_port_person_tests.rs`.
 */

const layout = LAYOUT as unknown as { personPurposes: string[]; tripPlaces: string[]; shiftSteps: string[] };
const purpose = (name: string) => layout.personPurposes.indexOf(name);
const place = (name: string) => layout.tripPlaces.indexOf(name);

const WORKER = record("personCard", {
  id: 42,
  stateCode: code("personStates", "waiting"),
  floor: 1,
  x: 30,
  staff: 0,
  purpose: purpose("toWork"),
  returning: 0,
  shiftStep: NaN,
  fromPlace: place("lobby"),
  fromUnit: NaN,
  fromKind: NaN,
  fromFloor: 1,
  toPlace: place("room"),
  toUnit: 7,
  toKind: code("kinds", "office"),
  toFloor: 12,
  wait: 30,
  waitMinutes: 15,
  tripWaitMinutes: 20,
  shaftId: 3,
});

describe("PersonCards", () => {
  it("decodes why, both ends and the wait", () => {
    const port = mockPort({ personCard: () => WORKER });
    const p = new PersonCards(port).person(42);
    expect(port.personCard).toHaveBeenCalledWith(42);
    expect(p).toEqual({
      id: 42,
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
      tripWaitMinutes: 20,
      shaftId: 3,
    });
  });

  it("reads a housekeeper's step and an end with nothing to name", () => {
    const rec = WORKER.slice();
    const at = (n: string) => LAYOUT.records.personCard.indexOf(n);
    rec[at("staff")] = 1;
    rec[at("purpose")] = purpose("housekeeping");
    rec[at("shiftStep")] = layout.shiftSteps.indexOf("base");
    rec[at("toPlace")] = place("none");
    rec[at("shaftId")] = NaN;
    const p = new PersonCards(mockPort({ personCard: () => rec })).person(42);
    expect(p?.staff).toBe(true);
    expect(p?.shift).toBe("base");
    expect(p?.to).toEqual({ place: "none" });
    expect(p?.shaftId).toBeNull();
  });

  it("reads the layout once, on the first card, never at construction", () => {
    const port = mockPort({ personCard: () => WORKER });
    const cards = new PersonCards(port);
    expect(port.viewLayout).not.toHaveBeenCalled();
    cards.person(42);
    cards.person(42);
    expect(port.viewLayout).toHaveBeenCalledTimes(1);
  });

  it("answers undefined for someone who left", () => {
    expect(new PersonCards(mockPort({ personCard: () => new Float64Array(0) })).person(9)).toBeUndefined();
  });
});
