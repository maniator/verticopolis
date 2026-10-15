import { describe, expect, it } from "vitest";
import { FRAME_HEADER, PERSON_FIXED, decodeFrame } from "./frameView";

/** A person record in the engine's layout: the fixed slots, then the route. */
function person(fixed: number[], floors: number[] = [], shafts: number[] = []): number[] {
  if (fixed.length !== PERSON_FIXED - 2) throw new Error(`a person record has ${PERSON_FIXED - 2} fixed slots before its counts`);
  return [...fixed, floors.length, shafts.length, ...floors, ...shafts];
}

/** A frame view with the given records, in the engine's layout. */
function frame(people: number[][], units: number[][], transports: { id: number; cars: number[][] }[]): number[] {
  const header = new Array<number>(FRAME_HEADER).fill(0);
  header[0] = 425.5; // minutes
  header[1] = 7; // revision
  header[2] = 2; // meal overlay revision
  header[3] = 12; // logSeq
  header[4] = 1234.5; // money
  header[5] = 3; // star
  header[6] = 2; // rain
  header[7] = 1; // santa
  header[8] = 2; header[9] = 4; header[10] = 180.5; // explosion
  header[11] = 3; header[12] = 1; header[13] = 6; // thief, caught
  header[14] = 1; header[15] = -1; header[16] = 200; // treasure
  header[17] = 5; // vip
  header[18] = 2; header[19] = 1; header[20] = 1; // counts
  header[21] = 1; // pending
  header[22] = 9; // onHourRuns
  header[23] = people.length;
  header[24] = units.length;
  header[25] = transports.length;
  const body = [...people.flat(), ...units.flat(), ...transports.flatMap((t) => [t.id, t.cars.length, ...t.cars.flat()])];
  return [...header, ...body];
}

describe("decodeFrame", () => {
  it("reads the header, the people, the unit counters and the cars", () => {
    const v = frame(
      [
        person([1, 42, 1, 2, 3, 150.25, 0.5, 7, 1, -1, -1, -1, 0, 0, 0, NaN]),
        person([2, 43, 0, 5, 4, 60, 4, 0, 2, 30, 31, 31, 1, 2, 1, 48.5], [4, 2], [9]),
        person([3, 44, 0, 0, 2, 10, 2, 0, 2, 30, -1, 31, 0, 0, 1, -1.5], [4, 2], [9]),
      ],
      [[10, 2, 4, 3, -1, 0]],
      [{ id: 20, cars: [[2.5, 0.5, 1], [4, -1, -1]] }],
    );
    const f = decodeFrame(v);
    expect(f.header).toMatchObject({
      minutes: 425.5, revision: 7, mealOverlayRevision: 2, logSeq: 12, money: 1234.5, star: 3, weather: "rain",
      santaFxSeq: 1, explosionFx: { seq: 2, floor: 4, x: 180.5 }, thiefFx: { seq: 3, caught: true, floor: 6 },
      treasureFx: { seq: 1, floor: -1, x: 200 }, vipFxSeq: 5, counts: { fires: 2, firesGutRooms: 1, bombs: 1 },
      pending: true, onHourRuns: 9,
    });
    expect(f.people).toEqual([
      { id: 1, seed: 42, staff: true, state: "riding", floor: 3, x: 150.25, fy: 0.5, wait: 7, originFloor: 1, originUnitId: undefined, venueUnitId: undefined, mealVenueId: undefined, countedHotelGuest: false, routine: undefined, returning: false, dwellSecondsLeft: undefined, floors: [], shafts: [] },
      { id: 2, seed: 43, staff: false, state: "dwelling", floor: 4, x: 60, fy: 4, wait: 0, originFloor: 2, originUnitId: 30, venueUnitId: 31, mealVenueId: 31, countedHotelGuest: true, routine: "salesCall", returning: true, dwellSecondsLeft: 48.5, floors: [4, 2], shafts: [9] },
      // A drained timer stays negative through the return leg and is kept.
      { id: 3, seed: 44, staff: false, state: "toShaft", floor: 2, x: 10, fy: 2, wait: 0, originFloor: 2, originUnitId: 30, venueUnitId: undefined, mealVenueId: 31, countedHotelGuest: false, routine: undefined, returning: true, dwellSecondsLeft: -1.5, floors: [4, 2], shafts: [9] },
    ]);
    expect(f.units).toEqual([{ id: 10, state: "occupied", occupants: 4, customersIn: 3, hotelCustomersIn: undefined, outForMeal: 0 }]);
    expect(f.transports).toEqual([{ id: 20, cars: 2, carPositions: [2.5, 4], carLoad: [0.5, -1], carDir: [1, -1] }]);
  });

  it("drops a load column the shaft never keeps", () => {
    const f = decodeFrame(frame([], [], [{ id: 1, cars: [[1, -1, 0]] }]));
    expect(f.transports[0].carLoad).toBeUndefined();
  });

  it("names a short array, a trailing surplus and an unknown code", () => {
    expect(() => decodeFrame([1, 2, 3])).toThrow(/header needs/);
    expect(() => decodeFrame([...frame([], [], []), 5])).toThrow(/left after/);
    const blank = [1, 1, 0, 0, 0, 0, 0, 0, 0, -1, -1, -1, 0, 0, 0, NaN];
    const short = frame([person(blank)], [], []);
    short[FRAME_HEADER + 3] = 99;
    expect(() => decodeFrame(short)).toThrow(/person state code 99/);
    const routine = frame([person(blank)], [], []);
    routine[FRAME_HEADER + 13] = 3;
    expect(() => decodeFrame(routine)).toThrow(/routine code 3/);
    // The code the engine sends for a routine it has no code for.
    routine[FRAME_HEADER + 13] = 255;
    expect(() => decodeFrame(routine)).toThrow(/routine code 255/);
    const truncated = frame([person(blank)], [], []).slice(0, -2);
    expect(() => decodeFrame(truncated)).toThrow(/record at/);
    const route = frame([person(blank, [1, 2], [5])], [], []).slice(0, -1);
    expect(() => decodeFrame(route)).toThrow(/record at/);
  });

  it("names a negative or non-integer route count", () => {
    const blank = [1, 1, 0, 0, 0, 0, 0, 0, 0, -1, -1, -1, 0, 0, 0, NaN];
    const negative = frame([person(blank)], [], []);
    negative[FRAME_HEADER + 16] = -1;
    expect(() => decodeFrame(negative)).toThrow(/bad floors count -1/);
    const nan = frame([person(blank)], [], []);
    nan[FRAME_HEADER + 17] = NaN;
    expect(() => decodeFrame(nan)).toThrow(/bad shafts count NaN/);
  });

  it("names a negative or non-integer header count and car count", () => {
    const people = frame([], [], []);
    people[23] = 0.5;
    expect(() => decodeFrame(people)).toThrow(/bad people count 0.5/);
    const units = frame([], [], []);
    units[24] = -1;
    expect(() => decodeFrame(units)).toThrow(/bad unit count -1/);
    const transports = frame([], [], []);
    transports[25] = 1.5;
    expect(() => decodeFrame(transports)).toThrow(/bad transport count 1.5/);
    const negativeCars = frame([], [], [{ id: 7, cars: [] }]);
    negativeCars[FRAME_HEADER + 1] = -1;
    expect(() => decodeFrame(negativeCars)).toThrow(/bad transport 7 cars count -1/);
    const fractionalCars = frame([], [], [{ id: 8, cars: [[1, -1, 0]] }]);
    fractionalCars[FRAME_HEADER + 1] = 1.5;
    expect(() => decodeFrame(fractionalCars)).toThrow(/bad transport 8 cars count 1.5/);
  });
});
