import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { SKIPPED_PATHS, repoRel, sourceFiles } from "./guardFiles";

/**
 * Shift-left guard: no code file grows past the readable ceiling.
 *
 * Oversized files hide the review gates this project depends on (sub-quadratic
 * hot paths, canon-cap fidelity, a DOM-free engine): nobody can hold a
 * 2,900-line god-object in their head, so regressions ride in under green
 * gates. This test walks `src/` and `scripts/` for TypeScript and `engine-rs/`
 * for Rust (the engine port follows the same source rules), and fails any code
 * file over {@link MAX_LINES} lines. A Rust file's inline `#[cfg(test)]` module
 * counts toward its file, the same as a TypeScript file's.
 *
 * The exemption set lives in `fileSize.ratchet.txt` (one path per line), NOT in
 * this file. That keeps it a ratchet, not a permanent exemption: it lists the
 * files that were already over the line when the guard landed, and it only ever
 * shrinks. A split PR deletes its own path from that data file (a one-line
 * change that never conflicts with a parallel split, and that Copilot won't
 * nit-pick the way it would a TypeScript edit); the guard then enforces the
 * ceiling on that file. When the data file is empty, delete it and the
 * stale-entry check with it.
 */
const MAX_LINES = 500;

const here = dirname(fileURLToPath(import.meta.url));

/** Directories under the repo root whose code files are guarded, with the
 *  extensions each one holds. */
const SCANNED_DIRS: { dir: string; exts: readonly string[] }[] = [
  { dir: "src", exts: [".ts", ".tsx"] },
  { dir: "scripts", exts: [".ts", ".tsx"] },
  { dir: "engine-rs", exts: [".rs"] },
];

/**
 * Files still awaiting a split, read from `fileSize.ratchet.txt`. Blank lines
 * and `#` comments are ignored; paths are repo-relative with forward slashes.
 */
const LEGACY_OVERSIZED = new Set<string>(
  readFileSync(resolve(here, "fileSize.ratchet.txt"), "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#")),
);

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

function scanFiles(): { rel: string; lines: number }[] {
  return SCANNED_DIRS.flatMap(({ dir, exts }) => sourceFiles(dir, exts))
    .map((p) => ({ rel: repoRel(p), lines: lineCount(p) }))
    .sort((a, b) => a.rel.localeCompare(b.rel));
}

describe("file-size guard", () => {
  const files = scanFiles();

  it("scans the Rust engine as well as the TypeScript", () => {
    // A guard that silently stopped finding .rs files would pass forever.
    expect(files.some((f) => f.rel.startsWith("engine-rs/src/") && f.rel.endsWith(".rs"))).toBe(true);
    expect(files.some((f) => [...SKIPPED_PATHS].some((skip) => f.rel.startsWith(`${skip}/`)))).toBe(false);
  });

  it("no un-exempted code file exceeds the line ceiling", () => {
    const offenders = files
      .filter((f) => f.lines > MAX_LINES && !LEGACY_OVERSIZED.has(f.rel))
      .map((f) => `${f.rel} (${f.lines} lines)`);
    expect(offenders, `Files over ${MAX_LINES} lines must be split or added to the ratchet:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("the ratchet has no stale entries", () => {
    // An entry that is now under the ceiling (or gone) must be removed from
    // fileSize.ratchet.txt so the guard can start enforcing it. This is what
    // keeps the exemption shrinking.
    const byRel = new Map(files.map((f) => [f.rel, f.lines]));
    const stale = [...LEGACY_OVERSIZED].filter((rel) => (byRel.get(rel) ?? 0) <= MAX_LINES);
    expect(stale, `Remove these now-compliant paths from fileSize.ratchet.txt:\n${stale.join("\n")}`).toEqual([]);
  });
});
