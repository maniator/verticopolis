import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, isAbsolute, resolve, relative } from "node:path";

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
 * flavor; src/public/ (the built WASM glue, which defines the ops, and static
 * assets) is skipped.
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
const SKIPPED_DIRS = new Set([realpathSync(resolve(root, "src", "public"))]);
const SOURCE = /\.(m|c)?[jt]sx?$/;
const TEST = /\.test\.(m|c)?[jt]sx?$/;
const NAMES_RELAY_OP = /\btower(SetCars|ResizeTransport)\b/;

/** Walk a tree by real path: a symlinked directory is followed once (a cycle
 *  or a second route to the same place is skipped), a dangling link or one
 *  leading out of the repository is ignored, the skipped glue is matched
 *  however it is reached, and files are reported by their real path. */
function sourceFiles(dir: string, seen = new Set<string>()): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    let real: string;
    try {
      real = realpathSync(full);
    } catch {
      continue; // a dangling link
    }
    if (entry.isDirectory() || (entry.isSymbolicLink() && statSync(real).isDirectory())) {
      if (entry.name === "node_modules" || SKIPPED_DIRS.has(real) || seen.has(real) || !insideRoot(real)) continue;
      seen.add(real);
      out.push(...sourceFiles(real, seen));
    } else if (SOURCE.test(entry.name) && !TEST.test(entry.name) && insideRoot(real)) out.push(real);
  }
  return out;
}

const realRoot = realpathSync(root);
function insideRoot(real: string): boolean {
  const r = relative(realRoot, real);
  return r !== "" && !r.startsWith("..") && !isAbsolute(r);
}
const rel = (file: string) => relative(realRoot, file).replace(/\\/g, "/");
// Every tree is required: a renamed tree fails here instead of dropping out of the scan.
const byTree = () => SCANNED_TREES.map((d) => ({ tree: d, files: sourceFiles(resolve(root, d)) }));
const scanned = () => byTree().flatMap((t) => t.files);

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
    for (const { tree, files } of byTree()) expect(files.length, `${tree}/ walked no sources`).toBeGreaterThan(0);
    expect(NAMES_RELAY_OP.test("engine.towerSetCars(id, 2)")).toBe(true);
    expect(NAMES_RELAY_OP.test("sim.setCars(id, 2)")).toBe(false);
  });
});
