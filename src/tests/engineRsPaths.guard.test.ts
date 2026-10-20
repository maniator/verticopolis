import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

/**
 * Engine path list guard for `.github/workflows/engine-rs.yml` (#1044).
 *
 * The workflow names the engine's files twice: the `push.paths` filter, and
 * the `case` list in the `changes` job that decides whether a PR runs the
 * required `engine-rs` check. If a path lands in one list and not the other,
 * a PR touching only that file would skip the required check and pass it
 * unchecked. This test keeps the two lists identical, with each `**` glob in
 * `push.paths` written as `*` in the shell `case` list (a `case` `*` already
 * crosses `/`).
 */

const here = dirname(fileURLToPath(import.meta.url));
const workflowPath = resolve(
  here,
  "..",
  "..",
  ".github",
  "workflows",
  "engine-rs.yml",
);

function pushPaths(yaml: string): string[] {
  const block =
    /\n {2}push:\n {4}branches: \[main\]\n {4}paths:\n((?: {6}- "[^"]+"\n)+)/.exec(
      yaml,
    );
  if (!block) throw new Error("engine-rs.yml: push.paths block not found");
  return [...block[1].matchAll(/- "([^"]+)"/g)].map((m) =>
    m[1].replace(/\*\*$/, "*"),
  );
}

function casePaths(yaml: string): string[] {
  return [
    ...yaml.matchAll(/^ +case "\$f" in (\S+)\) engine=true ;; esac$/gm),
  ].map((m) => m[1]);
}

describe("engine-rs.yml engine path lists", () => {
  const yaml = readFileSync(workflowPath, "utf8");

  it("finds both lists", () => {
    expect(pushPaths(yaml).length).toBeGreaterThan(30);
    expect(casePaths(yaml).length).toBeGreaterThan(30);
  });

  it("names the same paths in the push filter and the PR changes job", () => {
    expect(casePaths(yaml)).toEqual(pushPaths(yaml));
  });

  it("uses only trailing ** globs, which map to a case *", () => {
    for (const p of pushPaths(yaml))
      expect(p.replace(/\/\*$/, "")).not.toMatch(/\*/);
  });

  it("fails when a path is missing from one list", () => {
    const dropped = yaml.replace(
      /^ +case "\$f" in \.nvmrc\) engine=true ;; esac\n/m,
      "",
    );
    expect(casePaths(dropped)).not.toEqual(pushPaths(dropped));
  });
});

/**
 * The suites that host the engine themselves run in `npm run test:wasm` (#1122).
 *
 * The `integrationWasm` vitest project hands some suites to the TypeScript
 * side (`typescriptSide` in `vite.config.ts`) because they start their own
 * host or compare the two engines directly. If one of them is also missing
 * from `test:wasm`'s file filters, no CI job runs it against the engine, and
 * `engine-rs.yml`'s path filter would not catch that. This test requires
 * every such suite to match a `test:wasm` filter, unless it needs no engine
 * package (listed below with the reason), and requires the always-running
 * `test-wasm-parity` job in `test.yml` to run `npm run test:wasm`.
 */

const root = resolve(here, "..", "..");
const read = (rel: string): string => readFileSync(resolve(root, rel), "utf8");

/** Suites in `typescriptSide` that never touch the engine package, so the plain `test` job runs them. */
const NO_ENGINE_PACKAGE: Record<string, string> = {
  "src/tests/integration/conformance.integration.test.ts":
    "the TypeScript engine against the conformance lock",
  "src/tests/integration/loaderCases.integration.test.ts":
    "the TypeScript loader",
  "src/render/originSeedsSweep.integration.test.ts":
    "pure render in a software raster",
  "src/tests/perfCompare/page.integration.test.ts":
    "the browser digest helper, TypeScript only",
};

function integrationFiles(): string[] {
  return (readdirSync(resolve(root, "src"), { recursive: true }) as string[])
    .map((f) => `src/${f.split("\\").join("/")}`)
    .filter((f) => f.endsWith(".integration.test.ts"));
}

/** The files `wasmParityProjects` leaves to the TypeScript side. */
function typescriptSideFiles(viteConfig: string): string[] {
  const block = /const typescriptSide = \[\n([\s\S]*?)\n {2}\];/.exec(
    viteConfig,
  );
  if (!block) throw new Error("vite.config.ts: typescriptSide list not found");
  const globs = [...block[1].matchAll(/^ +"\*\*\/([^"]+)",$/gm)].map(
    (m) => m[1],
  );
  const files = integrationFiles();
  return globs.flatMap((g) => {
    const hits = files.filter((f) =>
      g.includes("*")
        ? f.includes(`/${g.split("/")[0]}/`) && f.endsWith(g.split("*")[1])
        : f.endsWith(`/${g}`),
    );
    if (hits.length === 0)
      throw new Error(
        `vite.config.ts typescriptSide entry matches no file: ${g}`,
      );
    return hits;
  });
}

/** The positional file filters of the `test:wasm` script. */
function testWasmFilters(script: string): string[] {
  const args = script.replace(/^.*?vitest run\s+/, "").split(/\s+/);
  const filters: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--project") i++;
    else if (!args[i].startsWith("-")) filters.push(args[i]);
  }
  return filters;
}

/** Suites handed to the TypeScript side that no `test:wasm` filter reaches and that need the package. */
function unrun(files: string[], filters: string[]): string[] {
  return files.filter(
    (f) => !(f in NO_ENGINE_PACKAGE) && !filters.some((x) => f.includes(x)),
  );
}

describe("the host suites run in test:wasm", () => {
  const files = typescriptSideFiles(read("vite.config.ts"));
  const script = (
    JSON.parse(read("package.json")) as { scripts: Record<string, string> }
  ).scripts["test:wasm"];
  const filters = testWasmFilters(script);

  it("finds the lists", () => {
    expect(files.length).toBeGreaterThan(10);
    expect(filters).toContain("wasmHost");
  });

  it("matches every typescriptSide suite that needs the engine package", () => {
    expect(unrun(files, filters)).toEqual([]);
  });

  it("covers the six host suites and the perf-compare engine check by name", () => {
    for (const name of [
      "wasmHostAnalyticsBridge",
      "wasmHostLogText",
      "wasmHostTelemetry",
      "wasmWorkerHost",
      "wasmWorkerLifecycle",
      "wasmWorkerSaves",
      "perfCompare/scenarios.integration",
    ])
      expect(
        files.some((f) => f.includes(name)) &&
          filters.some((x) => `src/x/${name}`.includes(x)),
      ).toBe(true);
  });

  it("fails when a filter is dropped", () => {
    expect(
      unrun(
        files,
        filters.filter((x) => x !== "wasmWorker"),
      ).length,
    ).toBeGreaterThan(0);
  });

  it("only lists suites in the exemption table that still exist and are still handed over", () => {
    for (const f of Object.keys(NO_ENGINE_PACKAGE)) expect(files).toContain(f);
  });

  it("runs in the test-wasm-parity job, which every PR and every push to main runs", () => {
    const yaml = read(".github/workflows/test.yml");
    const job =
      /\n {2}test-wasm-parity:\n([\s\S]*?)(?=\n {2}[a-z][\w-]*:\n)/.exec(yaml);
    if (!job) throw new Error("test.yml: test-wasm-parity job not found");
    expect(job[1]).toMatch(/run: npm run test:wasm\n/);
    // A path filter on the workflow would stop it running on a PR that touches only other files.
    expect(yaml.split("\njobs:")[0]).not.toMatch(/^ +paths(-ignore)?:/m);
  });
});
