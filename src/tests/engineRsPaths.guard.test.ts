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

  it("requires the aggregate gate to include fuzz-corpus in its dependencies", () => {
    expect(yaml).toContain("needs: [changes, consumer, rust, wasm-binding, fuzz-corpus]");
  });

  it("allows skipping required engine jobs only when all four are skipped on purpose", () => {
    expect(yaml).toContain('&& [ "$CONSUMER" = skipped ] && [ "$RUST" = skipped ] && [ "$BINDING" = skipped ] && [ "$CORPUS" = skipped ]');
    expect(yaml).toContain('test "$CONSUMER" = success && test "$RUST" = success && test "$BINDING" = success && test "$CORPUS" = success');
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
/** A repo file as text, with Windows line endings folded so the patterns below stay simple. */
const read = (rel: string): string =>
  readFileSync(resolve(root, rel), "utf8").replace(/\r\n/g, "\n");

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
/** What a suite that uses the engine package mentions; the exempt ones must not. */
const ENGINE_USE =
  /wasmEngine|hasWasmPackage|attachWasmHost|verticopolis_engine|loadWebPackage|checkScenario/;

function integrationFiles(): string[] {
  return (readdirSync(resolve(root, "src"), { recursive: true }) as string[])
    .map((f) => `src/${f.split("\\").join("/")}`)
    .filter((f) => f.endsWith(".integration.test.ts"));
}

/** A vitest exclude glob as a regular expression: `**` crosses directories, `*` does not. */
function globToRegExp(glob: string): RegExp {
  const body = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*\//g, "@@ANYDIR@@")
    .replace(/\*/g, "[^/]*")
    .replace(/@@ANYDIR@@/g, "(?:.*/)?");
  return new RegExp(`^${body}$`);
}

/** The files `wasmParityProjects` leaves to the TypeScript side. */
function typescriptSideFiles(viteConfig: string): string[] {
  const block = /const typescriptSide = \[\n([\s\S]*?)\n {2}\];/.exec(
    viteConfig,
  );
  if (!block) throw new Error("vite.config.ts: typescriptSide list not found");
  const entries = block[1]
    .split("\n")
    .filter((l) => l.trim() !== "" && !l.trim().startsWith("//"));
  const files = integrationFiles();
  return entries.flatMap((line) => {
    const glob = /^ +"([^"]+)",$/.exec(line)?.[1];
    if (!glob)
      throw new Error(
        `vite.config.ts typescriptSide: cannot read the entry ${JSON.stringify(line)}`,
      );
    const re = globToRegExp(glob);
    const hits = files.filter((f) => re.test(f));
    if (hits.length === 0)
      throw new Error(
        `vite.config.ts typescriptSide entry matches no file: ${glob}`,
      );
    return hits;
  });
}

/** The positional file filters and the projects of the `test:wasm` script. */
function testWasmArgs(script: string): {
  filters: string[];
  projects: string[];
} {
  const args = script
    .replace(/^(?:cross-env\s+)?VC_REQUIRE_WASM=1 vitest run\s+/, "")
    .split(/\s+/);
  const filters: string[] = [];
  const projects: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--project") projects.push(args[++i]);
    else if (args[i].startsWith("-"))
      throw new Error(
        `test:wasm gained the option ${args[i]}; teach this guard what it takes`,
      );
    else filters.push(args[i]);
  }
  return { filters, projects };
}

/** Vitest matches a filter as a case-insensitive substring of the file path. */
const matches = (file: string, filters: string[]): boolean =>
  filters.some((x) => file.toLowerCase().includes(x.toLowerCase()));

/** Minimum semver tuple in an npm engine range like ">=22.18.0". */
function minTuple(range: string): [number, number, number] | null {
  const m = /(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(range);
  if (!m) return null;
  return [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)];
}

function compareTuple(
  a: [number, number, number],
  b: [number, number, number],
): number {
  for (let i = 0; i < 3; i++) {
    if (a[i] > b[i]) return 1;
    if (a[i] < b[i]) return -1;
  }
  return 0;
}

/** Suites handed to the TypeScript side that no `test:wasm` filter reaches and that need the package. */
function unrun(files: string[], filters: string[]): string[] {
  return files.filter((f) => !(f in NO_ENGINE_PACKAGE) && !matches(f, filters));
}

describe("the host suites run in test:wasm", () => {
  const files = typescriptSideFiles(read("vite.config.ts"));
  const script = (
    JSON.parse(read("package.json")) as { scripts: Record<string, string> }
  ).scripts["test:wasm"];
  const { filters, projects } = testWasmArgs(script);

  it("finds the lists", () => {
    expect(files.length).toBeGreaterThan(10);
    expect(filters).toContain("wasmHost");
  });

  it("requires the package and runs the plain integration project, where the handed-over suites live", () => {
    expect(script).toMatch(/^(?:cross-env\s+)?VC_REQUIRE_WASM=1 vitest run /);
    expect(projects).toEqual(["integration"]);
  });

  it("matches every typescriptSide suite that needs the engine package", () => {
    expect(unrun(files, filters)).toEqual([]);
  });

  it("covers the six host suites and the perf-compare engine check by name", () => {
    for (const name of [
      "src/tests/integration/wasmHostAnalyticsBridge.integration.test.ts",
      "src/tests/integration/wasmHostLogText.integration.test.ts",
      "src/tests/integration/wasmHostTelemetry.integration.test.ts",
      "src/tests/integration/wasmWorkerHost.integration.test.ts",
      "src/tests/integration/wasmWorkerLifecycle.integration.test.ts",
      "src/tests/integration/wasmWorkerSaves.integration.test.ts",
      "src/tests/perfCompare/scenarios.integration.test.ts",
    ])
      expect(
        matches(name, filters),
        `${name} is matched by a test:wasm filter`,
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

  it("keeps the exemption table honest: each file is still handed over and still leaves the engine alone", () => {
    for (const f of Object.keys(NO_ENGINE_PACKAGE)) {
      expect(files).toContain(f);
      expect(
        read(f),
        `${f} now uses the engine package; drop it from the exemptions`,
      ).not.toMatch(ENGINE_USE);
    }
  });

  describe("in test.yml", () => {
    const yaml = read(".github/workflows/test.yml");
    const triggers = yaml.split("\njobs:")[0];
    const jobs = yaml.split("\njobs:")[1];
    const job = (name: string): string => {
      const m = new RegExp(
        `\\n {2}${name}:[^\\n]*\\n([\\s\\S]*?)(?=\\n {2}[a-z][\\w-]*:[^\\n]*\\n|$)`,
      ).exec(jobs);
      if (!m) throw new Error(`test.yml: job ${name} not found`);
      return m[1];
    };

    it("runs on every PR and every push to main, with no path filter", () => {
      expect(triggers).toMatch(/^ {2}push:\n {4}branches: \[main\]\n/m);
      expect(triggers).toMatch(/^ {2}pull_request:\n {4}branches: \[main\]\n/m);
      expect(triggers).not.toMatch(/^ +paths(-ignore)?:/m);
    });

    it("test-wasm-parity runs test:wasm in a step that is never skipped and never allowed to fail", () => {
      const body = job("test-wasm-parity");
      const step =
        /^ {6}- name: Host suites on the WASM engine\n((?: {8}[^\n]*\n)+)/m.exec(
          body,
        );
      if (!step)
        throw new Error("test-wasm-parity: the host suites step is gone");
      expect(step[1]).toMatch(/^ {8}run: npm run test:wasm$/m);
      expect(step[1]).not.toMatch(/\bif:|continue-on-error/);
    });
  });

  describe("cross-env wiring for shell portability", () => {
    const pkg = JSON.parse(read("package.json")) as {
      scripts: Record<string, string>;
      engines: { node: string };
      devDependencies: Record<string, string>;
    };
    const lock = JSON.parse(read("package-lock.json")) as {
      packages?: Record<
        string,
        { version?: string; engines?: { node?: string }; devDependencies?: Record<string, string> }
      >;
    };
    const scripts = pkg.scripts;

    const scriptNames = [
      "test:wasm",
      "test:wasm:parity",
      "perf:capture",
      "screenshots",
    ] as const;

    it("keeps cross-env in scripts that set inline environment variables", () => {
      for (const name of scriptNames) {
        const script = scripts[name];
        expect(script, `${name} is defined`).toBeDefined();
        expect(script, `${name} starts with cross-env`).toMatch(/^cross-env\s+/);
        expect(
          script,
          `${name} keeps an inline environment assignment after cross-env`,
        ).toMatch(/^cross-env\s+[^ ]+=/);
      }
    });

    it("keeps cross-env as a dev dependency and pinned in the lockfile", () => {
      expect(pkg.devDependencies["cross-env"]).toBeTruthy();
      expect(lock.packages?.[""]?.devDependencies?.["cross-env"]).toBeTruthy();
      expect(lock.packages?.["node_modules/cross-env"]?.version).toBeTruthy();
    });

    it("keeps the repo's Node engine compatible with cross-env", () => {
      const repoNode = pkg.engines?.node;
      const crossEnvNode = lock.packages?.["node_modules/cross-env"]?.engines?.node;
      if (!repoNode) throw new Error("package.json: engines.node is missing");
      if (!crossEnvNode)
        throw new Error("package-lock.json: node_modules/cross-env engines.node is missing");
      const repoMin = minTuple(repoNode);
      const crossEnvMin = minTuple(crossEnvNode);
      if (!repoMin || !crossEnvMin)
        throw new Error(
          `cannot compare Node engines: repo=${JSON.stringify(repoNode)} cross-env=${JSON.stringify(crossEnvNode)}`,
        );
      expect(compareTuple(repoMin, crossEnvMin)).not.toBe(-1);
    });
  });
});
