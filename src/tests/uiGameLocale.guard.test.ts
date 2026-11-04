import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, relative, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const srcRoot = resolve(here, "..");
const roots = [resolve(here, "..", "ui"), resolve(here, "..", "game")];
const BARE_LOCALE_CALL = /\.toLocaleString\(\s*\)/;

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) out.push(...tsFiles(full));
    else if (/\.ts$/.test(entry.name) && !/\.test\.ts$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe("ui/game number formatting uses groupDigits", () => {
  it("no file under src/ui or src/game calls toLocaleString() without arguments", () => {
    const offenders = roots.flatMap((root) =>
      tsFiles(root)
        .filter((file) => BARE_LOCALE_CALL.test(readFileSync(file, "utf8")))
        .map((file) => relative(srcRoot, file).replace(/\\/g, "/")),
    );
    expect(offenders, "format UI and game numbers with groupDigits() instead of bare toLocaleString()").toEqual([]);
  });
});
