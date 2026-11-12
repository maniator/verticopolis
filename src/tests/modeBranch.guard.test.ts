import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { repoRel, sourceFiles } from "./guardFiles";

/**
 * Shift-left guard: a Classic or Modern difference is a named rule.
 *
 * The engine keeps its mode rules as named methods on `GameMode` in
 * `engine-rs/src/rules.rs` (`room_is_permanent`, `ransom_needs_security`,
 * `quarterly_rent_scale`, ...), and every other file asks those rules by name.
 * A bare `if self.mode == GameMode::Classic` somewhere else hides which rule it
 * means, lets two copies of one rule drift apart, and is the pattern the
 * 2026-11-12 audit found about 25 of. This guard keeps new ones out.
 *
 * It counts direct mode checks in production code: in Rust, a
 * `GameMode::Classic`/`GameMode::Modern` value, `.is_modern()`, or a
 * `modern`/`classic` boolean standing in for a rule; in TypeScript, a
 * comparison against the `"classic"`/`"modern"` mode names or an
 * `isModern`/`isClassic` flag. Tests are not counted (they run each rule in
 * both modes on purpose), nor are the rule hub itself and the mode's own
 * definition, parse and serialize in `clock.rs`.
 *
 * Files that already held checks when the guard landed are listed with their
 * count in `modeBranch.ratchet.txt`. That list only shrinks: a file's count
 * must match its entry exactly, so moving a check into a named rule lowers the
 * entry in the same PR, and a file not on the list must hold none.
 */

const here = dirname(fileURLToPath(import.meta.url));

/** Where a direct mode check belongs: the rule hub (a single file today, a
 *  `rules/` module once it is split by domain) and the enum's own file. */
const RULE_HOMES: readonly RegExp[] = [/^engine-rs\/src\/rules\.rs$/, /^engine-rs\/src\/rules\//, /^engine-rs\/src\/clock\.rs$/];

/** Rust paths that are tests or tools, not rules: rule tests, `*_tests.rs`
 *  modules, and the `src/bin/` harnesses that pick a mode to run. */
const RUST_SKIPPED: readonly RegExp[] = [/\/tests_[^/]*\.rs$/, /^engine-rs\/src\/bin\//, /\/rule_tests\//, /\/tests?\//, /_tests?\.rs$/, /\/tests\.rs$/];

/** TypeScript paths that are tests, fixtures or generated declarations. */
const TS_SKIPPED: readonly RegExp[] = [/^src\/tests\//, /\.test\.tsx?$/, /\.spec\.tsx?$/, /\.fixture\.ts$/, /^src\/dualrun\/engine\.d\.ts$/];

const RUST_CHECKS: readonly RegExp[] = [
  /\bGameMode::(?:Classic|Modern)\b/g,
  /\.is_modern\(\)/g,
  /\b(?:modern|classic)\s*:\s*bool\b/g,
  /\blet\s+(?:mut\s+)?(?:modern|classic)\s*=/g,
];

const TS_CHECKS: readonly RegExp[] = [
  /[!=]==?\s*["'](?:classic|modern)["']/g,
  /["'](?:classic|modern)["']\s*[!=]==?/g,
  /\bcase\s+["'](?:classic|modern)["']/g,
  /\bis(?:Modern|Classic)\b/g,
];

function countIn(line: string, checks: readonly RegExp[]): number {
  return checks.reduce((n, re) => n + (line.match(re)?.length ?? 0), 0);
}

function isCommentLine(trimmed: string): boolean {
  return trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*");
}

/** Direct mode checks in one Rust file's production code: comment lines are
 *  skipped, and counting stops at the first `#[cfg(test)]`. */
function rustModeChecks(text: string): number {
  let n = 0;
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("#[cfg(test)]")) break;
    if (isCommentLine(trimmed)) continue;
    n += countIn(line, RUST_CHECKS);
  }
  return n;
}

/** Direct mode checks in one TypeScript file, comment lines skipped. */
function tsModeChecks(text: string): number {
  let n = 0;
  for (const line of text.split("\n")) {
    if (isCommentLine(line.trim())) continue;
    n += countIn(line, TS_CHECKS);
  }
  return n;
}

function scan(): Map<string, number> {
  const counts = new Map<string, number>();
  const add = (abs: string, count: (text: string) => number): void => {
    const rel = repoRel(abs);
    const n = count(readFileSync(abs, "utf8"));
    if (n > 0) counts.set(rel, n);
  };
  for (const abs of sourceFiles("engine-rs/src", [".rs"])) {
    const rel = repoRel(abs);
    if (RULE_HOMES.some((re) => re.test(rel)) || RUST_SKIPPED.some((re) => re.test(rel))) continue;
    add(abs, rustModeChecks);
  }
  for (const abs of sourceFiles("src", [".ts", ".tsx"])) {
    if (TS_SKIPPED.some((re) => re.test(repoRel(abs)))) continue;
    add(abs, tsModeChecks);
  }
  return counts;
}

/** `modeBranch.ratchet.txt`: `<path> <count>` per line; `#` starts a comment. */
function readRatchet(): Map<string, number> {
  const entries = new Map<string, number>();
  for (const raw of readFileSync(resolve(here, "modeBranch.ratchet.txt"), "utf8").split("\n")) {
    const line = raw.replace(/#.*/, "").trim();
    if (line.length === 0) continue;
    const [path, count] = line.split(/\s+/);
    entries.set(path, Number(count));
  }
  return entries;
}

describe("mode-branch guard", () => {
  it("counts the shapes a stray mode check takes, and skips comments and tests", () => {
    expect(rustModeChecks("if self.mode == GameMode::Classic {")).toBe(1);
    expect(rustModeChecks("let fix = if self.mode.is_modern() {")).toBe(1);
    expect(rustModeChecks("fn holds(&self, modern: bool) -> bool {")).toBe(1);
    expect(rustModeChecks("let modern = self.mode.is_modern();")).toBe(2);
    expect(rustModeChecks("/// let sim = Simulation::new_game(1, GameMode::Classic);")).toBe(0);
    expect(rustModeChecks("if self.mode.room_is_permanent(kind) {")).toBe(0);
    expect(rustModeChecks("fn a() {}\n#[cfg(test)]\nmod t { const M: GameMode = GameMode::Modern; }")).toBe(0);
    expect(tsModeChecks('const isModern = mode === "modern";')).toBe(2);
    expect(tsModeChecks('if ("classic" !== mode) return;')).toBe(1);
    expect(tsModeChecks('  case "modern":')).toBe(1);
    expect(tsModeChecks('// mode === "modern" is a label here')).toBe(0);
    expect(tsModeChecks("if (catalog.rules.schedulesAssist) {")).toBe(0);
  });

  const counts = scan();
  const ratchet = readRatchet();

  it("finds the checks the ratchet lists, so a broken scan cannot pass", () => {
    expect(counts.size).toBeGreaterThan(0);
    expect([...counts.keys()].some((rel) => rel.endsWith(".rs"))).toBe(true);
  });

  it("each file holds exactly the mode checks its ratchet entry allows", () => {
    const wrong = [...new Set([...counts.keys(), ...ratchet.keys()])]
      .sort()
      .filter((rel) => (counts.get(rel) ?? 0) !== (ratchet.get(rel) ?? 0))
      .map((rel) => {
        const found = counts.get(rel) ?? 0;
        const allowed = ratchet.get(rel) ?? 0;
        return found > allowed
          ? `${rel}: ${found} direct mode checks, ${allowed} allowed. Ask a named rule on GameMode (engine-rs/src/rules.rs) or a catalog rule instead.`
          : `${rel}: ${found} direct mode checks, ratchet says ${allowed}. Lower its entry in modeBranch.ratchet.txt${found === 0 ? " (delete the line)" : ""}.`;
      });
    expect(wrong, wrong.join("\n")).toEqual([]);
  });
});
