import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, relative } from "node:path";

/**
 * Relay-only binding ops guard (#906, under the #923 boundary row).
 *
 * The WASM binding's `towerSetCars` and `towerResizeTransport` edit the Rust
 * tower directly and emit no `capacity_changed`. They exist only so the
 * dual-run mirror can replay a bare TypeScript tower edit (tests, fixtures,
 * tooling) the way the TypeScript engine applied it. A UI path or player
 * command that reached them would skip the simulation layer and its event.
 * Player edits go through the charged commands (`addCar`, `removeCar`,
 * `extendTransport`); `setCars` and `resizeTransport` are the uncharged
 * simulation-layer edits.
 *
 * Who may name them: the relay's own files (the command type, the mirror that
 * emits the command, the shadow that applies it, the binding's method list
 * and generated declaration), and test files (`*.test.*`). Every other source
 * under src/, scripts/, api/, tools/ and e2e/ is scanned, in any JS or TS
 * flavor; the built glue under src/public/ defines the ops and is skipped.
 * The guard checks for the names written out: `INSTANCE_METHODS` is only read
 * by the binding's own presence check, which exposes nothing.
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
const SCANNED_TREES = ["src", "scripts", "api", "tools", "e2e"];
const SKIPPED_DIRS = new Set([resolve(root, "src", "public")]);
const SOURCE = /\.(m|c)?[jt]sx?$/;
const TEST = /\.test\.(m|c)?[jt]sx?$/;
const NAMES_RELAY_OP = /\btower(SetCars|ResizeTransport)\b/;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    const isDir = entry.isDirectory() || (entry.isSymbolicLink() && statSync(full).isDirectory());
    if (isDir) {
      if (entry.name !== "node_modules" && !SKIPPED_DIRS.has(full)) out.push(...sourceFiles(full));
    } else if (SOURCE.test(entry.name) && !TEST.test(entry.name)) out.push(full);
  }
  return out;
}

const rel = (file: string) => relative(root, file).replace(/\\/g, "/");
const scanned = () => SCANNED_TREES.filter((d) => existsSync(resolve(root, d))).flatMap((d) => sourceFiles(resolve(root, d)));

describe("relay-only tower ops stay in the relay", () => {
  it("no source outside the dual-run relay names towerSetCars or towerResizeTransport", () => {
    const offenders = scanned()
      .filter((file) => !ALLOWED.has(rel(file)))
      .filter((file) => NAMES_RELAY_OP.test(readFileSync(file, "utf8")))
      .map(rel);
    expect(
      offenders,
      `towerSetCars/towerResizeTransport are relay-only: route player edits through addCar, removeCar or extendTransport (setCars and resizeTransport for the uncharged simulation-layer edits). Offenders: ${offenders.join(", ")}`,
    ).toEqual([]);
  });

  it("the walk reaches every allowed file and the matcher finds the ops there (no false pass)", () => {
    const walked = new Set(scanned().map(rel));
    for (const file of ALLOWED) {
      expect(walked.has(file), file).toBe(true);
      expect(NAMES_RELAY_OP.test(readFileSync(resolve(root, file), "utf8")), file).toBe(true);
    }
    expect(walked.size).toBeGreaterThan(100);
    expect(NAMES_RELAY_OP.test("engine.towerSetCars(id, 2)")).toBe(true);
    expect(NAMES_RELAY_OP.test("sim.setCars(id, 2)")).toBe(false);
  });
});
