import { readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, relative, resolve } from "node:path";

/**
 * The source walk the repository guards share (the file-size ceiling, the Rust
 * prose rule). Build output and generated packages are skipped by their exact
 * repo-relative path, so a source directory that happens to be named `target`
 * or `pkg` is still checked; `node_modules`, `dist` and `.git` are skipped
 * wherever they appear.
 */

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Generated output under the scanned roots, by repo-relative path. */
export const SKIPPED_PATHS: ReadonlySet<string> = new Set([
  "engine-rs/target",
  "engine-rs/consumer/target",
  "engine-rs/pkg",
  "src/public/engine",
]);

const SKIPPED_NAMES: ReadonlySet<string> = new Set(["node_modules", "dist", ".git"]);

/** Repo-relative path with forward slashes. */
export function repoRel(abs: string): string {
  return relative(repoRoot, abs).split("\\").join("/");
}

/** Every file under `dir` (repo-relative) whose name ends with one of `exts`,
 *  as absolute paths. */
export function sourceFiles(dir: string, exts: readonly string[]): string[] {
  const out: string[] = [];
  const walk = (absDir: string): void => {
    for (const entry of readdirSync(absDir)) {
      const abs = resolve(absDir, entry);
      if (statSync(abs).isDirectory()) {
        if (SKIPPED_NAMES.has(entry) || SKIPPED_PATHS.has(repoRel(abs))) continue;
        walk(abs);
      } else if (exts.some((ext) => entry.endsWith(ext))) {
        out.push(abs);
      }
    }
  };
  walk(resolve(repoRoot, dir));
  return out;
}
