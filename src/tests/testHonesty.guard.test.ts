import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { repoRel, repoRoot, sourceFiles } from "./guardFiles";
import { isTestFile, resolveRelative, scanRuntimeImports } from "./importScan";

/**
 * Tests that test something, at the tier they claim.
 *
 * PR #1923 converted unit tests to replay recorded engine answers: a stand-in
 * port played back what the Rust engine had once said, and the tests asserted
 * the values in the recording. They passed whatever the code under test did.
 * The owner's standard (CONTRIBUTING.md, "Testing & coverage") is:
 *
 * - A **unit** test (`*.test.ts`) mocks the engine port with `vi.fn` spies,
 *   uses JSON fixtures only as the canned answers those spies return, and
 *   asserts the calls the code made and what it did with the answers.
 * - A check that needs the real engine is an **integration** test
 *   (`*.integration.test.ts`) or a Rust test in the engine repository.
 * - Every test asserts something about the code it names.
 *
 * This guard holds the parts of that a machine can check:
 *
 * 1. No unit test reaches a module that starts a real engine
 *    ({@link ENGINE_RUNNERS}), directly or through test-support code. Its
 *    package probe (`hasWasmPackage`) starts nothing and is allowed.
 * 2. No recorded engine answers: no `recordings` directory, no `*:record`
 *    script, and no module named for recordings beyond the allowlist.
 * 3. Every `it`/`test` in the unit, integration and e2e tiers asserts, in its
 *    body or through a helper in the same file that does (a callback passed by
 *    name counts only when it is such a helper). Only real calls count: a
 *    comment or a string that mentions `expect` does not. A test wrapper
 *    that forwards its body (like `itTdt`) is not followed and needs an
 *    allowlist line.
 *
 * What it cannot check (a test named for a behavior that only asserts "does
 * not throw", a fixture that asserts its own canned answer back) is review
 * work: the review skills and the PR reviewers carry the same rule.
 */

/** Test-only modules that start a real engine (the Rust WASM package in Node,
 *  the `.TDT` codec over it, the port kit that drives it). */
const ENGINE_RUNNERS: readonly string[] = [
  "src/tests/conformance/wasmEngine",
  "src/tests/conformance/tdtWasm",
  "src/tests/portKit/portSim",
  "src/tests/portKit/drafts",
  "src/tests/portKit/draftFixtures",
  "src/tests/portKit/tooling",
  "src/build/rollbackRehearsalNode",
];

/** Names a unit test may import from the Node engine loader: they check
 *  whether the package is built and start nothing. */
const PACKAGE_PROBES: ReadonlySet<string> = new Set(["hasWasmPackage"]);

/** Built engine packages, which only an integration test may load. */
const ENGINE_PACKAGES = ["@verticopolis/engine/web/", "@verticopolis/engine/tooling/", "src/public/engine/"] as const;

const isRunner = (rel: string): boolean => ENGINE_RUNNERS.includes(rel);
const isUnitTest = (rel: string): boolean => /\.test\.tsx?$/.test(rel) && !/\.integration\.test\.tsx?$/.test(rel);
/** Test-support code a unit test's reach is followed through: production
 *  modules are the code under test, which a unit test mocks at its boundary. */
const isTestSupport = (rel: string): boolean =>
  (rel.startsWith("src/tests/") && !isTestFile(rel)) || /\.fixture\.tsx?$/.test(rel);

/** The names a file imports at runtime from `spec`, or null when it imports
 *  the module whole (a namespace, a default, a side effect, a dynamic import). */
function namedImports(source: ts.SourceFile, spec: string): string[] | null {
  const names: string[] = [];
  let whole = false;
  source.forEachChild((node) => {
    if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      node.moduleSpecifier.text === spec &&
      !node.isTypeOnly
    ) {
      // A fixture that re-exports a runner hands it on: count what it passes.
      if (!node.exportClause || !ts.isNamedExports(node.exportClause)) return void (whole = true);
      for (const e of node.exportClause.elements) if (!e.isTypeOnly) names.push((e.propertyName ?? e.name).text);
      return;
    }
    if (
      !ts.isImportDeclaration(node) ||
      !ts.isStringLiteral(node.moduleSpecifier) ||
      node.moduleSpecifier.text !== spec
    )
      return;
    const clause = node.importClause;
    if (clause?.isTypeOnly) return;
    if (!clause || clause.name || !clause.namedBindings || !ts.isNamedImports(clause.namedBindings))
      return void (whole = true);
    for (const e of clause.namedBindings.elements) if (!e.isTypeOnly) names.push((e.propertyName ?? e.name).text);
  });
  return whole ? null : names;
}

/** The modules a file loads through `vi.importActual` or `require`, which the
 *  import scan does not read; each hands back the whole module. */
function wholeLoads(source: ts.SourceFile): Array<{ spec: string; kind: "dynamic" }> {
  const out: Array<{ spec: string; kind: "dynamic" }> = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && /^(vi\.importActual|require)$/.test(node.expression.getText(source))) {
      const arg = node.arguments[0];
      if (arg && ts.isStringLiteralLike(arg)) out.push({ spec: arg.text, kind: "dynamic" });
    }
    node.forEachChild(visit);
  };
  visit(source);
  return out;
}

/** The source file an extensionless module path names, if one exists. */
const sourceOf = (base: string, has: (rel: string) => boolean): string | undefined =>
  [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`].find(has);

/** One module a file loads: the specifier as written, the repo-relative path
 *  it resolves to (none for a package), and for a runner, the names a static
 *  import takes from it (null when it takes the whole module). */
type Load = { raw: string; target: string | null; names: string[] | null };

/** What each file loads, read and parsed once per `read` and shared by every
 *  test that walks through it: a fixture many tests import is not parsed
 *  again for each (#1240). */
const loadsCache = new WeakMap<(rel: string) => string, Map<string, Load[]>>();

function loadsOf(rel: string, read: (rel: string) => string): Load[] {
  let byFile = loadsCache.get(read);
  if (!byFile) loadsCache.set(read, (byFile = new Map()));
  const cached = byFile.get(rel);
  if (cached) return cached;
  const text = read(rel);
  const source = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true);
  const loads = [...scanRuntimeImports(rel, text, source).imports, ...wholeLoads(source)].map(
    ({ spec, kind }): Load => {
      const target = resolveRelative(rel, spec);
      // A dynamic import hands back the whole module, so only static named
      // imports of the probes pass.
      const names = target && isRunner(target) && kind === "static" ? namedImports(source, spec) : null;
      return { raw: target ?? spec, target, names };
    },
  );
  byFile.set(rel, loads);
  return loads;
}

/** How one unit test reaches an engine runner or package, or null when it does
 *  not: the chain of modules from the test to the runner. `has` says whether
 *  a repo-relative file exists. */
function engineReach(test: string, read: (rel: string) => string, has: (rel: string) => boolean): string | null {
  const seen = new Set<string>();
  const walk = (rel: string, chain: string[]): string | null => {
    if (seen.has(rel)) return null;
    seen.add(rel);
    for (const { raw, target, names } of loadsOf(rel, read)) {
      if (ENGINE_PACKAGES.some((p) => raw.includes(p))) return [...chain, rel, raw].join(" -> ");
      if (!target) continue;
      if (isRunner(target)) {
        if (names !== null && names.every((n) => PACKAGE_PROBES.has(n))) continue;
        return [...chain, rel, target].join(" -> ");
      }
      const file = sourceOf(target, has);
      if (file && isTestSupport(file)) {
        const found = walk(file, [...chain, rel]);
        if (found) return found;
      }
    }
    return null;
  };
  return walk(test, []);
}

/** The name a call is made through: `expect` for `expect(x).toBe(y)`,
 *  `expect.soft(x)` or `expect.poll(f)`, `check` for `check(n)`. */
function callRoot(call: ts.CallExpression): string | null {
  let e: ts.Expression = call.expression;
  for (;;) {
    if (ts.isPropertyAccessExpression(e) || ts.isElementAccessExpression(e)) e = e.expression;
    else if (ts.isCallExpression(e)) e = e.expression;
    else if (ts.isNonNullExpression(e) || ts.isParenthesizedExpression(e)) e = e.expression;
    else break;
  }
  return ts.isIdentifier(e) ? e.text : null;
}

/** True for a function a call receives as an argument (`waitFor(() => ...)`,
 *  `items.map((x) => ...)`): the callee is taken to run it. Any other nested
 *  function only runs when something calls it by name. */
function passedToCall(fn: ts.Node): boolean {
  const parent = fn.parent;
  return (
    (ts.isCallExpression(parent) || ts.isNewExpression(parent)) &&
    (parent.arguments?.some((arg) => arg === fn) ?? false)
  );
}

/** True when `node` makes a call that `asserts` accepts. Comments and strings
 *  are not calls, so a body that only mentions `expect` does not count, and a
 *  nested function that nothing runs (`const verify = () => expect(x)`) does
 *  not count either: it asserts only where it is called. */
function callsAny(node: ts.Node, asserts: (call: ts.CallExpression) => boolean): boolean {
  let found = false;
  const visit = (n: ts.Node): void => {
    if (found) return;
    if (n !== node && ts.isFunctionLike(n) && !passedToCall(n)) return;
    if (ts.isCallExpression(n) && asserts(n)) return void (found = true);
    n.forEachChild(visit);
  };
  visit(node);
  return found;
}

/** Modifiers a test registration may chain (`it.concurrent.each(rows)`);
 *  `skip` and `todo` register nothing that runs. */
const TEST_MODIFIERS = new Set(["only", "concurrent", "sequential", "fails", "each", "for", "skipIf", "runIf"]);

/** True when `callee` registers a running test: `it` or `test`, followed by
 *  any chain of modifiers and their calls. */
function registersTest(callee: ts.Expression): boolean {
  let e = callee;
  for (;;) {
    if (ts.isCallExpression(e)) e = e.expression;
    else if (ts.isPropertyAccessExpression(e) && TEST_MODIFIERS.has(e.name.text)) e = e.expression;
    else return ts.isIdentifier(e) && (e.text === "it" || e.text === "test");
  }
}

/** The scope a declaration lives in: the nearest block, module or file. */
function scopeOf(node: ts.Node): ts.Node {
  let n = node.parent;
  while (!ts.isBlock(n) && !ts.isSourceFile(n) && !ts.isModuleBlock(n) && !ts.isCaseClause(n) && !ts.isDefaultClause(n))
    n = n.parent;
  return n;
}

/** Every `it`/`test` call in a file whose body asserts nothing, as
 *  `file > title` with the title as written in the source (a line number would
 *  move under every edit above it). A body asserts when it calls `expect` or
 *  `assert`, or a function declared in the same file that does, resolved in
 *  the caller's own lexical scope so another test's same-named helper does not
 *  stand in for it. */
export function assertionFreeTests(rel: string, text: string): string[] {
  const source = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true);
  /** Per scope, the helpers declared in it by name, as their bodies. */
  const scopes = new Map<ts.Node, Map<string, ts.Node>>();
  const declare = (at: ts.Node, name: string, body: ts.Node) => {
    const scope = scopeOf(at);
    scopes.set(scope, (scopes.get(scope) ?? new Map<string, ts.Node>()).set(name, body));
  };
  const collect = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name && node.body) declare(node, node.name.text, node.body);
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
    ) {
      declare(node, node.name.text, node.initializer.body);
    }
    node.forEachChild(collect);
  };
  collect(source);
  /** The helper body `name` names where `at` uses it, or undefined. */
  const resolveName = (name: string, at: ts.Node): ts.Node | undefined => {
    for (let n: ts.Node | undefined = at.parent; n; n = n.parent) {
      const body = scopes.get(n)?.get(name);
      if (body) return body;
    }
    return undefined;
  };
  const asserting = new Set<ts.Node>();
  const assertsThrough = (name: string, at: ts.Node): boolean => {
    const body = resolveName(name, at);
    return body !== undefined ? asserting.has(body) : name === "expect" || name === "assert";
  };
  const isAssertCall = (call: ts.CallExpression): boolean => {
    const root = callRoot(call);
    return root !== null && assertsThrough(root, call);
  };
  const helpers = [...scopes.values()].flatMap((m) => [...m.values()]);
  for (let grew = true; grew;) {
    grew = false;
    for (const body of helpers) {
      if (!asserting.has(body) && callsAny(body, isAssertCall)) {
        asserting.add(body);
        grew = true;
      }
    }
  }
  const out: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      if (registersTest(node.expression)) {
        const body = node.arguments
          .slice(1)
          .find((a) => ts.isArrowFunction(a) || ts.isFunctionExpression(a) || ts.isIdentifier(a));
        // A callback passed by name asserts only when it is a same-file helper that does.
        const named = body && ts.isIdentifier(body) ? resolveName(body.text, body) : undefined;
        const asserts =
          body && (ts.isIdentifier(body) ? named !== undefined && asserting.has(named) : callsAny(body, isAssertCall));
        if (body && !asserts) out.push(`${rel} > ${node.arguments[0]?.getText(source) ?? ""}`);
      }
    }
    node.forEachChild(visit);
  };
  visit(source);
  return out;
}

/** `testHonesty.allow.txt`: `<entry> # <reason>` per line, every entry with a
 *  reason. Entries are files (rule 1, rule 2) or `file > title` (rule 3). */
function parseAllow(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim() || raw.trim().startsWith("#")) continue;
    const [entry, reason] = raw.split(/\s+#\s+/);
    if (!reason?.trim()) throw new Error(`testHonesty.allow.txt: "${raw.trim()}" gives no reason`);
    out.set(entry.trim(), reason.trim());
  }
  return out;
}

const read = (rel: string): string => readFileSync(resolve(repoRoot, rel), "utf8");
const exists = (rel: string): boolean => existsSync(resolve(repoRoot, rel));
const allow = parseAllow(read("src/tests/testHonesty.allow.txt"));
const srcTests = sourceFiles("src", [".ts", ".tsx"])
  .map(repoRel)
  .filter((rel) => !rel.endsWith(".d.ts"));
const e2eSpecs = sourceFiles("e2e", [".ts"])
  .map(repoRel)
  .filter((rel) => rel.endsWith(".spec.ts"));
const unitTests = srcTests.filter(isUnitTest);
/** Compile-time suites: their checks are type errors, so a body need not call expect. */
const isTypeSuite = (rel: string): boolean => rel.endsWith(".types.test.ts");
const assertingTiers = [...srcTests.filter((rel) => /\.test\.tsx?$/.test(rel) && !isTypeSuite(rel)), ...e2eSpecs];

describe("unit tests mock the engine; integration tests run it", () => {
  it("scans the unit tier", () => {
    expect(unitTests.length).toBeGreaterThan(300);
    expect(unitTests.some((rel) => rel.endsWith(".integration.test.ts"))).toBe(false);
  });

  it("finds a unit test that runs the engine, directly or through a fixture, and lets the package probes through", () => {
    const files: Record<string, string> = {
      "src/game/a.test.ts": 'import { wasm } from "../tests/conformance/wasmEngine";',
      "src/game/b.test.ts": 'import { hasWasmPackage } from "../tests/conformance/wasmEngine";',
      "src/game/c.test.ts": 'import { draft } from "./c.fixture";',
      "src/game/c.fixture.ts": 'import { newDraft } from "../tests/portKit/drafts";',
      "src/game/d.test.ts": 'import { boot } from "./boot";',
      "src/game/boot.ts": 'import { wasm } from "../tests/conformance/wasmEngine";',
      "src/game/e.test.ts": 'const pkg = await import("@verticopolis/engine/tooling/node/verticopolis_engine.js");',
      "src/game/f.test.ts": 'import { start } from "./f.fixture";',
      "src/game/f.fixture.ts": 'export { wasm as start } from "../tests/conformance/wasmEngine";',
      "src/game/g.test.ts": 'const { wasm } = await import("../tests/conformance/wasmEngine");',
      "src/game/h.test.ts":
        'const real = await vi.importActual<typeof import("../tests/conformance/wasmEngine")>("../tests/conformance/wasmEngine");',
    };
    const reach = (rel: string) =>
      engineReach(
        rel,
        (r) => files[r] ?? "",
        (r) => r in files,
      );
    expect(reach("src/game/a.test.ts")).toBe("src/game/a.test.ts -> src/tests/conformance/wasmEngine");
    expect(reach("src/game/b.test.ts")).toBeNull();
    expect(reach("src/game/c.test.ts")).toBe("src/game/c.test.ts -> src/game/c.fixture.ts -> src/tests/portKit/drafts");
    expect(reach("src/game/d.test.ts")).toBeNull(); // production code is the code under test; the test mocks its boundary
    expect(reach("src/game/e.test.ts")).toContain("@verticopolis/engine/tooling/");
    expect(reach("src/game/g.test.ts")).toBe("src/game/g.test.ts -> src/tests/conformance/wasmEngine");
    expect(reach("src/game/h.test.ts")).toBe("src/game/h.test.ts -> src/tests/conformance/wasmEngine");
    expect(reach("src/game/f.test.ts")).toBe(
      "src/game/f.test.ts -> src/game/f.fixture.ts -> src/tests/conformance/wasmEngine",
    );
  });

  it("no unit test reaches a real engine beyond the allowlist", () => {
    const found = unitTests
      .map((rel) => [rel, engineReach(rel, read, exists)] as const)
      .filter(([rel, chain]) => chain !== null && !allow.has(rel));
    expect(
      found.map(([, chain]) => chain),
      "A unit test mocks the engine port with vi.fn spies and canned JSON answers. Move a test that needs the real engine to a *.integration.test.ts file (and to the local test:wasm:host list when it needs the package), or rewrite it against a mock.",
    ).toEqual([]);
  });
});

describe("no recorded engine answers", () => {
  it("has no recordings directory and no record script", () => {
    const scanned = ["src", "e2e", "scripts"].flatMap((dir) =>
      sourceFiles(dir, [".ts", ".tsx", ".json", ".mjs"]).map(repoRel),
    );
    expect(scanned.some((rel) => rel.startsWith("src/") && rel.endsWith(".json"))).toBe(true);
    const dirs = scanned.filter((rel) => rel.split("/").includes("recordings"));
    expect(
      dirs,
      "Recorded engine answers replayed as a stand-in engine test nothing about the code under test (PR #1923).",
    ).toEqual([]);
    const scripts = Object.keys((JSON.parse(read("package.json")) as { scripts: Record<string, string> }).scripts);
    expect(scripts.filter((s) => /:record$/.test(s))).toEqual([]);
  });

  it("names no module for recordings beyond the allowlist", () => {
    const named = srcTests.filter((rel) => /recording/i.test(rel.split("/").pop()!) && !allow.has(rel));
    expect(
      named,
      "A spy records the calls the code makes; a recording of engine answers is not a test. Allowlist a spy with its reason.",
    ).toEqual([]);
  });
});

describe("every test asserts", () => {
  it("reads a test's assertions through same-file helpers", () => {
    const sample = [
      'it("asserts", () => { expect(1).toBe(1); });',
      'it("asserts through a helper", () => { check(2); });',
      "function check(n: number) { inner(n); }",
      "const inner = (n: number) => expect(n).toBeGreaterThan(0);",
      'it("asserts nothing", () => { run(); });',
      'it.skipIf(true)("asserts nothing either", async () => { await run(); });',
      'test("a playwright test", async () => { await expect(page).toHaveURL("/"); });',
      'it("only mentions it", () => { /* expect this later */ run("expect"); });',
      'it("soft and polled", async () => { expect.soft(1).toBe(1); await expect.poll(() => 1).toBe(1); });',
      'it("by name", check);',
      'it("by an unknown name", runCase);',
      'it("never runs its check", () => { const verify = () => expect(1).toBe(1); run(); });',
      'it("runs its check", () => { const verify = () => expect(1).toBe(1); verify(); });',
      'it("checks each", async () => { await waitFor(() => expect(1).toBe(1)); });',
      'it("first local check", () => { const local = () => run(); local(); });',
      'it("second local check", () => { const local = () => expect(1).toBe(1); local(); });',
      'it.concurrent.each([1])("chained and empty", () => { run(); });',
      'test.skipIf(false).each([1])("chained and checked", (n) => { expect(n).toBe(1); });',
    ].join("\n");
    expect(assertionFreeTests("src/x.test.ts", sample)).toEqual([
      'src/x.test.ts > "asserts nothing"',
      'src/x.test.ts > "asserts nothing either"',
      'src/x.test.ts > "only mentions it"',
      'src/x.test.ts > "by an unknown name"',
      'src/x.test.ts > "never runs its check"',
      'src/x.test.ts > "first local check"',
      'src/x.test.ts > "chained and empty"',
    ]);
  });

  it("scans the unit, integration and e2e tiers", () => {
    expect(assertingTiers.some((rel) => rel.endsWith(".integration.test.ts"))).toBe(true);
    expect(assertingTiers.some((rel) => rel.startsWith("e2e/"))).toBe(true);
    expect(assertingTiers.length).toBeGreaterThan(500);
  });

  it("no test outside the allowlist asserts nothing", () => {
    const empty = assertingTiers.flatMap((rel) => assertionFreeTests(rel, read(rel))).filter((at) => !allow.has(at));
    expect(
      empty,
      "Each test asserts what its name promises: the calls a mock saw, the state the code left, the value it returned.",
    ).toEqual([]);
  });

  it("keeps every allowlist entry live", () => {
    const stale = [...allow.keys()].filter((entry) => {
      const [file, title] = entry.split(" > ");
      if (!exists(file)) return true;
      if (title === undefined) return engineReach(file, read, exists) === null && !/recording/i.test(file);
      return !assertionFreeTests(file, read(file)).includes(entry);
    });
    expect(stale, "Delete allowlist lines that no longer match anything; the list only shrinks.").toEqual([]);
  });
});
