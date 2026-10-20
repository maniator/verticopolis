// @vitest-environment node
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { customSection, wasmWith } from "./engineLoad.fixture";
import { ENGINE_BUILD_RECORD, ENGINE_GLUE, ENGINE_WASM } from "./enginePackageNames";
import { engineBuildRecord, expectedOf } from "./enginePackageRecord";

/**
 * The byte check on the two worker routes (#985, criterion 5): the engine
 * worker (also the respawn path) and the dual run's worker load through
 * `loadEngineModule` with the production defaults, so a production build
 * refuses a package that is not the one the shell was built with. These
 * entry-point tests run the real worker module on a stand-in scope with the
 * development skip off, serve a package whose binary is another build's, and
 * require the refusal, with nothing imported from the served glue URL (a
 * Blob URL is what the loader imports from, and none is made on a refusal).
 */
const ORIGIN = "http://game.example";
const GLUE_URL = `${ORIGIN}/engine/${ENGINE_GLUE}`;
const enc = (s: string) => new TextEncoder().encode(s);
const sha = (d: Uint8Array | string) => createHash("sha256").update(d).digest("hex");

const glue = enc("export default async function init() {}\n");
const wasm = wasmWith(customSection("pad", new Uint8Array(512).fill(1)));
const salted = wasmWith(customSection("pad", new Uint8Array(512).fill(2)));
const record = engineBuildRecord(glue, wasm, "c".repeat(64), sha);

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});

/** A served package; `binary` is what the binary's URL answers with. */
function servePackage(binary: Uint8Array) {
  const bodies: Record<string, Uint8Array> = {
    [`${ORIGIN}/engine/${ENGINE_BUILD_RECORD}`]: enc(JSON.stringify(record)),
    [GLUE_URL]: glue,
    [`${ORIGIN}/engine/${ENGINE_WASM}`]: binary,
  };
  const requested: string[] = [];
  vi.stubGlobal("fetch", async (u: string | URL) => {
    requested.push(String(u));
    const body = bodies[String(u)];
    return body ? new Response(body as BodyInit) : new Response("no", { status: 404 });
  });
  const makeUrl = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:never");
  return { requested, makeUrl };
}

/** The production load path: the shell's expected package, no development skip. */
function productionShell() {
  vi.stubEnv("DEV", false);
  vi.stubGlobal("__ENGINE_PACKAGE__", expectedOf(record));
  vi.stubGlobal("location", { origin: ORIGIN });
  vi.stubGlobal("navigator", {});
}

async function startWorker<T extends { type: string }>(entry: string): Promise<{ posted: T[]; send: (m: unknown) => void; reply: () => Promise<T> }> {
  const posted: T[] = [];
  const scope: { postMessage(m: T): void; onmessage: ((e: { data: unknown }) => void) | null } = { postMessage: (m) => posted.push(m), onmessage: null };
  vi.stubGlobal("self", scope);
  vi.resetModules();
  await import(/* @vite-ignore */ entry);
  return {
    posted,
    send: (m) => scope.onmessage?.({ data: m }),
    reply: () => vi.waitFor(() => expect(posted.some((m) => m.type === "error" || m.type === "ready")).toBe(true)).then(() => posted[posted.length - 1]!),
  };
}

describe("the engine worker, with the byte check on", () => {
  it("refuses a binary that is another build's, coded for the main thread, and imports nothing", async () => {
    productionShell();
    const served = servePackage(salted);
    const w = await startWorker("./engineWorker");
    w.send({ type: "init", url: GLUE_URL });
    const reply = await w.reply();
    expect(reply).toMatchObject({ type: "error", fatal: true, reason: "package-mismatch", package: { kind: "mismatch", file: "wasm" } });
    expect(w.posted.map((m) => m.type)).toEqual(["error"]);
    expect(served.makeUrl).not.toHaveBeenCalled();
  });

  it("refuses a record that names another package, with no build reported", async () => {
    productionShell();
    vi.stubGlobal("__ENGINE_PACKAGE__", { ...expectedOf(record), package: "d".repeat(64) });
    const served = servePackage(wasm);
    const w = await startWorker("./engineWorker");
    w.send({ type: "init", url: GLUE_URL });
    expect(await w.reply()).toMatchObject({ type: "error", reason: "package-mismatch", package: { kind: "mismatch", file: "build-record" } });
    expect(w.posted.some((m) => m.type === "build")).toBe(false);
    expect(served.makeUrl).not.toHaveBeenCalled();
  });
});

describe("the dual run's worker, with the byte check on", () => {
  it("refuses a binary that is another build's and never reports ready", async () => {
    productionShell();
    const served = servePackage(salted);
    const w = await startWorker<{ type: string; message?: string }>("../dualrun/worker");
    w.send({ type: "init", url: GLUE_URL });
    const reply = await w.reply();
    expect(reply.type).toBe("error");
    expect(reply.message).toContain("could not load the WASM binding");
    expect(reply.message).toContain("not the file this build expects");
    expect(w.posted.some((m) => m.type === "ready")).toBe(false);
    expect(served.makeUrl).not.toHaveBeenCalled();
  });
});
