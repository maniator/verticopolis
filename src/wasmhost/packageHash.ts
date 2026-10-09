import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * A hash over the Rust sources the served package is built from: every file
 * under `engine-rs/src` plus `Cargo.toml` and `Cargo.lock`, by path and
 * content, so the committed `src/public/engine/BUILD.json` can say which engine
 * it holds and a test can tell when the sources moved on without a rebuild.
 * Node only (the build script and the test); never imported by the app.
 */
export function engineSourceHash(crate: string): string {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir).sort()) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else files.push(p);
    }
  };
  walk(join(crate, "src"));
  files.push(join(crate, "Cargo.toml"), join(crate, "Cargo.lock"));
  const h = createHash("sha256");
  for (const p of files) {
    h.update(relative(crate, p).split("\\").join("/"));
    h.update("\0");
    h.update(readFileSync(p));
    h.update("\0");
  }
  return h.digest("hex");
}
