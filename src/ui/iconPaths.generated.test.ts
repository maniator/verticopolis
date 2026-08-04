import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { VENDORED_ICON_SOURCES, VENDORED_ICON_PATHS } from "./iconPaths.generated";

/**
 * Keep `iconPaths.generated.ts` in sync with the installed `pixelarticons`
 * package (issue #721). The generated file is produced by
 * `scripts/gen-icon-paths.ts`; this test re-reads each source SVG and asserts
 * the committed path data still matches, so a package bump (or a hand-edit)
 * without regenerating fails CI instead of silently shipping stale icons.
 */

const here = dirname(fileURLToPath(import.meta.url));
const svgDir = resolve(here, "..", "..", "node_modules", "pixelarticons", "svg");

function pathsFor(file: string): string[] {
  const svg = readFileSync(resolve(svgDir, `${file}.svg`), "utf8");
  return [...svg.matchAll(/\sd="([^"]+)"/g)].map((m) => m[1]);
}

describe("vendored icon paths are generated from pixelarticons", () => {
  it("has the package installed (the generated file is sourced from it)", () => {
    expect(existsSync(svgDir), `pixelarticons not installed at ${svgDir}; run npm install`).toBe(true);
  });

  it("every vendored path matches its source SVG in the installed package", () => {
    const stale: string[] = [];
    for (const [name, file] of Object.entries(VENDORED_ICON_SOURCES)) {
      const fromPackage = pathsFor(file);
      const committed = VENDORED_ICON_PATHS[name];
      if (JSON.stringify(fromPackage) !== JSON.stringify([...(committed ?? [])])) {
        stale.push(`${name} (pixelarticons/${file})`);
      }
    }
    expect(
      stale,
      `iconPaths.generated.ts is out of sync with the installed pixelarticons; ` +
        `re-run scripts/gen-icon-paths.ts. Stale: ${stale.join(", ")}`,
    ).toEqual([]);
  });

  it("maps every source to path data (no empty or missing entry)", () => {
    for (const name of Object.keys(VENDORED_ICON_SOURCES)) {
      expect(VENDORED_ICON_PATHS[name]?.length, `${name} has no generated path`).toBeGreaterThan(0);
    }
  });
});
