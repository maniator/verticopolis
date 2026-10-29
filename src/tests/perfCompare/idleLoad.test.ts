import { describe, expect, it } from "vitest";
import type { BrowserContext } from "playwright";
import { idleLoad } from "./idleLoad";
import type { PerfServer } from "./server";

const server = { url: "http://127.0.0.1:1" } as PerfServer;
const within = <T>(_what: string, p: Promise<T>): Promise<T> => p;

/** A context whose page answers each evaluate with the next canned result. */
function fakeContexts(results: (unknown | Error)[]) {
  const made: { closed: boolean; routed: string[]; visited: string[] }[] = [];
  const make = async (): Promise<BrowserContext> => {
    const record = { closed: false, routed: [] as string[], visited: [] as string[] };
    made.push(record);
    const page = {
      route: async (url: string) => void record.routed.push(url),
      goto: async (url: string) => void record.visited.push(url),
      evaluate: async () => {
        const next = results.shift();
        if (next instanceof Error) throw next;
        return next;
      },
    };
    return { newPage: async () => page, close: async () => void (record.closed = true) } as unknown as BrowserContext;
  };
  return { made, make };
}

describe("idleLoad (#1005)", () => {
  it("measures each way in a context of its own, on a blank page the harness answers", async () => {
    const buffered = { responseMs: 1, bodyMs: 2, compileMs: 3, bytes: 4 };
    const streamed = { responseMs: 1, totalMs: 5 };
    const { made, make } = fakeContexts([buffered, streamed]);
    const out = await idleLoad(server, make, within);
    expect(out).toEqual({ buffered, streamed, error: null });
    expect(made).toHaveLength(2);
    for (const c of made) {
      expect(c.closed).toBe(true);
      expect(c.routed).toEqual(["http://127.0.0.1:1/__idle"]);
      expect(c.visited).toEqual(["http://127.0.0.1:1/__idle"]);
    }
  });

  it("leaves a failed way null with its reason and still measures the other", async () => {
    const streamed = { responseMs: 1, totalMs: 5 };
    const { made, make } = fakeContexts([new Error("net::ERR_FAILED"), streamed]);
    const out = await idleLoad(server, make, within);
    expect(out.buffered).toBeNull();
    expect(out.streamed).toEqual(streamed);
    expect(out.error).toBe("buffered: net::ERR_FAILED");
    expect(made.every((c) => c.closed)).toBe(true);
  });
});
