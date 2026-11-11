import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

/**
 * vite.config.ts swaps a module by import specifier (`engineAliases`):
 * `./game/toolingSim` (in a production build).
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
    } else if (/\.[mc]?tsx?$/.test(name) && !/\.(test|spec)\.[mc]?tsx?$/.test(name) && !name.endsWith(".d.ts")) out.push(p);
  }
  return out;
}

/** Every specifier a file loads at run time: `import ... from`, `export ...
 *  from`, a bare `import "x"` and a dynamic `import("x")`. Type-only
 *  imports and exports are erased, so they are left out. */
function imports(file: string): string[] {
  const text = readFileSync(file, "utf8");
  const out: string[] = [];
  for (const m of text.matchAll(/^\s*(?:import|export)\s+(?!type\b)[^;]*?\bfrom\s+["']([^"']+)["']/gm)) out.push(m[1]);
  for (const m of text.matchAll(/^\s*import\s+["']([^"']+)["']/gm)) out.push(m[1]);
  for (const m of text.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)) out.push(m[1]);
  return out;
}

/** Whether a specifier from `file` names `target` (repository-relative, no
 *  extension), whatever relative form or extension it uses. */
function names(file: string, spec: string, target: string): boolean {
  // Relative to the importer, or root-absolute as Vite resolves "/src/...".
  if (!spec.startsWith(".") && !spec.startsWith("/")) return false;
  const base = spec.startsWith("/") ? resolve(ROOT, spec.slice(1)) : resolve(ROOT, file, "..", spec);
  const resolved = relative(ROOT, base).split("\\").join("/").replace(/\.[mc]?[jt]sx?$/, "");
  return resolved === target;
}

const files = sources(SRC).map((f) => ({ file: relative(ROOT, f).split("\\").join("/"), specs: imports(f) }));

describe("the engine aliases' specifiers", () => {
  it("only main.ts imports ./game/toolingSim, and no app code reaches the tooling tower another way", () => {
    expect(files.filter((f) => f.specs.includes("./game/toolingSim")).map((f) => f.file)).toEqual(["src/main.ts"]);
    const other = files.filter((f) => f.specs.some((s) => names(f.file, s, "src/game/toolingSim") && !(f.file === "src/main.ts" && s === "./game/toolingSim")));
    expect(other.map((f) => f.file)).toEqual([]);
  });
});
