// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeModule } from "./fakeEngine.fixture";
import type { FromWorker } from "./workerProtocol";

/**
 * What the engine worker does with a package the byte check let through, with
 * the loader stubbed (workerPackageCheck.test.ts covers the check itself): a
 * binding the shell cannot use, or one with no catalog, is a mismatched
 * package, coded as the main-thread host codes it (#1086).
 */
const loaded = vi.hoisted(() => ({ mod: null as unknown, build: null as unknown, lenient: false }));
// The fake engine is not a class, so the cases that need a binding that passes the shape check skip it.
vi.mock("../dualrun/binding", async (importOriginal) => {
  const real = await importOriginal<typeof import("../dualrun/binding")>();
  return { ...real, checkBinding: (m: unknown) => (loaded.lenient ? m : real.checkBinding(m)) };
});
vi.mock("./loadEngineModule", () => ({
  loadEngineModule: vi.fn(async (_url: string, opts?: { onBuild?: (b: unknown) => void }) => {
    if (loaded.build) opts?.onBuild?.(loaded.build);
    return { mod: loaded.mod, exports: {}, verified: true };
  }),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

async function reply(mod: unknown, build: unknown = null, lenient = false): Promise<{ posted: FromWorker[]; last: FromWorker }> {
  loaded.mod = mod;
  loaded.build = build;
  loaded.lenient = lenient;
  const posted: FromWorker[] = [];
  const scope: { postMessage(m: FromWorker): void; onmessage: ((e: { data: unknown }) => void) | null } = { postMessage: (m) => posted.push(m), onmessage: null };
  vi.stubGlobal("self", scope);
  vi.resetModules();
  await import("./engineWorker");
  scope.onmessage?.({ data: { type: "init", url: "http://x/engine/verticopolis_engine.js" } });
  await vi.waitFor(() => expect(posted.some((m) => m.type === "error" || m.type === "ready")).toBe(true));
  return { posted, last: posted[posted.length - 1]! };
}

describe("the engine worker, with a package that passed the byte check", () => {
  it("answers ready for a binding that fits this shell, with the build it reported", async () => {
    const build = { state: "ok", sourceHash: "ab".repeat(32) };
    const { posted, last } = await reply(fakeModule(), build, true);
    expect(posted.map((m) => m.type)).toEqual(["build", "ready"]);
    expect(last).toMatchObject({ type: "ready", build });
  });

  it("codes a binding that lacks what the shell calls as a package mismatch", async () => {
    const { last } = await reply({ default: async () => ({}) });
    expect(last).toMatchObject({ type: "error", fatal: true, reason: "package-mismatch" });
  });

  it("codes a binding with no catalog function as a package mismatch", async () => {
    const mod = fakeModule() as unknown as Record<string, unknown>;
    delete mod.catalog;
    const { last } = await reply(mod, null, true);
    expect(last).toMatchObject({ type: "error", fatal: true, reason: "package-mismatch", message: expect.stringContaining("no catalog") });
  });

  it("sends the build it reported along with a refusal after it", async () => {
    const build = { state: "missing" };
    const { posted } = await reply({ default: async () => ({}) }, build);
    expect(posted.map((m) => m.type)).toEqual(["build", "error"]);
    expect(posted[1]).toMatchObject({ build });
  });
});
