import { describe, expect, it } from "vitest";
import { shellMarks } from "./shellMarks";
import { LayerError } from "./pixels";

const ctx = {} as CanvasRenderingContext2D;

/** Run `marks` ("b" break, "e" end) and report what was saved and restored. */
function run(marks: string): { log: string[]; split: boolean } {
  const log: string[] = [];
  const m = shellMarks(() => log.push("save"), () => log.push("restore"));
  for (const c of marks) (c === "b" ? m.hook.shellEnd : m.hook.furnitureEnd)(ctx);
  return { log, split: m.finish() };
}

describe("shell pass marks", () => {
  it("saves at the break and restores at the first end", () => {
    expect(run("be")).toEqual({ log: ["save", "restore"], split: true });
    // A routine's own end, then drawRoom's: the second is ignored.
    expect(run("bee")).toEqual({ log: ["save", "restore"], split: true });
  });
  it("restores when the paint ends without an end mark", () => {
    expect(run("b")).toEqual({ log: ["save", "restore"], split: true });
  });
  it("ignores the wrapper's end on a paint with no split", () => {
    expect(run("")).toEqual({ log: [], split: false });
    expect(run("e")).toEqual({ log: [], split: false });
  });
  it("refuses a second break and a break after an end", () => {
    expect(() => run("bb")).toThrow(LayerError);
    expect(() => run("eb")).toThrow(/after a layer end/);
  });
  it("sends shell art among the furniture to the shell pass, and draws it plainly elsewhere", () => {
    const log: string[] = [];
    const m = shellMarks(
      () => log.push("save"),
      () => log.push("restore"),
      (draw) => {
        log.push("onShell");
        draw();
      },
    );
    const art = () => log.push("draw");
    m.hook.shellPaint!(ctx, art);
    m.hook.shellEnd(ctx);
    m.hook.shellPaint!(ctx, art);
    m.hook.furnitureEnd(ctx);
    m.hook.shellPaint!(ctx, art);
    expect(log).toEqual(["draw", "save", "onShell", "draw", "restore", "draw"]);
  });
  it("refuses a mark or a second layerShell inside a layerShell", () => {
    const m = shellMarks(() => undefined, () => undefined);
    m.hook.shellEnd(ctx);
    expect(() => m.hook.shellPaint!(ctx, () => m.hook.furnitureEnd(ctx))).toThrow(/inside layerShell/);
    expect(() => m.hook.shellPaint!(ctx, () => m.hook.shellPaint!(ctx, () => undefined))).toThrow(/inside layerShell/);
  });
});
