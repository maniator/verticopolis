import { repoRel, sourceFiles } from "./guardFiles";
import { isTestFile } from "./importScan";

/**
 * The frontend files the TypeScript engine guards scan, shared so they scan
 * the same set (`frontendEngineImports.guard.test.ts`, #1118, and
 * `frontendRuleReads.guard.test.ts`, #921 part 2c).
 */

/** What under `src/` is not frontend: the engine itself, the test tree, and
 *  the host and save code (`src/wasmhost/`, `src/dualrun/`, `src/storage/`),
 *  whose engine imports the retirement inventory's own tables cover ("Retiring
 *  the TypeScript engine: the inventory" in
 *  `_bmad-output/planning-artifacts/architecture/architecture-engine-rust-port-2026-10-08.md`). */
export const NOT_FRONTEND = ["src/engine/", "src/tests/", "src/wasmhost/", "src/dualrun/", "src/storage/"] as const;

/** Every non-test frontend file under `src/`, repo-relative. */
export function frontendFiles(): string[] {
  return sourceFiles("src", [".ts", ".tsx"])
    .map(repoRel)
    .filter((rel) => !rel.endsWith(".d.ts") && !isTestFile(rel) && !NOT_FRONTEND.some((dir) => rel.startsWith(dir)))
    .sort();
}
