import { describe, expect, it } from "vitest";
import { stampGroundEntrances, towerOfSpan } from "./groundEntrances";
import type { EntranceKind } from "./sprites/structure/lobby";

const range = (from: number, to: number): number[] => Array.from({ length: to - from }, (_, i) => from + i);

/** The stamped map as sorted `[x, kind]` pairs. */
function stamp(lobby: number[], buildings: number[] | null): [number, EntranceKind][] {
  const out = new Map<number, EntranceKind>([[999, "service"]]);
  stampGroundEntrances(out, lobby, buildings, []);
  return [...out].sort((a, b) => a[0] - b[0]);
}

describe("one building on the lot (Classic)", () => {
  it("puts the grand entrance on the left end and the service door on the right end", () => {
    expect(stamp(range(4, 10), null)).toEqual([
      [4, "grand-left"],
      [5, "grand-right"],
      [9, "service"],
    ]);
  });

  it("keeps one grand entrance when two ground lobbies stand apart", () => {
    expect(stamp([...range(4, 8), ...range(20, 26)], null)).toEqual([
      [4, "grand-left"],
      [5, "grand-right"],
      [25, "service"],
    ]);
  });

  it("makes a one- or two-tile lobby all grand, with no service door", () => {
    expect(stamp([7], null)).toEqual([[7, "grand-solo"]]);
    expect(stamp([7, 8], null)).toEqual([
      [7, "grand-left"],
      [8, "grand-right"],
    ]);
  });

  it("clears what an earlier layout stamped, and stamps nothing on a lot with no ground lobby", () => {
    expect(stamp([], null)).toEqual([]);
    expect(stamp([], [])).toEqual([]);
  });
});

describe("a front door for each tower (Modern)", () => {
  it("gives every tower standing apart its own grand entrance and service door", () => {
    const left = range(4, 8);
    const right = range(20, 26);
    expect(stamp([...left, ...right], [...right, ...left])).toEqual([
      [4, "grand-left"],
      [5, "grand-right"],
      [7, "service"],
      [20, "grand-left"],
      [21, "grand-right"],
      [25, "service"],
    ]);
  });

  it("stamps each tower by the same widths rule, a one-tile tower as grand-solo", () => {
    expect(stamp([3, 10, 11, 30, 31, 32], [3, 10, 11, 30, 31, 32])).toEqual([
      [3, "grand-solo"],
      [10, "grand-left"],
      [11, "grand-right"],
      [30, "grand-left"],
      [31, "grand-right"],
      [32, "service"],
    ]);
  });

  it("treats a ground-floor room between two lobby runs as part of one tower", () => {
    // Lobby 4..7, a room on 8..9, lobby 10..13: one building on the ground.
    const lobby = [...range(4, 8), ...range(10, 14)];
    const rooms = [8, 9];
    expect(stamp(lobby, [...lobby, ...rooms])).toEqual([
      [4, "grand-left"],
      [5, "grand-right"],
      [13, "service"],
    ]);
  });

  it("skips a tower whose ground floor holds no lobby", () => {
    const lobby = range(20, 24);
    expect(stamp(lobby, [...range(4, 8), ...lobby])).toEqual([
      [20, "grand-left"],
      [21, "grand-right"],
      [23, "service"],
    ]);
  });
});

describe("the towers the entrances stand in", () => {
  /** The towers stamped, as [first, last] column pairs. */
  function towers(lobby: number[], buildings: number[] | null): number[] {
    const out: number[] = [99, 99];
    stampGroundEntrances(new Map(), lobby, buildings, out);
    return out;
  }

  it("spans the whole lot for one building", () => {
    expect(towers(range(4, 10), null)).toEqual([-Infinity, Infinity]);
    expect(towers([], null)).toEqual([]);
  });

  it("lists each tower with a lobby by its ground floor's first and last column", () => {
    const lobby = [...range(4, 8), ...range(20, 26)];
    // A room on 8..9 widens the left tower; a building with no lobby is no tower.
    expect(towers(lobby, [...lobby, 8, 9, 40, 41])).toEqual([4, 9, 20, 25]);
  });

  it("finds the tower a unit stands over, else the nearest one", () => {
    const t = [4, 9, 20, 25];
    expect(towerOfSpan(t, 6, 2)).toBe(0);
    expect(towerOfSpan(t, 9, 4)).toBe(0); // its first column is the tower's last
    expect(towerOfSpan(t, 18, 3)).toBe(1); // overhangs the right tower's left end
    expect(towerOfSpan(t, 11, 2)).toBe(0); // open ground, nearer the left tower
    expect(towerOfSpan(t, 17, 1)).toBe(1); // open ground, nearer the right tower
    expect(towerOfSpan(t, 30, 9)).toBe(1);
    expect(towerOfSpan([-Infinity, Infinity], 300, 9)).toBe(0);
    expect(towerOfSpan([], 6, 2)).toBe(-1);
  });
});
