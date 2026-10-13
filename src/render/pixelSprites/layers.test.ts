import { describe, expect, it } from "vitest";
import { layerBreak, layerEnd, withLayerHook, type LayerHook } from "./layers";

const ctx = {} as CanvasRenderingContext2D;

function recorder(): { hook: LayerHook; seen: string[] } {
  const seen: string[] = [];
  return { seen, hook: { shellEnd: () => seen.push("break"), furnitureEnd: () => seen.push("end") } };
}

describe("depth-layer marks", () => {
  it("do nothing without a hook, which is how the game runs", () => {
    expect(() => {
      layerBreak(ctx);
      layerEnd(ctx);
    }).not.toThrow();
  });
  it("reach the installed hook in order, and only while it is installed", () => {
    const { hook, seen } = recorder();
    expect(withLayerHook(hook, () => (layerBreak(ctx), layerEnd(ctx), 7))).toBe(7);
    layerBreak(ctx);
    expect(seen).toEqual(["break", "end"]);
  });
  it("restore the previous hook when the draw throws, and nest", () => {
    const outer = recorder();
    const inner = recorder();
    withLayerHook(outer.hook, () => {
      expect(() =>
        withLayerHook(inner.hook, () => {
          layerBreak(ctx);
          throw new Error("boom");
        }),
      ).toThrow("boom");
      layerEnd(ctx);
    });
    layerEnd(ctx);
    expect(inner.seen).toEqual(["break"]);
    expect(outer.seen).toEqual(["end"]);
  });
});
