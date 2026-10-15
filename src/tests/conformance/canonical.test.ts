import { describe, it, expect } from "vitest";
import { canonicalJson, digest } from "./canonical";

describe("canonicalJson", () => {
  it("sorts keys by UTF-16 code units at every depth, integer-like keys included", () => {
    expect(canonicalJson({ b: 1, a: { "10": 1, "9": 2, Z: 3 } })).toBe('{"a":{"10":1,"9":2,"Z":3},"b":1}');
  });

  it("drops undefined object values and keeps array order", () => {
    expect(canonicalJson({ x: undefined, y: [3, 1, 2] })).toBe('{"y":[3,1,2]}');
  });

  it("prints numbers as Number#toString does, with -0 as 0", () => {
    expect(canonicalJson([-0, 0.1, 1e21, 1e-7, 123456789.125])).toBe("[0,0.1,1e+21,1e-7,123456789.125]");
  });

  it("escapes strings as the README spells out", () => {
    expect(canonicalJson('"\\/\b\t\n\f\r\u0001\u001f\ud800é')).toBe('"\\"\\\\/\\b\\t\\n\\f\\r\\u0001\\u001f\\ud800é"');
  });

  it("keeps surrogate pairs, DEL and line separators as is and escapes a lone low surrogate", () => {
    expect(canonicalJson("\u{1F600}\u007f\u2028\udc00")).toBe('"\u{1F600}\u007f\u2028\\udc00"');
  });

  it("refuses values the rules cannot describe", () => {
    for (const bad of [NaN, Infinity, new Map(), new Set(), () => 1, [undefined], new Array(2), { d: new Date(0) }]) {
      expect(() => canonicalJson(bad)).toThrow(/canonicalJson/);
    }
  });

  it("hashes to 16 hex digits of SHA-256", () => {
    // sha256('{"a":1}') = 015abd7f5cc57a2dd94b7590f04ad8084273905ee33ec5cebeae62276a97f862
    expect(digest({ a: 1 })).toBe("015abd7f5cc57a2d");
  });
});
