import { readFileSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { ENGINE_ROOT } from "./packagePaths";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * No engine identity value is spelled in the frontend (#963). The engine
 * writes its own record (`engineIdentity()`), `BUILD.json` records the crate
 * the package was built from, and the frontend only reads them. A literal copy
 * of the crate name, the crate version or the lock digest in shipped source
 * would be a second author that can drift from the engine. Tests and
 * fixtures name made-up values or read the record, so they are skipped, as is
 * the build tooling.
 */
const ROOT = resolve(__dirname, "../..");
const SRC = join(ROOT, "src");
// The engine's own record, from the player build the game pins.
const engine = createRequire(import.meta.url)(join(ENGINE_ROOT, "node/verticopolis_engine.js")) as {
  engineIdentity(): string;
};
const record = JSON.parse(engine.engineIdentity()) as { crate: { name: string; version: string }; lockDigest: string };
const cargoName = record.crate.name;

const FORBIDDEN: [string, RegExp][] = [
  ["the crate name", new RegExp(cargoName.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&"))],
  ["the crate version", new RegExp(`["'\`]${record.crate.version.replace(/\./g, "\\.")}["'\`]`)],
  ["the lock digest", new RegExp(record.lockDigest)],
];

const SKIP_FILE = /\.(test|fixture)\.ts$|\.d\.ts$|\.generated\./;
const SKIP_DIR = new Set(["build", "tests", "public", "testing"]);

function* sources(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (!SKIP_DIR.has(name)) yield* sources(path);
    } else if (name.endsWith(".ts") && !SKIP_FILE.test(name)) {
      yield path;
    }
  }
}

describe("engine identity literals", () => {
  it("none of the engine's identity values is spelled in shipped frontend source", () => {
    const found: string[] = [];
    for (const file of sources(SRC)) {
      const text = readFileSync(file, "utf8");
      for (const [what, re] of FORBIDDEN) if (re.test(text)) found.push(`${file.slice(ROOT.length + 1)}: ${what}`);
    }
    expect(found, "read the engine's record (engineIdentity()) or BUILD.json instead of spelling a value").toEqual([]);
  });
});
