/**
 * Writes the Player's Manual's offline worker, dist/help/sw.js, after the help
 * site's build (help-site's `build` script runs it): the list of built files
 * it saves (src/build/manualWorkerBuild.ts) and src/manual/manualWorker.ts
 * compiled to one classic script. A missing manual build fails, since the
 * manual's host would then serve no worker.
 *
 *   node scripts/manual-worker.ts
 *
 * Keep this file ERASABLE (see screenshot-env.ts) so `node` runs it directly.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { manualConfig, manualWorkerSource, type BuiltFile } from "../src/build/manualWorkerBuild.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const HELP = join(ROOT, "dist", "help");
const SW = join(HELP, "sw.js");
const WORKER = join(ROOT, "src", "manual", "manualWorker.ts");

if (!existsSync(HELP)) {
  console.error(`manual-worker: ${HELP} does not exist; build the help site first`);
  process.exit(1);
}

/** Every file under `dir`, the worker itself left out. */
function walk(dir: string): BuiltFile[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    if (full === SW) return [];
    return [{ path: relative(HELP, full).split(sep).join("/"), bytes: readFileSync(full) }];
  });
}

const config = manualConfig(walk(HELP));
const compiled = ts.transpileModule(readFileSync(WORKER, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, removeComments: true },
  fileName: WORKER,
}).outputText;
writeFileSync(SW, manualWorkerSource(config, compiled));
console.log(`manual-worker: dist/help/sw.js saves ${config.files.length} files (version ${config.version})`);
