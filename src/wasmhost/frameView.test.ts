import { describe, expect, it } from "vitest";
import { FRAME_HEADER, decodeFrame } from "./frameView";

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
      [[1, 42, 1, 2, 3, 150.25, 0.5, 7]],
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
    expect(f.people).toEqual([{ id: 1, seed: 42, staff: true, state: "riding", floor: 3, x: 150.25, fy: 0.5, wait: 7 }]);
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
    const short = frame([[1, 1, 0, 0, 0, 0, 0, 0]], [], []);
    short[FRAME_HEADER + 3] = 99;
    expect(() => decodeFrame(short)).toThrow(/person state code 99/);
    const truncated = frame([[1, 1, 0, 0, 0, 0, 0, 0]], [], []).slice(0, -2);
    expect(() => decodeFrame(truncated)).toThrow(/record at/);
  });
});
