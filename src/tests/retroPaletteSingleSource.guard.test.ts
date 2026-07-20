import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, relative } from "node:path";

/**
 * Single-source guard for the retro palette (CAP-6).
 *
 * The Windows-3.1 palette (`--r-face` and its siblings) is declared in exactly
 * ONE place, `src/styles/retro-tokens.css`, which the game sheet, the standalone
 * page layer, and every page `@import`. Before the extraction the gallery
 * re-declared its own copy of the palette inline; this guard keeps that
 * duplication from ever creeping back. It walks `src/` and fails any HTML or CSS
 * file other than the token file that DECLARES `--r-face` (a `--r-face:` custom
 * property assignment, as opposed to a `var(--r-face)` usage, which is fine
 * everywhere).
 */

const here = dirname(fileURLToPath(import.meta.url));
const srcRoot = resolve(here, "..");
const TOKEN_FILE = "styles/retro-tokens.css";
/** Matches a DECLARATION (`--r-face:`), not a `var(--r-face)` reference. */
const DECLARES_R_FACE = /--r-face\s*:/;

function stylesheetsAndPages(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      out.push(...stylesheetsAndPages(full));
    } else if (/\.(css|html)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

describe("retro palette single source (--r-face declared once)", () => {
  it("declares --r-face only in retro-tokens.css", () => {
    const offenders = stylesheetsAndPages(srcRoot)
      .filter((file) => DECLARES_R_FACE.test(readFileSync(file, "utf8")))
      .map((file) => relative(srcRoot, file).replace(/\\/g, "/"))
      .filter((rel) => rel !== TOKEN_FILE);
    expect(
      offenders,
      `Only ${TOKEN_FILE} may declare --r-face; move the palette back to the shared token file (use var(--r-face) instead of redeclaring). Offenders: ${offenders.join(", ")}`,
    ).toEqual([]);
  });

  it("still finds the declaration in the token file (guard is wired to real content)", () => {
    const tokens = readFileSync(resolve(srcRoot, TOKEN_FILE), "utf8");
    expect(DECLARES_R_FACE.test(tokens)).toBe(true);
  });
});
