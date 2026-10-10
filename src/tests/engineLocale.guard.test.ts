import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, relative } from "node:path";

/**
 * Engine number formatting guard (log-text parity, #868).
 *
 * The engine's log lines format dollar amounts and counts with
 * `toLocaleString("en-US")`, and the WASM engine (`jsmath::to_locale_string`)
 * formats them the same way. A bare `toLocaleString()` would follow the host
 * locale (`1.520.000` in a German browser), so the two engines would write
 * different log text for the same tower. The guard walks `src/engine/**` (tests
 * aside) and fails any file with a `toLocaleString` call that names no locale.
 */

const here = dirname(fileURLToPath(import.meta.url));
const engineRoot = resolve(here, "..", "engine");
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

describe("engine number formatting names its locale", () => {
  it("no file under src/engine calls toLocaleString() without a locale", () => {
    const offenders = tsFiles(engineRoot)
      .filter((file) => BARE_LOCALE_CALL.test(readFileSync(file, "utf8")))
      .map((file) => relative(engineRoot, file).replace(/\\/g, "/"));
    expect(offenders, "format engine numbers with toLocaleString(\"en-US\"), as the WASM engine does").toEqual([]);
  });
});
