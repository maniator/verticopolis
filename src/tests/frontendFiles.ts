import { repoRel, sourceFiles } from "./guardFiles";
import { isTestFile } from "./importScan";

/**
 * The frontend files the frontend guards scan, shared so they scan the same
 * set (`commandSites.guard.test.ts`).
 */

/** What under `src/` is not frontend: the test tree, and the host and save
 *  code (`src/wasmhost/`, `src/dualrun/`, `src/storage/`). */
export const NOT_FRONTEND = ["src/tests/", "src/wasmhost/", "src/dualrun/", "src/storage/"] as const;

/** Every non-test frontend file under `src/`, repo-relative. */
export function frontendFiles(): string[] {
  return sourceFiles("src", [".ts", ".tsx"])
    .map(repoRel)
    .filter((rel) => !rel.endsWith(".d.ts") && !isTestFile(rel) && !NOT_FRONTEND.some((dir) => rel.startsWith(dir)))
    .sort();
}
