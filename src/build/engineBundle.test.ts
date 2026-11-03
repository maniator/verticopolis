import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { checkEngineBundle, ENGINE_PACKAGE_FILES, parseAllowList, precacheManifest, repoRelativeSource, TS_STEP_LOOP, type EngineBundleInput } from "./engineBundle";

const ROOT = resolve(__dirname, "..", "..");

/** A build that passes: the host, one allowed engine module, and the engine
 *  package precached. */
function bundle(over: Partial<EngineBundleInput> = {}): EngineBundleInput {
  return {
    tooling: false,
    chunks: [{ file: "assets/main-abc.js", sources: ["src/main.ts", "src/wasmhost/wasmHost.ts", "src/engine/Simulation.ts", "node_modules/lit-html/lit-html.js"] }],
    precache: ["index.html", "assets/main-abc.js", ...ENGINE_PACKAGE_FILES],
    enginePackageBuilt: true,
    allowed: ["src/engine/Simulation.ts"],
    ...over,
  };
}

describe("checkEngineBundle", () => {
  it("passes a bundle that carries only listed engine modules", () => {
    expect(checkEngineBundle(bundle())).toEqual({ errors: [], engineModules: ["src/engine/Simulation.ts"] });
  });

  it("fails when a legacy engine import puts the TypeScript step loop back", () => {
    // What a deliberate `import ... from "./engine/sim/loop"` outside
    // Simulation.ts (which the alias does not cover) does to the bundle.
    const chunks = [{ file: "assets/main-abc.js", sources: ["src/main.ts", "src/engine/Simulation.ts", TS_STEP_LOOP] }];
    const { errors } = checkEngineBundle(bundle({ chunks }));
    expect(errors).toContain(`assets/main-abc.js carries the TypeScript step loop (${TS_STEP_LOOP})`);
    expect(errors.some((e) => e.includes("does not list: src/engine/sim/loop.ts"))).toBe(true);
  });

  it("fails on any engine module the allowlist does not name", () => {
    const chunks = [{ file: "assets/lazy-1.js", sources: ["src/engine/Simulation.ts", "src/engine/crowd/motion.ts"] }];
    expect(checkEngineBundle(bundle({ chunks })).errors).toEqual([expect.stringContaining("does not list: src/engine/crowd/motion.ts")]);
  });

  it("fails when a listed module no longer ships, so the list only shrinks", () => {
    expect(checkEngineBundle(bundle({ allowed: ["src/engine/Simulation.ts", "src/engine/Tower.ts"] })).errors).toEqual([expect.stringContaining("no longer ship in the bundle; remove them from scripts/engine-bundle.allow.txt so the list only shrinks: src/engine/Tower.ts")]);
  });

  it("fails a build that does not precache the engine package", () => {
    expect(checkEngineBundle(bundle({ precache: ["index.html", "engine/verticopolis_engine.js"] })).errors).toEqual([expect.stringContaining("does not precache the engine package (engine/verticopolis_engine_bg.wasm)")]);
  });

  it("does not ask a build with no engine package to precache one", () => {
    expect(checkEngineBundle(bundle({ precache: ["index.html"], enginePackageBuilt: false })).errors).toEqual([]);
  });

  it("fails when nothing was read", () => {
    expect(checkEngineBundle(bundle({ chunks: [], allowed: [] })).errors).toEqual([expect.stringContaining("no emitted JavaScript")]);
  });

  it("fails every kind of test code in the bundle", () => {
    const tests = [{ file: "assets/main.js", sources: ["src/tests/fixtures/towers.ts", "src/foo.test.ts", "e2e/helpers.ts", "src/ui/x.spec.ts", "src/audio/__mocks__/tone.ts"] }];
    expect(checkEngineBundle(bundle({ tooling: true, chunks: tests, allowed: [] })).errors).toHaveLength(5);
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
});
