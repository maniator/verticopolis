import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { checkEngineBundle, DEFAULT_ENGINE_BUILD, ENGINE_PACKAGE_FILES, parseAllowList, parseEngineBuild, precacheManifest, precacheManifestText, repoRelativeSource, TS_STEP_LOOP, type EngineBundleInput } from "./engineBundle";

const ROOT = resolve(__dirname, "..", "..");

/** A wasm-only build that passes: the host, one allowed engine module, and
 *  the engine package precached. */
function wasmOnly(over: Partial<EngineBundleInput> = {}): EngineBundleInput {
  return {
    build: "wasm-only",
    tooling: false,
    chunks: [{ file: "assets/main-abc.js", sources: ["src/main.ts", "src/wasmhost/wasmHost.ts", "src/engine/Simulation.ts", "node_modules/lit-html/lit-html.js"] }],
    precache: ["index.html", "assets/main-abc.js", ...ENGINE_PACKAGE_FILES],
    stamp: "wasm-only",
    allowed: ["src/engine/Simulation.ts"],
    ...over,
  };
}

describe("parseEngineBuild", () => {
  it("defaults to the switchable build and maps the two names", () => {
    expect(DEFAULT_ENGINE_BUILD).toBe("switchable");
    expect(parseEngineBuild(undefined)).toBe("switchable");
    expect(parseEngineBuild("")).toBe("switchable");
    expect(parseEngineBuild("wasm")).toBe("wasm-only");
    expect(parseEngineBuild("switchable")).toBe("switchable");
  });

  it("refuses anything else rather than build the other mode", () => {
    for (const bad of ["WASM", "ts", "1", "true", "wasm-only", "constructor", "__proto__"]) expect(() => parseEngineBuild(bad)).toThrow(/VC_ENGINE must be/);
  });
});

describe("checkEngineBundle", () => {
  it("passes a wasm-only bundle that carries only listed engine modules", () => {
    expect(checkEngineBundle(wasmOnly())).toEqual({ errors: [], engineModules: ["src/engine/Simulation.ts"] });
  });

  it("fails when a legacy engine import puts the TypeScript step loop back", () => {
    // What a deliberate `import ... from "./engine/sim/loop"` outside
    // Simulation.ts (which the alias does not cover) does to the bundle.
    const chunks = [{ file: "assets/main-abc.js", sources: ["src/main.ts", "src/engine/Simulation.ts", TS_STEP_LOOP] }];
    const { errors } = checkEngineBundle(wasmOnly({ chunks }));
    expect(errors).toContain(`assets/main-abc.js carries the TypeScript step loop (${TS_STEP_LOOP}) in a wasm-only build`);
    expect(errors.some((e) => e.includes("does not list: src/engine/sim/loop.ts"))).toBe(true);
  });

  it("fails on any engine module the allowlist does not name", () => {
    const chunks = [{ file: "assets/lazy-1.js", sources: ["src/engine/Simulation.ts", "src/engine/crowd/motion.ts"] }];
    expect(checkEngineBundle(wasmOnly({ chunks })).errors).toEqual([expect.stringContaining("does not list: src/engine/crowd/motion.ts")]);
  });

  it("fails when a listed module no longer ships, so the list only shrinks", () => {
    expect(checkEngineBundle(wasmOnly({ allowed: ["src/engine/Simulation.ts", "src/engine/Tower.ts"] })).errors).toEqual([expect.stringContaining("no longer ship in the wasm-only bundle; remove them from scripts/engine-bundle.allow.txt so the list only shrinks: src/engine/Tower.ts")]);
  });

  it("fails a wasm-only build that carries the engine switch or the dual run", () => {
    const chunks = [{ file: "assets/main.js", sources: ["src/engine/Simulation.ts", "src/wasmhost/engineChoice.ts", "src/dualrun/dualRun.ts"] }, { file: "assets/worker-x.js", sources: ["src/dualrun/worker.ts"] }];
    const { errors } = checkEngineBundle(wasmOnly({ chunks, tooling: true }));
    expect(errors).toEqual([
      "assets/main.js carries the runtime engine switch (src/wasmhost/engineChoice.ts) in a wasm-only build",
      "assets/main.js carries the dual run (src/dualrun/dualRun.ts) in a wasm-only build",
      "assets/worker-x.js carries the dual-run worker (src/dualrun/worker.ts) in a wasm-only build",
    ]);
  });

  it("fails a wasm-only build that does not precache the engine package", () => {
    expect(checkEngineBundle(wasmOnly({ precache: ["index.html", "engine/verticopolis_engine.js"] })).errors).toEqual([expect.stringContaining("does not precache the engine package (engine/verticopolis_engine_bg.wasm)")]);
  });

  it("fails when the build's stamp names another mode", () => {
    expect(checkEngineBundle(wasmOnly({ stamp: "switchable" })).errors).toEqual([expect.stringContaining('records engine build "switchable"')]);
    expect(checkEngineBundle(wasmOnly({ stamp: undefined })).errors).toEqual([expect.stringContaining("records engine build undefined")]);
  });

  it("fails when nothing was read", () => {
    expect(checkEngineBundle(wasmOnly({ chunks: [], allowed: [] })).errors).toEqual([expect.stringContaining("no emitted JavaScript")]);
  });

  it("lets a switchable build carry the TypeScript engine and the switch, but no test code", () => {
    const chunks = [{ file: "assets/main.js", sources: [TS_STEP_LOOP, "src/wasmhost/engineChoice.ts", "src/engine/crowd/motion.ts"] }];
    const ok = checkEngineBundle({ build: "switchable", tooling: false, chunks, precache: [], stamp: "switchable", allowed: [] });
    expect(ok.errors).toEqual([]);
    expect(ok.engineModules).toEqual(["src/engine/crowd/motion.ts", TS_STEP_LOOP]);
    const tests = [{ file: "assets/main.js", sources: [TS_STEP_LOOP, "src/tests/fixtures/towers.ts", "src/foo.test.ts", "e2e/helpers.ts", "src/ui/x.spec.ts", "src/audio/__mocks__/tone.ts"] }];
    expect(checkEngineBundle({ build: "switchable", tooling: true, chunks: tests, precache: [], stamp: "switchable", allowed: [] }).errors).toHaveLength(5);
  });

  it("fails a switchable build that lost the TypeScript step loop (a wasm-only swap leaked)", () => {
    const chunks = [{ file: "assets/main.js", sources: ["src/engine/Simulation.ts"] }];
    expect(checkEngineBundle({ build: "switchable", tooling: false, chunks, precache: [], stamp: "switchable", allowed: [] }).errors).toEqual([expect.stringContaining("does not carry the TypeScript step loop")]);
  });

  it("keeps the dual run out of a player build and lets a tooling build keep it", () => {
    const chunks = [{ file: "assets/main.js", sources: [TS_STEP_LOOP] }, { file: "assets/worker-x.js", sources: ["src/dualrun/worker.ts"] }];
    const base = { build: "switchable" as const, chunks, precache: [], stamp: "switchable", allowed: [] };
    expect(checkEngineBundle({ ...base, tooling: false }).errors).toEqual(["assets/worker-x.js carries the dual run (src/dualrun/worker.ts), a tooling-only switch, in a player build"]);
    expect(checkEngineBundle({ ...base, tooling: true }).errors).toEqual([]);
  });
});

describe("parseAllowList", () => {
  it("reads one module per line and ignores comments and blanks", () => {
    expect(parseAllowList("# head\n\nsrc/engine/Tower.ts # why\nsrc/engine/Clock.ts\r\n")).toEqual({ modules: ["src/engine/Tower.ts", "src/engine/Clock.ts"], errors: [] });
  });

  it("refuses a duplicate or a path outside the engine", () => {
    expect(parseAllowList("src/engine/Tower.ts\nsrc/engine/Tower.ts\nsrc/ui/UI.ts").errors).toEqual(["line 2: src/engine/Tower.ts is listed twice", "line 3: src/ui/UI.ts is not under src/engine/"]);
  });

  it("the committed list parses cleanly, names files that exist, and leaves out the step loop", () => {
    const { modules, errors } = parseAllowList(readFileSync(resolve(ROOT, "scripts", "engine-bundle.allow.txt"), "utf8"));
    expect(errors).toEqual([]);
    expect(modules.length).toBeGreaterThan(0);
    expect(modules.filter((m) => !existsSync(resolve(ROOT, m)))).toEqual([]);
    expect(modules).not.toContain(TS_STEP_LOOP);
  });
});

describe("repoRelativeSource", () => {
  it("makes a path repository-relative and drops a module id's query", () => {
    expect(repoRelativeSource("/repo/src/dualrun/worker.ts?worker_file&type=module", "/repo")).toBe("src/dualrun/worker.ts");
    expect(repoRelativeSource("/repo/src/engine/sim/loop.ts", "/repo")).toBe(TS_STEP_LOOP);
    expect(repoRelativeSource("/elsewhere/x.ts#frag", "/repo")).toBe("elsewhere/x.ts");
  });
});

describe("precacheManifest", () => {
  it("reads only the precacheAndRoute array", () => {
    const sw = 'e.precacheAndRoute([{url:"index.html",revision:"1"},{url:"./engine/verticopolis_engine.js",revision:null}],{});e.registerRoute(new e.NavigationRoute({url:"engine/verticopolis_engine_bg.wasm"}))';
    expect(precacheManifest(sw)).toEqual(["index.html", "engine/verticopolis_engine.js"]);
  });

  it("is null when there is no manifest", () => {
    expect(precacheManifest("self.skipWaiting()")).toBeNull();
    expect(precacheManifest("precacheAndRoute(")).toBeNull();
    // An inlined runtime's definition comes first and is skipped.
    expect(precacheManifest('function precacheAndRoute(e,t){x([e])}precacheAndRoute([{url:"a.js",revision:"1"}])')).toEqual(["a.js"]);
  });

  it("finds the array of a worker built from src/sw.ts, where the call's name is minified", () => {
    const sw = 'function Ne(e){return[e]}Ne([{url:"index.html",revision:"1",integrity:"sha256-x"},{url:"assets/a.js",revision:null}]);Ie(new Ce(Re("index.html"),{denylist:[/\\/engine\\//]}))';
    expect(precacheManifest(sw)).toEqual(["index.html", "assets/a.js"]);
    // The built worker quotes the keys and sorts them, so the url comes last.
    expect(precacheManifest('ce([{"integrity":"sha256-x","revision":"1","url":"index.html"},{"revision":null,"url":"assets/a.js"}]);')).toEqual(["index.html", "assets/a.js"]);
    expect(precacheManifestText(sw)).toBe('[{url:"index.html",revision:"1",integrity:"sha256-x"},{url:"assets/a.js",revision:null}]');
  });

  it("is null for an array that never closes, or one whose entries have no url", () => {
    expect(precacheManifestText('x([{url:"a.js",revision:"1"}')).toBeNull();
    expect(precacheManifestText('x([{revision:"1",path:"a.js"}])')).toBeNull();
    expect(precacheManifestText('x([1,2],{url:"a.js"})')).toBeNull();
  });
});
