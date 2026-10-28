import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * The TypeScript engine's source hash (#1422): a SHA-256 over every
 * non-test `.ts` file under `src/engine`, each one's path relative to that
 * folder and its bytes, in sorted order. It is built into the page as
 * `__TS_ENGINE_SOURCES__` and shown beside the engine's pinned version
 * (`src/wasmhost/tsEngineIdentity.ts`), so a report names the engine code
 * the way the Rust binary's source hash does. Node only (the Vite config and
 * its test); never imported by the app.
 */
export function tsEngineSourceHash(engineDir: string): string {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir).sort()) {
      const p = join(dir, name);
      if (lstatSync(p).isDirectory()) walk(p);
      else if (name.endsWith(".ts") && !name.endsWith(".test.ts"))
        files.push(p);
    }
  };
  walk(engineDir);
  const hash = createHash("sha256");
  for (const p of files) {
    hash.update(relative(engineDir, p).split("\\").join("/"));
    hash.update("\0");
    hash.update(readFileSync(p));
    hash.update("\0");
  }
  return hash.digest("hex");
}
