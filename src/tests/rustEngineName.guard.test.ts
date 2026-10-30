import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { repoRel, sourceFiles } from "./guardFiles";

/**
 * One player-facing name for the engine (#1197, spec "One player-facing
 * name"): the game says "Rust engine" and "TypeScript engine", so a tester told
 * to look for "Rust engine" finds it wherever the UI names the engine. This
 * fails any line of code in the UI templates and the engine's copy modules
 * that still says "WASM engine", multi-line templates included. That covers
 * the error messages too, since the stop screen and Help's diagnostics show
 * them. Comments, console and host logs, analytics values (`wasm`) and code
 * identifiers keep their names.
 */

const COPY_MODULES = [
  "src/wasmhost/engineLabel.ts",
  "src/wasmhost/engineDiagnostics.ts",
  "src/wasmhost/engineBoot.ts",
  "src/wasmhost/hostFault.ts",
  "src/wasmhost/rustEngine.ts",
  "src/wasmhost/catalogCheck.ts",
  "src/wasmhost/stepLoopAbsent.ts",
  "src/build/thirdPartyNotices.ts",
  "src/engineCohort/boot.ts",
  "src/bootstrap.ts",
];

const OLD_NAME = /\bWASM engine\b/i;

function hits(abs: string): string[] {
  const out: string[] = [];
  readFileSync(abs, "utf8")
    .split("\n")
    .forEach((line, i) => {
      const code = line.trim();
      if (code.startsWith("//") || code.startsWith("*") || code.startsWith("/*")) return;
      if (/console\.|\blog\.(info|warn|error)\(/.test(code)) return;
      if (OLD_NAME.test(code)) out.push(`${repoRel(abs)}:${i + 1}`);
    });
  return out;
}

describe("Rust engine name guard", () => {
  const ui = sourceFiles("src/ui", [".ts"]).filter((f) => !f.endsWith(".test.ts"));

  it("finds the UI templates", () => {
    expect(ui.length).toBeGreaterThan(20);
  });

  it("no player-facing string says WASM engine", () => {
    const files = [...ui, ...COPY_MODULES.map((f) => resolve(f))];
    expect(files.flatMap(hits)).toEqual([]);
  });
});
