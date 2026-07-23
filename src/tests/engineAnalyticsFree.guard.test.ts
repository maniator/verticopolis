import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, relative } from "node:path";

/**
 * Engine/shell boundary guard (#611 CAP-3).
 *
 * The engine (`src/engine/`) stays analytics-free: it never imports the analytics
 * module or any of its siblings. Emergency counts (and every other signal) surface
 * as plain data the SHELL reads and reports, mirroring how `noteBuild` is called
 * from the game shell after a build, never from the engine. This keeps the engine
 * testable in isolation and keeps telemetry on the shell's user/session boundary.
 * The guard walks `src/engine/**` and fails any file that imports from a path whose
 * module name begins with `analytics` (analytics, analyticsAdapter, analyticsRelay,
 * analyticsErrors, analyticsEnrichment, ...).
 */

const here = dirname(fileURLToPath(import.meta.url));
const engineRoot = resolve(here, "..", "engine");
/** Matches an import/export whose module specifier's basename starts with "analytics". */
const IMPORTS_ANALYTICS = /from\s+["'][^"']*\/analytics[A-Za-z]*["']/;

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) out.push(...tsFiles(full));
    else if (/\.ts$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe("engine imports no analytics (shell/engine boundary)", () => {
  it("no file under src/engine imports the analytics module", () => {
    const offenders = tsFiles(engineRoot)
      .filter((file) => IMPORTS_ANALYTICS.test(readFileSync(file, "utf8")))
      .map((file) => relative(engineRoot, file).replace(/\\/g, "/"));
    expect(
      offenders,
      `src/engine must stay analytics-free (CAP-3): the shell reads engine data and reports it, the engine never imports analytics. Offenders: ${offenders.join(", ")}`,
    ).toEqual([]);
  });

  it("the matcher actually catches an analytics import (guard is wired to real content)", () => {
    expect(IMPORTS_ANALYTICS.test('import { trackEvent } from "../analytics";')).toBe(true);
    expect(IMPORTS_ANALYTICS.test('import { sendToRelay } from "../analyticsRelay";')).toBe(true);
    expect(IMPORTS_ANALYTICS.test('import { Simulation } from "../Simulation";')).toBe(false);
  });
});
