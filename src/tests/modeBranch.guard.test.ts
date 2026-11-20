import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { repoRel, sourceFiles } from "./guardFiles";

/**
 * Shift-left guard: a Classic or Modern difference is a named rule.
 *
 * The engine keeps its mode rules as named methods on `GameMode`
 * (Verticopolis/engine), and the catalog publishes the ones a frontend needs,
 * so the web asks those rules by name. A bare `mode === "modern"` hides which
 * rule it means and lets two copies of one rule drift apart. This guard keeps
 * new ones out.
 *
 * It counts direct mode checks in production TypeScript: a comparison against
 * the `"classic"`/`"modern"` mode names or an `isModern`/`isClassic` flag.
 * Tests are not counted (they run each rule in both modes on purpose).
 *
 * Files that already held checks when the guard landed are listed with their
 * count in `modeBranch.ratchet.txt`. That list only shrinks: a file's count
 * must match its entry exactly, so moving a check into a named rule lowers the
 * entry in the same PR, and a file not on the list must hold none.
 */

const here = dirname(fileURLToPath(import.meta.url));

/** TypeScript paths that are tests, fixtures or generated declarations. */
const TS_SKIPPED: readonly RegExp[] = [
  /^src\/tests\//,
  /\.test\.tsx?$/,
  /\.spec\.tsx?$/,
  /\.fixture\.ts$/,
  /^src\/engineBinding\/engine\.d\.ts$/,
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

/** Direct mode checks in one TypeScript file, comment lines skipped. */
function tsModeChecks(text: string): number {
  let n = 0;
  for (const line of text.split("\n")) {
    if (isCommentLine(line.trim())) continue;
    n += countIn(line, TS_CHECKS);
  }
  return n;
}

function scan(): { counts: Map<string, number>; scanned: number } {
  const counts = new Map<string, number>();
  let scanned = 0;
  for (const abs of sourceFiles("src", [".ts", ".tsx"])) {
    const rel = repoRel(abs);
    if (TS_SKIPPED.some((re) => re.test(rel))) continue;
    scanned++;
    const n = tsModeChecks(readFileSync(abs, "utf8"));
    if (n > 0) counts.set(rel, n);
  }
  return { counts, scanned };
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
  it("counts the shapes a stray mode check takes, and skips comments", () => {
    expect(tsModeChecks('const isModern = mode === "modern";')).toBe(2);
    expect(tsModeChecks('if ("classic" !== mode) return;')).toBe(1);
    expect(tsModeChecks('  case "modern":')).toBe(1);
    expect(tsModeChecks('// mode === "modern" is a label here')).toBe(0);
    expect(tsModeChecks("if (catalog.rules.schedulesAssist) {")).toBe(0);
  });

  const { counts, scanned } = scan();
  const ratchet = readRatchet();

  it("reads the web sources, so a broken scan cannot pass", () => {
    // The app holds hundreds of production files; a walk that silently found
    // none would pass the ratchet forever.
    expect(scanned).toBeGreaterThan(100);
  });

  it("each file holds exactly the mode checks its ratchet entry allows", () => {
    const wrong = [...new Set([...counts.keys(), ...ratchet.keys()])]
      .sort()
      .filter((rel) => (counts.get(rel) ?? 0) !== (ratchet.get(rel) ?? 0))
      .map((rel) => {
        const found = counts.get(rel) ?? 0;
        const allowed = ratchet.get(rel) ?? 0;
        return found > allowed
          ? `${rel}: ${found} direct mode checks, ${allowed} allowed. Ask a catalog rule (or a named rule the engine publishes) instead.`
          : `${rel}: ${found} direct mode checks, ratchet says ${allowed}. Lower its entry in modeBranch.ratchet.txt${found === 0 ? " (delete the line)" : ""}.`;
      });
    expect(wrong, wrong.join("\n")).toEqual([]);
  });
});
