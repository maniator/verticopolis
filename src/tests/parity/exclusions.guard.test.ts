import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { repoRel, sourceFiles } from "../guardFiles";

/**
 * The WASM parity projects' exclusions, counted (#878, story-engine-test-parity).
 *
 * A test the parity projects cannot run on the engine is marked, never
 * dropped: `itTypeScriptOnly(reason)` skips it by name on those projects, and
 * `atEngineFrameCadence(reason)` runs it at the host's own cadence instead of a
 * full merge after every tick (the cost exclusion S6, #868, removes). This
 * guard pins how many of each every test file holds, in `exclusions.ratchet.txt`
 * (`<file> itTypeScriptOnly=<n> atEngineFrameCadence=<n>` per line), so an
 * exclusion cannot grow by accident and a removed one has to lower its count.
 * Adding one means adding or raising its line, which a reviewer sees.
 *
 * The count is of call sites, not tests: `fixedStep` calls
 * `atEngineFrameCadence` once inside a loop that runs six cases, so a case
 * added to that loop adds an excluded test without moving the count (the story's
 * table gives the per-test figure; a per-test count is backlog row
 * `wasm-parity-exclusion-pins`, #1084).
 */
const here = dirname(fileURLToPath(import.meta.url));

type Counts = { itTypeScriptOnly: number; atEngineFrameCadence: number };

function parseRatchet(): Map<string, Counts> {
  const out = new Map<string, Counts>();
  for (const raw of readFileSync(resolve(here, "exclusions.ratchet.txt"), "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = /^(\S+) itTypeScriptOnly=(\d+) atEngineFrameCadence=(\d+)$/.exec(line);
    if (!m) throw new Error(`exclusions.ratchet.txt: cannot read the line "${line}"`);
    if (out.has(m[1])) throw new Error(`exclusions.ratchet.txt: ${m[1]} is listed twice`);
    out.set(m[1], { itTypeScriptOnly: Number(m[2]), atEngineFrameCadence: Number(m[3]) });
  }
  return out;
}

/** Source with its comments blanked, so a comment that names a marker does
 *  not count as a call. Strings stay: a marker's reason is a string. */
const withoutComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1");

/** A reason that says nothing: empty or only whitespace in any quote style. */
const blankReason = (arg: string) => /^(["'`])\s*\1$/.test(arg.trim());

/** The calls in a source file: a call site is the name followed by `(` and a
 *  non-empty reason, a string literal or a named constant. */
function scan(): { counts: Map<string, Counts>; bare: string[] } {
  const counts = new Map<string, Counts>();
  const bare: string[] = [];
  for (const abs of sourceFiles("src", [".ts", ".tsx"])) {
    const rel = repoRel(abs);
    if (rel.startsWith("src/tests/parity/")) continue; // the markers and their own specs
    const text = withoutComments(readFileSync(abs, "utf8"));
    const c: Counts = { itTypeScriptOnly: 0, atEngineFrameCadence: 0 };
    for (const [name, re] of [
      ["itTypeScriptOnly", /\bitTypeScriptOnly\(\s*([^)\s][^)]*)\)/g],
      ["atEngineFrameCadence", /\batEngineFrameCadence\(\s*([^)\s][^)]*)\)/g],
    ] as const) {
      const all = text.match(new RegExp(`\\b${name}\\(`, "g"))?.length ?? 0;
      const withReason = [...text.matchAll(re)].filter((m) => !blankReason(m[1])).length;
      c[name] = withReason;
      if (all !== withReason) bare.push(`${rel}: ${name} called without a reason`);
    }
    if (c.itTypeScriptOnly > 0 || c.atEngineFrameCadence > 0) counts.set(rel, c);
  }
  return { counts, bare };
}

describe("the WASM parity exclusions", () => {
  const { counts, bare } = scan();
  const ratchet = parseRatchet();

  it("every exclusion names its reason", () => {
    expect(bare).toEqual([]);
  });

  it("scans the test files that hold exclusions", () => {
    // A scan that silently found nothing would pass forever.
    expect(counts.size).toBeGreaterThan(5);
  });

  it("no file holds more exclusions than the ratchet allows", () => {
    const grown: string[] = [];
    for (const [file, c] of counts) {
      const allowed = ratchet.get(file) ?? { itTypeScriptOnly: 0, atEngineFrameCadence: 0 };
      for (const key of ["itTypeScriptOnly", "atEngineFrameCadence"] as const) {
        if (c[key] > allowed[key]) grown.push(`${file}: ${key} ${c[key]} > ${allowed[key]}`);
      }
    }
    expect(grown, `Raise exclusions.ratchet.txt only with a reason a reviewer accepts:\n${grown.join("\n")}`).toEqual([]);
  });

  it("the ratchet has no stale entries", () => {
    const stale: string[] = [];
    for (const [file, allowed] of ratchet) {
      const c = counts.get(file) ?? { itTypeScriptOnly: 0, atEngineFrameCadence: 0 };
      for (const key of ["itTypeScriptOnly", "atEngineFrameCadence"] as const) {
        if (c[key] < allowed[key]) stale.push(`${file}: ${key} is ${c[key]}, the ratchet says ${allowed[key]}`);
      }
    }
    expect(stale, `Lower these in exclusions.ratchet.txt:\n${stale.join("\n")}`).toEqual([]);
  });
});
