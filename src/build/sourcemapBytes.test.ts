import { describe, expect, it } from "vitest";
import { bytesBySource, decodeVlq, UNMAPPED } from "./sourcemapBytes";

describe("decodeVlq", () => {
  it("decodes the spec's examples", () => {
    expect(decodeVlq("AAAA")).toEqual([0, 0, 0, 0]);
    expect(decodeVlq("CAAC")).toEqual([1, 0, 0, 1]);
    expect(decodeVlq("D")).toEqual([-1]);
    expect(decodeVlq("gB")).toEqual([16]);
    expect(decodeVlq("hB")).toEqual([-16]);
  });

  it("refuses a bad character or a value cut off", () => {
    expect(() => decodeVlq("A!")).toThrow(/not a base64 VLQ character/);
    expect(() => decodeVlq("g")).toThrow(/runs past the end/);
  });
});

describe("bytesBySource", () => {
  it("charges each span to its segment's source, and the rest to unmapped", () => {
    // Line 1: "abc" from a (col 0), "de" from b (col 3). Line 2: "  " before
    // the first segment (unmapped), then "xyz" from a again (col 2).
    const code = "abcde\n  xyz";
    const map = { sources: ["a.ts", "b.ts"], mappings: "AAAA,GCAA;EDAA" };
    const { bytes, text } = bytesBySource(code, map);
    expect(Object.fromEntries(bytes)).toEqual({ "a.ts": 6, "b.ts": 2, [UNMAPPED]: 2 });
    expect(text.get("a.ts")).toEqual(["abc", "xyz"]);
  });

  it("counts lines past the last mappings group as unmapped", () => {
    const { bytes } = bytesBySource("ab\n//# sourceMappingURL=x.map", { sources: ["s.ts"], mappings: "AAAA" });
    expect(Object.fromEntries(bytes)).toEqual({ "s.ts": 2, [UNMAPPED]: 26 });
  });

  it("keeps a line with no segments whole as unmapped, and sums to the code's length", () => {
    const code = "one\ntwo\nthree";
    const { bytes } = bytesBySource(code, { sources: ["s.ts"], mappings: "AAAA;;CAAA" });
    expect(Object.fromEntries(bytes)).toEqual({ "s.ts": 7, [UNMAPPED]: 4 });
    expect([...bytes.values()].reduce((a, b) => a + b, 0)).toBe(code.length - 2);
  });
});
