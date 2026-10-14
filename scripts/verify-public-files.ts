/**
 * Post-build guard (#974): every file Vite copies from `src/public/` into
 * `dist/` is listed in `src/build/publicFiles.ts` with its source and license.
 * That folder ships outside the module graph, so no sourcemap names its files
 * and `gen-third-party-notices.ts` cannot attribute a package font, image,
 * stylesheet or sound placed there; this list is the record instead.
 *
 * Fails the build (one line, non-zero exit) when a file under `src/public/`
 * has no entry, an entry names a file that is gone, a listed file did not
 * ship in `dist/`, an operating system's file (`.DS_Store`) sits in the
 * folder, or a folder cannot be read, a link is broken, or a link points
 * back to a folder above it. `src/public/engine/` is left out: the WASM engine package
 * is attributed by its own record (#955). Runs in `verify:dist`, right after
 * the notices.
 *
 * Keep this file ERASABLE (see screenshot-env.ts) so `node` runs it directly.
 */
import { existsSync, readdirSync, realpathSync, statSync, type Dirent } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, resolve } from "node:path";
import { PUBLIC_FILES, isExcludedPublicPath, publicFileProblems } from "../src/build/publicFiles.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// VC_PUBLIC_SRC and VC_PUBLIC_DIST point the check at fixture trees; its test
// uses them (publicFiles.test.ts). Honored only under vitest, so a stray
// variable in a real build cannot check another tree.
const PUBLIC = process.env.VITEST && process.env.VC_PUBLIC_SRC ? resolve(process.env.VC_PUBLIC_SRC) : join(ROOT, "src", "public");
const DIST = process.env.VITEST && process.env.VC_PUBLIC_DIST ? resolve(process.env.VC_PUBLIC_DIST) : join(ROOT, "dist");

function fail(msg: string): never {
  process.stderr.write(`verify-public-files: ${msg}\n`);
  process.exit(1);
}

/** Every file under `dir`, as `/`-separated paths relative to `base`, excluded folders left out. */
function filesUnder(dir: string, base: string, ancestors: readonly string[] = []): string[] {
  const out: string[] = [];
  // A link back to a folder above it would loop forever. Two links to one
  // folder side by side are fine: Vite copies it twice.
  let real = "";
  let entries: Dirent[] = [];
  try {
    real = realpathSync(dir);
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    fail(`src/public/${relative(base, dir).replace(/\\/g, "/") || "."} cannot be read`);
  }
  if (ancestors.includes(real)) fail(`src/public/${relative(base, dir).replace(/\\/g, "/") || "."} links back to a folder above it`);
  const chain = [...ancestors, real];
  for (const entry of entries) {
    const p = join(dir, entry.name);
    const rel = relative(base, p).replace(/\\/g, "/");
    if (isExcludedPublicPath(rel)) continue;
    let isDir = entry.isDirectory();
    if (entry.isSymbolicLink()) {
      try {
        isDir = statSync(p).isDirectory();
      } catch {
        fail(`src/public/${rel} is a broken link`);
      }
    }
    // Vite copies a linked folder's files, so walk it like a real one.
    if (isDir) out.push(...filesUnder(p, base, chain));
    else out.push(rel);
  }
  return out;
}

if (!existsSync(DIST)) fail(`${DIST} does not exist; run the build first`);
const inPublic = existsSync(PUBLIC) ? filesUnder(PUBLIC, PUBLIC) : [];
const shipped = (path: string): boolean => {
  const p = join(DIST, path);
  return existsSync(p) && statSync(p).isFile();
};
const problems = publicFileProblems(PUBLIC_FILES, inPublic, shipped);
if (problems.length > 0) fail(problems.join("; "));
console.log(`verify-public-files: ${inPublic.length} public files, each listed with its source and license`);
