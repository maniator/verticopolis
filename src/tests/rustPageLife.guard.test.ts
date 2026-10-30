import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { repoRel, sourceFiles } from "./guardFiles";

/**
 * A page life never returns to Rust after a fallback (#1258). The engine is
 * the port the app holds: Load, import and New go through it
 * (`enginePort()`), so once the first tower is on the TypeScript port,
 * nothing offers a later tower to the Rust engine. That holds only while
 * the Rust engine can enter a page life at one place, the boot in
 * `src/bootstrap.ts`. A second caller of the Rust boot (a Load that retries
 * Rust, say) would reopen the gap with every other test green, so this fails
 * on it.
 */
const BOOT_CALLS = ["rustBootTower(", "loadWasmEngine(", "publishRustEngine("] as const;

/** Where each call may appear in shipped code: its definition, the boot, and
 *  the `.TDT` codec, which loads the package only to read and write a file
 *  with a short-lived engine and never offers a tower to Rust. */
const ALLOWED = new Set(["src/wasmhost/rustEngine.ts", "src/bootstrap.ts", "src/engine/port/tdtCodec.ts"]);

const isTestFile = (rel: string): boolean => /\.(test|spec|fixture)\.tsx?$/.test(rel) || rel.startsWith("src/tests/");

describe("the Rust engine enters a page life at the boot only", () => {
  const files = sourceFiles("src", [".ts", ".tsx"]).map((abs) => ({ rel: repoRel(abs), text: readFileSync(abs, "utf8") }));

  it("names each Rust boot call outside the boot and its definition nowhere", () => {
    const strays = files.filter((f) => !isTestFile(f.rel) && !ALLOWED.has(f.rel) && BOOT_CALLS.some((c) => f.text.includes(c))).map((f) => f.rel);
    expect(strays).toEqual([]);
  });

  it("calls each once in the boot, so no later tower reaches the Rust engine", () => {
    const boot = files.find((f) => f.rel === "src/bootstrap.ts")!.text;
    for (const call of BOOT_CALLS) expect(boot.split(call).length - 1, call).toBe(1);
  });
});
