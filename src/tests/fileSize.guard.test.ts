import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, relative } from "node:path";

/**
 * Shift-left guard: no code file grows past the readable ceiling.
 *
 * Oversized files hide the review gates this project depends on (sub-quadratic
 * hot paths, canon-cap fidelity, a DOM-free engine): nobody can hold a
 * 2,900-line god-object in their head, so regressions ride in under green
 * gates. This test walks `src/` and `scripts/` and fails any TypeScript file
 * over {@link MAX_LINES} lines.
 *
 * `LEGACY_OVERSIZED` is a ratchet, not a permanent exemption: it lists the
 * files that were already over the line when the guard landed. It only ever
 * shrinks. Splitting a file to size removes its entry; the guard then fails if
 * anyone regrows it. When the set is empty, delete it and the stale-entry
 * check with it.
 */
const MAX_LINES = 500;

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Directories under the repo root whose `.ts`/`.tsx` files are guarded. */
const SCANNED_DIRS = ["src", "scripts"];

/**
 * Files still awaiting a split. Shrinks to empty over the refactor; never grows.
 * Paths are repo-relative with forward slashes.
 */
const LEGACY_OVERSIZED = new Set<string>([
  // engine
  "src/engine/Simulation.ts",
  "src/engine/Tower.ts",
  "src/engine/Crowd.ts",
  "src/engine/EconomySystem.ts",
  // render
  "src/render/excalibur/TowerEngine.ts",
  "src/render/pixelSprites.ts",
  "src/render/sprites/structure.ts",
  // ui / app spine / audio
  "src/main.ts",
  "src/ui/UI.ts",
  "src/audio/ToneAudioEngine.ts",
  // scripts
  "scripts/screenshot-builders.ts",
  "scripts/screenshot-scenes.ts",
  // tests (split last)
  "src/tests/simulation.test.ts",
  "src/tests/uiDialogs.test.ts",
  "src/tests/gameControllersCoverage.test.ts",
  "src/tests/tdtImport.test.ts",
  "src/tests/tdtExport.test.ts",
  "src/tests/storage.test.ts",
  "src/tests/faqComplete.test.ts",
  "src/tests/gameControllers.test.ts",
  "src/tests/tower.test.ts",
  "src/tests/calendar.test.ts",
]);

/** Count logical lines: newline characters, plus one for a final line that is
 *  not newline-terminated. (Plain `wc -l` counts only newlines, so a file whose
 *  501st line lacks a trailing newline would read as 500 and slip under the
 *  ceiling; counting the last line closes that bypass.) */
function lineCount(absPath: string): number {
  const text = readFileSync(absPath, "utf8");
  if (text.length === 0) return 0;
  let n = 0;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) n++;
  if (text.charCodeAt(text.length - 1) !== 10) n++; // final unterminated line
  return n;
}

function walk(absDir: string, out: string[]): void {
  for (const entry of readdirSync(absDir)) {
    const abs = resolve(absDir, entry);
    const st = statSync(abs);
    if (st.isDirectory()) {
      if (entry === "node_modules" || entry === "dist" || entry === ".git") continue;
      walk(abs, out);
    } else if (entry.endsWith(".ts") || entry.endsWith(".tsx")) {
      out.push(abs);
    }
  }
}

function scanFiles(): { rel: string; lines: number }[] {
  const abs: string[] = [];
  for (const dir of SCANNED_DIRS) walk(resolve(repoRoot, dir), abs);
  return abs
    .map((p) => ({ rel: relative(repoRoot, p).split("\\").join("/"), lines: lineCount(p) }))
    .sort((a, b) => a.rel.localeCompare(b.rel));
}

describe("file-size guard", () => {
  const files = scanFiles();

  it("no un-exempted code file exceeds the line ceiling", () => {
    const offenders = files
      .filter((f) => f.lines > MAX_LINES && !LEGACY_OVERSIZED.has(f.rel))
      .map((f) => `${f.rel} (${f.lines} lines)`);
    expect(offenders, `Files over ${MAX_LINES} lines must be split or added to the ratchet:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("the ratchet has no stale entries", () => {
    // An entry that is now under the ceiling (or gone) must be removed so the
    // guard can start enforcing it. This is what keeps the exemption shrinking.
    const byRel = new Map(files.map((f) => [f.rel, f.lines]));
    const stale = [...LEGACY_OVERSIZED].filter((rel) => (byRel.get(rel) ?? 0) <= MAX_LINES);
    expect(stale, `Remove these now-compliant paths from LEGACY_OVERSIZED:\n${stale.join("\n")}`).toEqual([]);
  });
});
