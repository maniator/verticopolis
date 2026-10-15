import { describe, it, expect } from "vitest";
import { firstDifference, ShadowEngine, whereTextsDiffer } from "./shadow";
import type { WasmModule } from "./binding";

describe("firstDifference", () => {
  it("names the first differing path in sorted key order and index order", () => {
    expect(firstDifference({ b: 1, a: [1, 2] }, { b: 1, a: [1, 3] })).toEqual({ path: "$.a[1]", live: 2, shadow: 3 });
    expect(firstDifference({ z: 1, a: { q: "x" } }, { z: 2, a: { q: "y" } })).toEqual({ path: "$.a.q", live: "x", shadow: "y" });
  });
  it("reports a missing key or element, and a type change, at that spot", () => {
    expect(firstDifference({ a: 1 }, {})).toEqual({ path: "$.a", live: 1, shadow: undefined });
    expect(firstDifference([1], [1, 2])).toEqual({ path: "$[1]", live: undefined, shadow: 2 });
    expect(firstDifference({ a: null }, { a: 0 })).toEqual({ path: "$.a", live: null, shadow: 0 });
  });
  it("returns null when nothing differs", () => {
    expect(firstDifference({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toBeNull();
  });
});

describe("whereTextsDiffer", () => {
  it("names the path when the values differ and the character when only the spelling does", () => {
    expect(whereTextsDiffer('{"a":1}', '{"a":2}')).toEqual({ path: "$.a", live: 1, shadow: 2 });
    const d = whereTextsDiffer('{"a":1e21}', '{"a":1e+21}');
    expect(d.path).toMatch(/^text@7 /);
    expect(d.live).toBe('{"a":1e21}');
    expect(d.shadow).toBe('{"a":1e+21}');
  });
});

describe("ShadowEngine", () => {
  const markers = { lastHour: 0, lastDay: 0, lastQuarter: 0, lastMonth: 0 };
  it("refuses every command before a load, frees a replaced engine, and holds no freed handle after a refused save", () => {
    const freed: number[] = [];
    let n = 0;
    const mod = {
      Engine: {
        fromSave: (text: string) => {
          if (text === "bad") throw new Error("refused");
          const id = ++n;
          return { free: () => freed.push(id), tick: () => {} };
        },
      },
    } as unknown as WasmModule;
    const s = new ShadowEngine(mod);
    expect(s.loaded()).toBe(false);
    expect(() => s.apply({ op: "tick", dt: 1 })).toThrow(/load command first/);
    s.apply({ op: "load", gen: 1, save: "{}", markers });
    expect(s.loaded()).toBe(true);
    s.apply({ op: "load", gen: 2, save: "{}", markers });
    expect(freed).toEqual([1]);
    expect(() => s.apply({ op: "load", gen: 3, save: "bad", markers })).toThrow(/refused/);
    expect(freed).toEqual([1, 2]);
    expect(() => s.apply({ op: "tick", dt: 1 })).toThrow(/load command first/);
    s.free();
    expect(freed).toEqual([1, 2]);
  });
});
