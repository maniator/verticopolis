import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import ts from "typescript";
import { repoRel, sourceFiles } from "../guardFiles";

/**
 * The WASM parity projects' exclusions, counted (#878, story-engine-test-parity).
 *
 * A test the parity projects cannot run on the engine is marked, never
 * dropped: `itTypeScriptOnly(reason)` skips it by name on those projects,
 * `atEngineFrameCadence(reason)` runs it at the host's own cadence instead of a
 * full merge after every tick (the cost exclusion S6, #868, removes), and a
 * direct `onWasmParityProject()` branch skips by hand. This guard parses every
 * source file under `src/` (comments, strings and aliased imports are handled
 * by the parser) and pins how many of each a file holds in
 * `exclusions.ratchet.txt` (`<file> itTypeScriptOnly=<n> atEngineFrameCadence=<n>
 * onWasmParityProject=<n>` per line), so an exclusion cannot grow by accident
 * and a removed one has to lower its count. Adding one means adding or raising
 * its line, which a reviewer sees.
 *
 * The count is of call sites, not tests: `fixedStep` calls
 * `atEngineFrameCadence` once inside a loop that runs six cases, so a case
 * added to that loop adds an excluded test without moving the count (the story's
 * table gives the per-test figure; a per-test count is backlog row
 * `wasm-parity-exclusion-pins`, #1084).
 */
const here = dirname(fileURLToPath(import.meta.url));

const KEYS = ["itTypeScriptOnly", "atEngineFrameCadence", "onWasmParityProject"] as const;
type Key = (typeof KEYS)[number];
type Counts = Record<Key, number>;
const zero = (): Counts => ({ itTypeScriptOnly: 0, atEngineFrameCadence: 0, onWasmParityProject: 0 });

/** The marker's own module and the setup's spec of it, which call the markers
 *  to test them. Everything else under `src/` is counted. */
const OWN_FILES = new Set(["src/tests/parity/typescriptOnly.ts", "src/tests/parity/wasmHostSetup.integration.test.ts"]);

function parseRatchet(): Map<string, Counts> {
  const out = new Map<string, Counts>();
  for (const raw of readFileSync(resolve(here, "exclusions.ratchet.txt"), "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = /^(\S+) itTypeScriptOnly=(\d+) atEngineFrameCadence=(\d+) onWasmParityProject=(\d+)$/.exec(line);
    if (!m) throw new Error(`exclusions.ratchet.txt: cannot read the line "${line}"`);
    if (out.has(m[1])) throw new Error(`exclusions.ratchet.txt: ${m[1]} is listed twice`);
    out.set(m[1], { itTypeScriptOnly: Number(m[2]), atEngineFrameCadence: Number(m[3]), onWasmParityProject: Number(m[4]) });
  }
  return out;
}

/** A reason that says nothing: a string with only whitespace in it. */
const blank = (arg: ts.Expression) => (ts.isStringLiteralLike(arg) ? arg.text.trim() === "" : false);

/** The marker calls in one file, and the ones with no reason. */
function scanFile(rel: string, text: string): { counts: Counts; problems: string[] } {
  const counts = zero();
  const problems: string[] = [];
  const source = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true);
  const visit = (node: ts.Node): void => {
    // An aliased import hides a call from the name match: refuse it.
    if (ts.isImportSpecifier(node) && node.propertyName && (KEYS as readonly string[]).includes(node.propertyName.text)) {
      problems.push(`${rel}: ${node.propertyName.text} is imported under another name`);
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && (KEYS as readonly string[]).includes(node.expression.text)) {
      const name = node.expression.text as Key;
      counts[name]++;
      // The two markers take a reason; the predicate takes nothing.
      if (name !== "onWasmParityProject" && (node.arguments.length === 0 || blank(node.arguments[0]))) {
        problems.push(`${rel}: ${name} called without a reason`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { counts, problems };
}

function scan(): { counts: Map<string, Counts>; problems: string[] } {
  const counts = new Map<string, Counts>();
  const problems: string[] = [];
  for (const abs of sourceFiles("src", [".ts", ".tsx"])) {
    const rel = repoRel(abs);
    if (OWN_FILES.has(rel)) continue;
    const found = scanFile(rel, readFileSync(abs, "utf8"));
    problems.push(...found.problems);
    if (KEYS.some((k) => found.counts[k] > 0)) counts.set(rel, found.counts);
  }
  return { counts, problems };
}

describe("the WASM parity exclusions", () => {
  const { counts, problems } = scan();
  const ratchet = parseRatchet();

  it("every exclusion names its reason and is imported by its own name", () => {
    expect(problems).toEqual([]);
  });

  it("scans the files that hold exclusions", () => {
    // A scan that silently found nothing would pass forever.
    expect(counts.size).toBeGreaterThan(5);
  });

  it("reads comments, strings and aliases the way the compiler does", () => {
    const sample = [
      'import { itTypeScriptOnly as tsOnly } from "../parity/typescriptOnly";',
      '// itTypeScriptOnly("in a comment")',
      'const s = "atEngineFrameCadence(\\"in a string\\")";',
      "const t = `/* ${1} */`; atEngineFrameCadence('real');",
      "itTypeScriptOnly(' ')('blank', () => {});",
    ].join("\n");
    const { counts: c, problems: p } = scanFile("sample.test.ts", sample);
    expect(c).toEqual({ itTypeScriptOnly: 1, atEngineFrameCadence: 1, onWasmParityProject: 0 });
    expect(p).toEqual(["sample.test.ts: itTypeScriptOnly is imported under another name", "sample.test.ts: itTypeScriptOnly called without a reason"]);
  });

  it("no file holds more exclusions than the ratchet allows", () => {
    const grown: string[] = [];
    for (const [file, c] of counts) {
      const allowed = ratchet.get(file) ?? zero();
      for (const key of KEYS) if (c[key] > allowed[key]) grown.push(`${file}: ${key} ${c[key]} > ${allowed[key]}`);
    }
    expect(grown, `Raise exclusions.ratchet.txt only with a reason a reviewer accepts:\n${grown.join("\n")}`).toEqual([]);
  });

  it("the ratchet has no stale entries", () => {
    const stale: string[] = [];
    for (const [file, allowed] of ratchet) {
      const c = counts.get(file) ?? zero();
      for (const key of KEYS) if (c[key] < allowed[key]) stale.push(`${file}: ${key} is ${c[key]}, the ratchet says ${allowed[key]}`);
    }
    expect(stale, `Lower these in exclusions.ratchet.txt:\n${stale.join("\n")}`).toEqual([]);
  });
});
