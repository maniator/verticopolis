import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, relative } from "node:path";

/**
 * Relay-only binding ops guard (#906, under the #923 boundary row).
 *
 * The WASM binding's `towerSetCars` and `towerResizeTransport` edit the Rust
 * tower directly: no charge and no `capacity_changed`. They exist only so the
 * dual-run mirror can replay a bare TypeScript tower edit (tests, fixtures,
 * tooling) the way the TypeScript engine applied it. A player command or any
 * UI path that reached them would skip the charge and the event, so the only
 * source files that may name them are the relay's own: the command type, the
 * mirror that emits the command, the shadow that applies it, and the binding's
 * method list and generated declaration. Player edits go through
 * `setCars`, `resizeTransport`, `addCar`, `removeCar` and `extendTransport`.
 */

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..");
const ALLOWED = new Set([
  "src/dualrun/binding.ts",
  "src/dualrun/commands.ts",
  "src/dualrun/engine.d.ts",
  "src/dualrun/mirror.ts",
  "src/dualrun/shadow.ts",
]);
const NAMES_RELAY_OP = /\btower(SetCars|ResizeTransport)\b/;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules" && entry.name !== "public") out.push(...sourceFiles(full));
    } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe("relay-only tower ops stay in the relay", () => {
  it("no source outside the dual-run relay names towerSetCars or towerResizeTransport", () => {
    const offenders = [...sourceFiles(resolve(root, "src")), ...sourceFiles(resolve(root, "scripts"))]
      .map((file) => ({ file, rel: relative(root, file).replace(/\\/g, "/") }))
      .filter(({ rel }) => !ALLOWED.has(rel) && !rel.startsWith("src/tests/"))
      .filter(({ file }) => NAMES_RELAY_OP.test(readFileSync(file, "utf8")))
      .map(({ rel }) => rel);
    expect(
      offenders,
      `towerSetCars/towerResizeTransport are relay-only: route player and UI edits through setCars, resizeTransport, addCar, removeCar or extendTransport. Offenders: ${offenders.join(", ")}`,
    ).toEqual([]);
  });

  it("every allowed file exists and the matcher finds the ops there (guard is wired to real content)", () => {
    for (const rel of ALLOWED) expect(NAMES_RELAY_OP.test(readFileSync(resolve(root, rel), "utf8")), rel).toBe(true);
    expect(NAMES_RELAY_OP.test("engine.towerSetCars(id, 2)")).toBe(true);
    expect(NAMES_RELAY_OP.test("sim.setCars(id, 2)")).toBe(false);
  });
});
