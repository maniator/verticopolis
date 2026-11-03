/**
 * The freeze guard (#1647): fails a pull request that moves the differential's
 * window key while a replay window is open. See src/tests/conformance/fuzzFreeze.ts.
 *   npx tsx scripts/fuzz-freeze.ts [--marker <file>] [--base <marker file on the base branch>]
 * --marker defaults to the repository's own marker; the tests point it at others.
 * Exit 0 ok, 1 the freeze is broken, 3 the guard could not decide (a missing or
 * malformed marker, or a key that cannot be computed). A missing --base file
 * reads as a base with no marker.
 */
import { existsSync, readFileSync } from "node:fs";
import { checkFreeze, FREEZE_MARKER_PATH, parseMarker, type FreezeMarker } from "../src/tests/conformance/fuzzFreeze.ts";
import { fuzzKey, fuzzKeyParts } from "../src/tests/conformance/fuzzKey.ts";

function fail(message: string): never {
  console.error(`fuzz-freeze: ${message}`);
  process.exit(3);
}

function flag(name: string): string | undefined {
  const at = process.argv.indexOf(name);
  if (at < 0) return undefined;
  const value = process.argv[at + 1];
  if (!value) fail(`${name} needs a file`);
  return value;
}

const basePath = flag("--base");
const markerPath = flag("--marker") ?? FREEZE_MARKER_PATH;

if (!existsSync(markerPath)) fail(`${markerPath} is missing`);
const head = parseMarker(readFileSync(markerPath, "utf8"));
if (typeof head === "string") fail(`${markerPath}: ${head}`);

let base: FreezeMarker | null = null;
if (basePath && existsSync(basePath) && readFileSync(basePath, "utf8").trim() !== "") {
  const parsed = parseMarker(readFileSync(basePath, "utf8"));
  if (typeof parsed !== "string") base = parsed;
  // A damaged marker on the base must not block the PR that repairs it, so a closed head
  // marker passes with a warning. An open head cannot be judged against a base it cannot read.
  else if (head.open) fail(`the base marker: ${parsed}`);
  else console.warn(`fuzz-freeze: the base marker is damaged (${parsed}); this PR closes the window, so it passes`);
}

let key: string;
try {
  key = fuzzKey(fuzzKeyParts());
} catch (error) {
  fail(`the window key could not be computed: ${error instanceof Error ? error.message : String(error)}`);
}

const verdict = checkFreeze(head, base, key);
console.log(`${verdict.ok ? "ok" : "FROZEN"}: ${verdict.message} (key ${key})`);
process.exit(verdict.ok ? 0 : 1);
