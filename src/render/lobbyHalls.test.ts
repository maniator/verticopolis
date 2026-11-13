import { describe, expect, it } from "vitest";
import { hallDoors, lobbyHalls, NO_TALL_HALLS } from "./lobbyHalls";

/** Lobby columns by floor, as the structure pass collects them. */
const lobbyAt = (cols: Record<number, [number, number][]>) => (floor: number, x: number) =>
  (cols[floor] ?? []).some(([x0, x1]) => x0 <= x && x <= x1);

describe("lobbyHalls reads the engine's hall quads (#2068)", () => {
  it("answers each column's hall height, and one story where no tall hall stands", () => {
    const halls = lobbyHalls([1, 10, 19, 3, 1, 20, 29, 2, 15, 4, 9, 2]);
    expect(halls.runs).toEqual([
      { floor: 1, x0: 10, x1: 19, height: 3 },
      { floor: 1, x0: 20, x1: 29, height: 2 },
      { floor: 15, x0: 4, x1: 9, height: 2 },
    ]);
    expect([9, 10, 19, 20, 29, 30].map((x) => halls.heightAt(1, x))).toEqual([1, 3, 3, 2, 2, 1]);
    expect(halls.heightAt(15, 4)).toBe(2);
    expect(halls.heightAt(2, 12)).toBe(1);
  });

  it("is the shared empty answer when no hall is tall, and ignores a trailing partial quad", () => {
    expect(lobbyHalls([])).toBe(NO_TALL_HALLS);
    expect(lobbyHalls([1, 2, 3])).toBe(NO_TALL_HALLS);
    expect(lobbyHalls([1, 2, 3, 2, 9]).runs).toHaveLength(1);
  });
});

describe("hallDoors finds every wall between halls of different heights", () => {
  it("puts one door where a tall hall meets a shorter one on either side", () => {
    const halls = lobbyHalls([1, 10, 19, 3]);
    const doors = hallDoors(halls, lobbyAt({ 1: [[0, 40]] }));
    expect(doors).toEqual([
      { floor: 1, x: 10, tall: 3, short: 1, tallOnLeft: false },
      { floor: 1, x: 20, tall: 3, short: 1, tallOnLeft: true },
    ]);
  });

  it("lists a wall between two tall halls once", () => {
    const halls = lobbyHalls([1, 10, 19, 3, 1, 20, 29, 2]);
    const doors = hallDoors(halls, lobbyAt({ 1: [[10, 29]] }));
    expect(doors).toEqual([{ floor: 1, x: 20, tall: 3, short: 2, tallOnLeft: true }]);
  });

  it("puts no door at a hall's end with no lobby beyond it, nor between halls of one height", () => {
    // 10..19 ends at the lot's lobby; a gap at 20 parts it from 21..29.
    const halls = lobbyHalls([1, 10, 19, 2, 1, 21, 29, 2]);
    expect(hallDoors(halls, lobbyAt({ 1: [[10, 19], [21, 29]] }))).toEqual([]);
    expect(hallDoors(NO_TALL_HALLS, lobbyAt({ 1: [[0, 40]] }))).toEqual([]);
  });

  it("sorts the doors by floor, then column", () => {
    const halls = lobbyHalls([15, 4, 9, 2, 1, 30, 39, 3, 1, 10, 19, 2]);
    const doors = hallDoors(halls, lobbyAt({ 1: [[0, 50]], 15: [[0, 20]] }));
    expect(doors.map((d) => [d.floor, d.x])).toEqual([[1, 10], [1, 20], [1, 30], [1, 40], [15, 4], [15, 10]]);
  });
});
