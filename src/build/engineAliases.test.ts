import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

/**
 * vite.config.ts swaps two modules by import specifier (`engineAliases`):
 * `./sim/loop` in wasm-only builds and `./dualrun/dualRun` in player builds.
 * A specifier alias matches the text from any importer, so these pin that
 * exactly the intended file uses each one, and that the real modules are not
 * reached by another specifier the alias would miss. The postbuild guard
 * (scripts/verify-engine-bundle.ts) still proves the emitted result.
 */
const ROOT = resolve(__dirname, "..", "..");
const SRC = join(ROOT, "src");

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name !== "public" && name !== "tests") sources(p, out);
    } else if (/\.ts$/.test(name) && !/\.(test|spec)\.ts$/.test(name) && !name.endsWith(".d.ts")) out.push(p);
  }
  return out;
}

/** Value-import specifiers of a file (type-only imports are erased). */
function imports(file: string): string[] {
  const text = readFileSync(file, "utf8");
  return [...text.matchAll(/^\s*import\s+(?!type\b)[^;]*?from\s+["']([^"']+)["']/gm)].map((m) => m[1]);
}

const files = sources(SRC).map((f) => ({ file: relative(ROOT, f).split("\\").join("/"), specs: imports(f) }));

describe("the engine aliases' specifiers", () => {
  it("only Simulation.ts imports ./sim/loop, and no app code reaches the loop another way", () => {
    expect(files.filter((f) => f.specs.includes("./sim/loop")).map((f) => f.file)).toEqual(["src/engine/Simulation.ts"]);
    const other = files.filter((f) => f.file !== "src/engine/Simulation.ts" && f.specs.some((s) => /(^|\/)sim\/loop(\.ts)?$/.test(s) && s !== "./sim/loop"));
    expect(other.map((f) => f.file)).toEqual([]);
  });

  it("only bootstrap.ts imports ./dualrun/dualRun as a value", () => {
    expect(files.filter((f) => f.specs.includes("./dualrun/dualRun")).map((f) => f.file)).toEqual(["src/bootstrap.ts"]);
    const other = files.filter((f) => f.file !== "src/bootstrap.ts" && f.specs.some((s) => /(^|\/)dualRun(\.ts)?$/.test(s)));
    expect(other.map((f) => f.file)).toEqual([]);
  });
});
