import { describe, expect, it } from "vitest";
import { checkEngineBundle, ENGINE_PACKAGE_FILES, precacheManifest, repoRelativeSource, TOOLING_SIM, type EngineBundleInput } from "./engineBundle";

/** A tooling build that passes: the host, the harnesses' tower and the
 *  engine package precached. */
function bundle(over: Partial<EngineBundleInput> = {}): EngineBundleInput {
  return {
    tooling: true,
    chunks: [{ file: "assets/main-abc.js", sources: ["src/main.ts", TOOLING_SIM, "node_modules/lit-html/lit-html.js"] }],
    precache: ["index.html", "assets/main-abc.js", ...ENGINE_PACKAGE_FILES],
    enginePackageBuilt: true,
    ...over,
  };
}

/** A production build that passes: the host and the stand-in. */
function production(over: Partial<EngineBundleInput> = {}): EngineBundleInput {
  return bundle({ tooling: false, chunks: [{ file: "assets/main-abc.js", sources: ["src/main.ts", "src/game/toolingSimAbsent.ts", "node_modules/lit-html/lit-html.js"] }], ...over });
}

describe("checkEngineBundle", () => {
  it("passes a tooling bundle with the harnesses' tower and a production bundle without it", () => {
    expect(checkEngineBundle(bundle())).toEqual({ errors: [] });
    expect(checkEngineBundle(production())).toEqual({ errors: [] });
  });

  it("fails a production bundle that carries the harnesses' tower (#921)", () => {
    const chunks = [{ file: "assets/main-abc.js", sources: ["src/main.ts", TOOLING_SIM] }];
    expect(checkEngineBundle(production({ chunks })).errors).toEqual([
      `assets/main-abc.js carries the tooling harnesses' tower (${TOOLING_SIM}), which only a VC_TOOLING=1 build may ship`,
    ]);
  });

  it("fails a build that does not precache the engine package", () => {
    expect(checkEngineBundle(production({ precache: ["index.html", "engine/verticopolis_engine.js"] })).errors).toEqual([expect.stringContaining("does not precache the engine package (engine/verticopolis_engine_bg.wasm)")]);
  });

  it("does not ask a build with no engine package to precache one", () => {
    expect(checkEngineBundle(production({ precache: ["index.html"], enginePackageBuilt: false })).errors).toEqual([]);
  });

  it("fails when nothing was read", () => {
    expect(checkEngineBundle(bundle({ chunks: [] })).errors).toEqual([expect.stringContaining("no emitted JavaScript")]);
  });

  it("fails every kind of test code in the bundle, naming it", () => {
    const tests = [{ file: "assets/main.js", sources: ["src/tests/fixtures/towers.ts", "src/foo.test.ts", "e2e/helpers.ts", "src/ui/x.spec.ts", "src/audio/__mocks__/tone.ts"] }];
    const { errors } = checkEngineBundle(bundle({ chunks: tests }));
    expect(errors).toHaveLength(5);
    expect(errors[0]).toBe("assets/main.js carries test code (src/tests/fixtures/towers.ts)");
  });
});

describe("repoRelativeSource", () => {
  it("makes a path repository-relative and drops a module id's query", () => {
    expect(repoRelativeSource("/repo/src/engineBinding/worker.ts?worker_file&type=module", "/repo")).toBe("src/engineBinding/worker.ts");
    expect(repoRelativeSource("/repo/src/game/toolingSim.ts", "/repo")).toBe(TOOLING_SIM);
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
