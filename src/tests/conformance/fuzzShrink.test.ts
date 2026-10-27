import { describe, expect, it } from "vitest";
import { ddmin } from "./fuzzShrink";

const range = (n: number): number[] => Array.from({ length: n }, (_, i) => i);
/** Fails while every `needed` item is still present. */
const needs = (...needed: number[]) => (c: readonly number[]) => needed.every((x) => c.includes(x));

describe("ddmin", () => {
  it("reduces to the one item that matters", () => {
    expect(ddmin(range(40), needs(17)).kept).toEqual([17]);
  });

  it("keeps several items that must stay together, in their order", () => {
    const r = ddmin(range(64), needs(3, 29, 60));
    expect(r.kept).toEqual([3, 29, 60]);
    expect(r.exhausted).toBe(false);
  });

  it("is 1-minimal: dropping any kept item stops the failure", () => {
    const fails = (c: readonly number[]) => c.includes(5) && c.filter((x) => x % 2 === 1).length >= 3;
    const r = ddmin(range(30), fails);
    expect(fails(r.kept)).toBe(true);
    for (let i = 0; i < r.kept.length; i++) expect(fails(r.kept.filter((_, j) => j !== i))).toBe(false);
  });

  it("returns an empty list when nothing is needed", () => {
    expect(ddmin(range(8), () => true).kept).toEqual([]);
  });

  it("returns the input when every item is needed", () => {
    expect(ddmin(range(6), needs(0, 1, 2, 3, 4, 5)).kept).toEqual(range(6));
  });

  it("handles an empty and a one-item list", () => {
    expect(ddmin([], () => true).kept).toEqual([]);
    expect(ddmin([7], needs(7)).kept).toEqual([7]);
  });

  it("never tests a candidate that is not a subsequence of the input", () => {
    const seen: number[][] = [];
    ddmin(range(20), (c) => {
      seen.push([...c]);
      return c.includes(4) && c.includes(15);
    });
    for (const c of seen) expect([...c].sort((a, b) => a - b)).toEqual(c);
  });

  it("is deterministic and stays inside its test budget", () => {
    const a = ddmin(range(100), needs(9, 90));
    const b = ddmin(range(100), needs(9, 90));
    expect(b).toEqual(a);
    const capped = ddmin(range(100), needs(9, 90), 5);
    expect(capped.tests).toBe(5);
    expect(capped.exhausted).toBe(true);
    expect(needs(9, 90)(capped.kept)).toBe(true);
  });

  it("uses far fewer tests than the list is long squared", () => {
    expect(ddmin(range(200), needs(40, 160)).tests).toBeLessThan(200);
  });
});
