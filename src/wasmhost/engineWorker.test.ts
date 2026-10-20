// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { stampedWasm, wasmFetch } from "./engineLoad.fixture";
import type { FromWorker } from "./workerProtocol";

const HASH = "ab".repeat(32);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

/** The worker entry point on a stand-in scope: it assigns `onmessage` and answers through `postMessage`. */
async function startWorker(): Promise<{ posted: FromWorker[]; send: (msg: unknown) => void; reply: () => Promise<FromWorker> }> {
  const posted: FromWorker[] = [];
  const scope: { postMessage(m: FromWorker): void; onmessage: ((e: { data: unknown }) => void) | null } = {
    postMessage: (m) => posted.push(m),
    onmessage: null,
  };
  vi.stubGlobal("self", scope);
  vi.resetModules();
  await import("./engineWorker");
  return {
    posted,
    send: (msg) => scope.onmessage?.({ data: msg }),
    reply: () => vi.waitFor(() => expect(posted.some((m) => m.type === "error" || m.type === "ready")).toBe(true)).then(() => posted[posted.length - 1]!),
  };
}

describe("the engine worker entry point, when the glue fails to load (#963)", () => {
  // A scheme node cannot import fails at once, like a 404 on a small glue file, while the binary's fetch is still in flight.
  const GLUE = "http://x/engine/verticopolis_engine.js";
  const slowBinary = () => {
    const fast = wasmFetch(stampedWasm(HASH));
    vi.stubGlobal("fetch", (async (u: string | URL) => {
      await new Promise((r) => setTimeout(r, 30));
      return fast(u);
    }) as typeof fetch);
  };

  it("reports the build before it fails, and the error reply carries it", async () => {
    slowBinary();
    const w = await startWorker();
    w.send({ type: "init", url: GLUE });
    const reply = await w.reply();
    expect(w.posted.map((m) => m.type)).toEqual(["build", "error"]);
    expect(w.posted[0]).toEqual({ type: "build", build: { state: "ok", sourceHash: HASH } });
    expect(reply).toMatchObject({ type: "error", fatal: true, build: { state: "ok", sourceHash: HASH } });
  });

  it("sends no build when the binary cannot be fetched", async () => {
    vi.stubGlobal("fetch", wasmFetch(new Uint8Array(), { status: 404, statusText: "Not Found" }));
    const w = await startWorker();
    w.send({ type: "init", url: GLUE });
    const reply = await w.reply();
    expect(w.posted.map((m) => m.type)).toEqual(["error"]);
    expect("build" in reply).toBe(false);
  });
});
