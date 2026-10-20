// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import type { BrowserContext } from "playwright";
import { config, processRun } from "./fixtures";
import { CONTEXT_LOSS_BINDING, contextLossFinding, contextLossLine, trackContextLoss } from "./contextLoss";
import { watchContextLoss } from "./page";
import { validateResults } from "./validate";

/** Lost WebGL contexts (#1136): the page-side listener, the binding, the line a run keeps, and the validation error. */

type Handler = (e: unknown) => void;
const g = globalThis as unknown as { window?: Record<string, unknown>; document?: unknown; performance: Performance };

afterEach(() => {
  delete g.window;
  delete g.document;
});

/** A document that records the one listener the init script adds. */
function fakePage(binding?: (arg: unknown) => void) {
  const added: { type: string; handler: Handler; capture: unknown }[] = [];
  g.document = { addEventListener: (type: string, handler: Handler, capture: unknown) => added.push({ type, handler, capture }) };
  g.window = binding ? { [CONTEXT_LOSS_BINDING]: binding } : {};
  return added;
}

describe("watchContextLoss (the init script)", () => {
  it("listens for webglcontextlost on the document in the capture phase, because the event does not bubble", () => {
    const added = fakePage();
    watchContextLoss();
    expect(added).toHaveLength(1);
    expect(added[0].type).toBe("webglcontextlost");
    expect(added[0].capture).toBe(true);
  });

  it("calls the exposed binding with the canvas that lost its context", () => {
    const calls: unknown[] = [];
    const added = fakePage((a) => calls.push(a));
    watchContextLoss();
    added[0].handler({ target: { id: "game", width: 1280, height: 720 } });
    expect(calls).toEqual([{ at: expect.any(Number), id: "game", width: 1280, height: 720 }]);
  });

  it("copes with an unnamed canvas, a missing binding and a binding that throws", () => {
    const calls: unknown[] = [];
    let added = fakePage((a) => calls.push(a));
    watchContextLoss();
    added[0].handler({ target: {} });
    expect(calls).toEqual([{ at: expect.any(Number), id: "", width: 0, height: 0 }]);
    added = fakePage();
    watchContextLoss();
    expect(() => added[0].handler({ target: null })).not.toThrow();
    added = fakePage(() => {
      throw new Error("the page is closing");
    });
    watchContextLoss();
    expect(() => added[0].handler({ target: { id: "x" } })).not.toThrow();
  });

  it("is self-contained: Playwright serializes it alone, so the binding name is spelled out inside it", () => {
    expect(watchContextLoss.toString()).toContain(`.${CONTEXT_LOSS_BINDING}`);
    expect(watchContextLoss.toString()).not.toMatch(/CONTEXT_LOSS_BINDING/);
  });
});

describe("trackContextLoss and the record line", () => {
  it("exposes the binding on the context and passes each loss on as a record line", async () => {
    const exposed: { name: string; fn: (source: unknown, arg: unknown) => void }[] = [];
    const ctx = { exposeBinding: async (name: string, fn: (source: unknown, arg: unknown) => void) => void exposed.push({ name, fn }) } as unknown as BrowserContext;
    const lines: string[] = [];
    await trackContextLoss(ctx, (l) => lines.push(l));
    expect(exposed.map((e) => e.name)).toEqual([CONTEXT_LOSS_BINDING]);
    exposed[0].fn({}, { at: 8123.4, id: "game", width: 1280, height: 720 });
    expect(lines).toEqual(["WebGL context lost on canvas#game (1280x720) at 8123.4 ms of a page"]);
  });

  it("names a canvas with no id as a canvas", () => {
    expect(contextLossLine({ at: 5, id: "", width: 300, height: 150 })).toBe("WebGL context lost on a canvas (300x150) at 5 ms of a page");
  });
});

describe("contextLossFinding", () => {
  it("is quiet for no losses and for results written before the check", () => {
    expect(contextLossFinding([[], [], []])).toEqual([]);
    expect(contextLossFinding([undefined, undefined])).toEqual([]);
    expect(contextLossFinding([])).toEqual([]);
  });

  it("is one error that counts the process runs and quotes the first loss", () => {
    const errors = contextLossFinding([[], ["WebGL context lost on canvas#game (1280x720) at 900 ms of a page", "second"], ["third"]]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/^2 of 3 process runs lost a WebGL context \(WebGL context lost on canvas#game \(1280x720\) at 900 ms of a page\)/);
  });
});

describe("the compare validation", () => {
  const nodeCheck = { scenario: "small", steps: 10, dt: 2, start: { tsState: "a", wasmState: "a", tsCrowd: "c", wasmCrowd: "c" }, end: { tsState: "b", wasmState: "b", tsCrowd: "d", wasmCrowd: "d" }, match: true, nodeTsMs: 1, nodeWasmMs: 1 };
  const runs = (lost: string[] | undefined) => [processRun(0, "ts"), processRun(0, "wasm"), processRun(1, "wasm"), processRun(1, "ts")].map((r, i) => (i === 2 ? { ...r, contextLost: lost } : r));

  it("fails a run that lost a context, in a full run, a quick run and under a renderer exception", () => {
    const lost = ["WebGL context lost on canvas#game (1280x720) at 900 ms of a page"];
    expect(validateResults(config(), runs(lost), [nodeCheck]).errors.join(" ")).toMatch(/1 of 4 process runs lost a WebGL context/);
    expect(validateResults({ ...config(), quick: true }, runs(lost), [nodeCheck]).errors.join(" ")).toMatch(/lost a WebGL context/);
    expect(validateResults(config(), runs(lost), [nodeCheck], "EX-4").errors.join(" ")).toMatch(/lost a WebGL context/);
  });

  it("passes runs with none lost, or recorded before the check", () => {
    expect(validateResults(config(), runs([]), [nodeCheck]).errors.join(" ")).not.toMatch(/lost a WebGL context/);
    expect(validateResults(config(), runs(undefined), [nodeCheck]).errors.join(" ")).not.toMatch(/lost a WebGL context/);
  });
});
