import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

/**
 * Backlog-to-GitHub mirror guard (standing rule, 2026-07-15).
 *
 * The engineering backlog's curated table is mirrored to GitHub issues: every
 * row that is not finished carries its issue number in the `GH` column, so
 * the tracker and the artifact cannot silently drift apart. This test
 * enforces the row half of the invariant (the GitHub half, closing issues
 * when rows finish, is a process rule in the backlog's "How items flow").
 *
 * It also pins the table's structural health: the header and separator keep
 * the ratified column set, and every data row splits into exactly that many
 * cells on UNESCAPED pipes. That catches the bug class where a raw `|`
 * inside a Notes code span (for example `a || b`) silently splits a row into
 * extra cells and truncates it in rendered views; pipes inside Notes must be
 * written `\|`. The sequence `\\|` (escaped backslash, then a REAL delimiter
 * in GFM) is banned outright because the simple split regex here cannot
 * model it.
 */

const BACKLOG = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../_bmad-output/implementation-artifacts/backlog.md",
);

const HEADER = "| Date | Story | GH | Epic | Type | Priority | Severity | Owner | Status | Notes |";
const SEPARATOR = "| ---- | ----- | -- | ---- | ---- | -------- | -------- | ----- | ------ | ----- |";
/** Columns per HEADER; rows split into COLUMNS + 2 parts (edge-pipe empties). */
const COLUMNS = 10;
const PARTS = COLUMNS + 2;

/** Rows in these statuses represent open work and MUST carry a live issue. */
const UNRESOLVED = new Set(["open", "in-progress", "idea", "parked", "partial", "next", "impl-review"]);
/** Rows in these statuses are finished; their GH cell MUST be the `—` placeholder
 *  (`shipped-v1` counts as finished: its remainders live on their own rows). */
const FINISHED = new Set(["done", "resolved", "shipped-v1", "superseded"]);

/** The curated table: the contiguous pipe-prefixed block starting at HEADER.
 *  Locating it structurally (never by prefix-matching dated lines file-wide)
 *  keeps other tables or indented/malformed rows from escaping the guard. */
function tableRows(): { line: string; cells: string[] }[] {
  const lines = readFileSync(BACKLOG, "utf8").split("\n");
  const start = lines.indexOf(HEADER);
  expect(start, "curated-table header must exist verbatim").toBeGreaterThan(-1);
  expect(lines[start + 1], "separator must follow the header verbatim").toBe(SEPARATOR);
  const rows: { line: string; cells: string[] }[] = [];
  for (let i = start + 2; i < lines.length && lines[i].trim() !== ""; i++) {
    const line = lines[i];
    expect(line.startsWith("|"), `table block line must be a row: ${line.slice(0, 60)}`).toBe(true);
    expect(line.includes("\\\\|"), `banned \\\\| sequence in: ${line.slice(0, 60)}`).toBe(false);
    rows.push({ line, cells: line.split(/(?<!\\)\|/).map((c) => c.trim()) });
  }
  expect(rows.length, "curated table must not be empty").toBeGreaterThan(0);
  return rows;
}

describe("backlog issue mirror", () => {
  it("every data row splits into exactly the table's columns (escaped pipes only in Notes)", () => {
    const bad = tableRows().filter((r) => r.cells.length !== PARTS);
    expect(
      bad.map((r) => `${r.cells[2] ?? "?"} (${r.cells.length - 2} cells): ${r.line.slice(0, 80)}`),
    ).toEqual([]);
  });

  it("every status is a known token (unknown statuses must not fail open)", () => {
    const bad = tableRows()
      .filter((r) => r.cells.length === PARTS)
      .filter((r) => {
        const s = r.cells[9].toLowerCase();
        return !UNRESOLVED.has(s) && !FINISHED.has(s);
      });
    expect(bad.map((r) => `${r.cells[2]} status=${JSON.stringify(r.cells[9])}`)).toEqual([]);
  });

  it("every unresolved row carries a GitHub issue reference in the GH column", () => {
    const bad = tableRows()
      .filter((r) => r.cells.length === PARTS && UNRESOLVED.has(r.cells[9].toLowerCase()))
      .filter((r) => !/^#\d+$/.test(r.cells[3]));
    expect(bad.map((r) => `${r.cells[2]} [${r.cells[9]}] GH=${JSON.stringify(r.cells[3])}`)).toEqual([]);
  });

  it("finished rows carry the — placeholder (close the issue when the row finishes)", () => {
    const bad = tableRows()
      .filter((r) => r.cells.length === PARTS && FINISHED.has(r.cells[9].toLowerCase()))
      .filter((r) => r.cells[3] !== "—");
    expect(bad.map((r) => `${r.cells[2]} [${r.cells[9]}] GH=${JSON.stringify(r.cells[3])}`)).toEqual([]);
  });

  it("no two rows share an issue number", () => {
    const refs = tableRows()
      .filter((r) => r.cells.length === PARTS && /^#\d+$/.test(r.cells[3]))
      .map((r) => r.cells[3]);
    const dupes = refs.filter((n, i) => refs.indexOf(n) !== i);
    expect([...new Set(dupes)]).toEqual([]);
  });
});
