import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

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
 * and generated declaration), and test files (`*.test.*`). Every other
 * tracked source under src/, scripts/, api/, tools/ and e2e/ is scanned, in
 * any JS or TS flavor; src/public/ (the built WASM glue, which defines the
 * ops, and static assets) is skipped. The file list comes from `git ls-files`,
 * so the scan is exactly what the repository ships: no symlinks to follow,
 * no dependencies, no duplicates.
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
const SOURCE = /\.(m|c)?[jt]sx?$/;
const TEST = /\.test\.(m|c)?[jt]sx?$/;
const NAMES_RELAY_OP = /\btower(SetCars|ResizeTransport)\b/;

/** Every tracked source the guard reads, as repository-relative paths. */
function scanned(): string[] {
  const out = execFileSync("git", ["ls-files", "-z", "--", ...SCANNED_TREES], { cwd: root, encoding: "utf8" });
  return out
    .split("\0")
    .filter((file) => SOURCE.test(file) && !TEST.test(file) && !file.startsWith("src/public/"));
}

describe("relay-only tower ops stay in the relay", () => {
  const files = scanned();

  it("no source outside the dual-run relay names towerSetCars or towerResizeTransport", () => {
    const offenders = files
      .filter((file) => !ALLOWED.has(file))
      .filter((file) => NAMES_RELAY_OP.test(readFileSync(resolve(root, file), "utf8")));
    expect(
      offenders,
      `towerSetCars/towerResizeTransport are relay-only: route player and UI edits through addCar, removeCar or extendTransport (setCars and resizeTransport for the uncharged simulation-layer edits). Offenders: ${offenders.join(", ")}`,
    ).toEqual([]);
  });

  it("the scan reaches every tree and every allowed file, and the matcher finds the ops there (no false pass)", () => {
    for (const tree of SCANNED_TREES) expect(files.some((f) => f.startsWith(`${tree}/`)), `${tree}/ yielded no sources`).toBe(true);
    expect(files.filter((f) => f.startsWith("src/")).length).toBeGreaterThan(300);
    for (const file of ALLOWED) {
      expect(files.includes(file), file).toBe(true);
      expect(NAMES_RELAY_OP.test(readFileSync(resolve(root, file), "utf8")), file).toBe(true);
    }
    expect(NAMES_RELAY_OP.test("engine.towerSetCars(id, 2)")).toBe(true);
    expect(NAMES_RELAY_OP.test("sim.setCars(id, 2)")).toBe(false);
  });
});
