// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { compileEngineBinary, engineBinaryUrl, initEngineGlue } from "./engineLoad";
import { EMPTY_WASM, buildSectionWith, customSection, stampedWasm, wasmFetch, wasmWith } from "./engineLoad.fixture";
import { ENGINE_WASM } from "./enginePackageNames";

const HASH = "ab".repeat(32);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("compileEngineBinary", () => {
  it("reads the stamped source hash", async () => {
    vi.stubGlobal("fetch", wasmFetch(stampedWasm(HASH)));
    const { module, build } = await compileEngineBinary("http://x/e.wasm");
    expect(module).toBeInstanceOf(WebAssembly.Module);
    expect(build).toEqual({ state: "ok", sourceHash: HASH });
  });

  it("reports a binary with no section as missing, and still compiles it", async () => {
    vi.stubGlobal("fetch", wasmFetch(EMPTY_WASM));
    const { module, build } = await compileEngineBinary("http://x/e.wasm");
    expect(module).toBeInstanceOf(WebAssembly.Module);
    expect(build).toEqual({ state: "missing" });
  });

  it.each([
    ["text that is not JSON", buildSectionWith("not json"), "not JSON"],
    ["another schema", buildSectionWith('{"schema":2,"sourceHash":"' + HASH + '"}'), "not schema 1"],
    ["a hash that is not 64 hex digits", buildSectionWith('{"schema":1,"sourceHash":"ABC"}'), "bad source hash"],
  ])("reports %s as malformed", async (_name, section, why) => {
    vi.stubGlobal("fetch", wasmFetch(wasmWith(section)));
    expect((await compileEngineBinary("http://x/e.wasm")).build).toEqual({ state: "malformed", why });
  });

  it("reports two sections as malformed", async () => {
    const section = buildSectionWith('{"schema":1,"sourceHash":"' + HASH + '"}');
    vi.stubGlobal("fetch", wasmFetch(wasmWith(section, section)));
    expect((await compileEngineBinary("http://x/e.wasm")).build).toEqual({ state: "malformed", why: "2 verticopolis.build sections" });
  });

  it("ignores custom sections with other names", async () => {
    vi.stubGlobal("fetch", wasmFetch(wasmWith(customSection("name", new Uint8Array([1, 2, 3])), buildSectionWith('{"schema":1,"sourceHash":"' + HASH + '"}'))));
    expect((await compileEngineBinary("http://x/e.wasm")).build).toEqual({ state: "ok", sourceHash: HASH });
  });

  it("compiles from the bytes when the server does not send application/wasm", async () => {
    vi.stubGlobal("fetch", wasmFetch(stampedWasm(HASH), { type: "application/octet-stream" }));
    expect((await compileEngineBinary("http://x/e.wasm")).build).toEqual({ state: "ok", sourceHash: HASH });
  });

  it("does not hide a binary that is not valid WebAssembly behind the bytes fallback", async () => {
    const compile = vi.spyOn(WebAssembly, "compile");
    vi.stubGlobal("fetch", wasmFetch(new Uint8Array([1, 2, 3, 4])));
    await expect(compileEngineBinary("http://x/e.wasm")).rejects.toThrow();
    expect(compile).not.toHaveBeenCalled();
    compile.mockRestore();
  });

  it("refuses a response that is not ok, naming the URL", async () => {
    vi.stubGlobal("fetch", wasmFetch(EMPTY_WASM, { status: 404, statusText: "Not Found" }));
    await expect(compileEngineBinary("http://x/e.wasm")).rejects.toThrow("failed to fetch Wasm: 404 Not Found fetching 'http://x/e.wasm'");
  });

  it("refuses bytes that are not WebAssembly", async () => {
    vi.stubGlobal("fetch", wasmFetch(new Uint8Array([1, 2, 3, 4])));
    await expect(compileEngineBinary("http://x/e.wasm")).rejects.toThrow();
  });
});

describe("the built engine binary", () => {
  it("carries the source hash BUILD.json records, as the page reads it", async () => {
    const dir = resolve(__dirname, "../public/engine");
    const bytes = readFileSync(resolve(dir, ENGINE_WASM));
    const record = JSON.parse(readFileSync(resolve(dir, "BUILD.json"), "utf8")) as { sources: string };
    vi.stubGlobal("fetch", wasmFetch(bytes));
    const { build } = await compileEngineBinary("http://x/e.wasm");
    expect(build).toEqual({ state: "ok", sourceHash: record.sources });
  });
});

describe("engineBinaryUrl", () => {
  it("is the binary beside the glue, under a relocated base too", () => {
    expect(engineBinaryUrl("https://x.test/engine/verticopolis_engine.js")).toBe(`https://x.test/engine/${ENGINE_WASM}`);
    expect(engineBinaryUrl("https://x.test/game/engine/verticopolis_engine.js")).toBe(`https://x.test/game/engine/${ENGINE_WASM}`);
  });
});

describe("initEngineGlue", () => {
  const glue = (body: string) => `data:text/javascript,${encodeURIComponent(body)}`;

  it("hands the compiled module to the glue's init and reports the build first", async () => {
    vi.stubGlobal("fetch", wasmFetch(stampedWasm(HASH)));
    const seen: string[] = [];
    const url = glue("export default async function init(arg) { globalThis.__initArg = arg; return { memory: 'm' }; }");
    const { exports } = await initEngineGlue(url, { wasmUrl: "http://x/e.wasm", onBuild: (b) => seen.push(b.state) });
    const arg = (globalThis as { __initArg?: { module_or_path: unknown } }).__initArg;
    expect(arg?.module_or_path).toBeInstanceOf(WebAssembly.Module);
    expect(seen).toEqual(["ok"]);
    expect(exports).toEqual({ memory: "m" });
  });

  it("fetches the binary named in the options", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", (async (u: string | URL) => {
      calls.push(String(u));
      return wasmFetch(EMPTY_WASM)(u);
    }) as typeof fetch);
    await initEngineGlue(glue("export default async function init() {}"), { wasmUrl: `http://x/engine/${ENGINE_WASM}` });
    expect(calls).toEqual([`http://x/engine/${ENGINE_WASM}`]);
  });

  it("still reports the build when the glue then fails to initialize", async () => {
    vi.stubGlobal("fetch", wasmFetch(wasmWith()));
    const seen: string[] = [];
    const url = glue("export default async function init() { throw new Error('link failed'); }");
    await expect(initEngineGlue(url, { wasmUrl: "http://x/e.wasm", onBuild: (b) => seen.push(b.state) })).rejects.toThrow("link failed");
    expect(seen).toEqual(["missing"]);
  });

  it("reports the build even when the glue cannot be imported", async () => {
    vi.stubGlobal("fetch", wasmFetch(stampedWasm(HASH)));
    const seen: string[] = [];
    await expect(
      initEngineGlue("data:text/javascript,throw new Error('glue failed')", { wasmUrl: "http://x/e.wasm", onBuild: (b) => seen.push(b.state) }),
    ).rejects.toThrow();
    expect(seen).toEqual(["ok"]);
  });

  it("does not report a build when the binary cannot be fetched", async () => {
    vi.stubGlobal("fetch", wasmFetch(EMPTY_WASM, { status: 500 }));
    const seen: string[] = [];
    const url = glue("export default async function init() {}");
    await expect(initEngineGlue(url, { wasmUrl: "http://x/e.wasm", onBuild: (b) => seen.push(b.state) })).rejects.toThrow("failed to fetch Wasm");
    expect(seen).toEqual([]);
  });
});
