/**
 * Rewrites `engine-rs/src/compat-record.json` from the tree (`npm run engine:compat`).
 * Run it after changing the conformance lock, a version constant or the public
 * Rust/WASM interface. A feature PR does not bump the crate itself: its
 * `.changes` note declares `crate: <level>`, and the release PR raises the
 * version (`npm run release`, which runs this again). The rules and the guard
 * are in `src/build/engineCompat.ts` and `src/build/changeNotes.ts`.
 *
 * The bump is judged against what `origin/main` records, since a version that
 * has not merged yet may be re-recorded as often as main's lock moves under it.
 * It fetches `origin/main` first, says which commit it compared with, and
 * refuses when it cannot read main's record (see `baseRecord`).
 *
 * Keep this file ERASABLE (see screenshot-env.ts) so `node` runs it directly.
 */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  COMPAT_RECORD_PATH,
  baseRecord,
  computeCompat,
  isSemverIncrease,
  recordText,
  unbumpedPins,
} from "../src/build/engineCompat.ts";
import { readNotes } from "../src/build/changeNotes.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const git = (args: string[]) =>
  execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

const refuse = (message: string): never => {
  console.error(message);
  process.exit(1);
};

try {
  git(["fetch", "--quiet", "origin", "main"]);
} catch {
  console.warn(
    "could not fetch origin main; comparing with the copy already here",
  );
}

const record = computeCompat(root);
let base;
try {
  base = baseRecord(git);
} catch (e) {
  refuse(e instanceof Error ? e.message : String(e));
}
if (base?.record) {
  const was = base.record.crateVersion;
  if (
    was !== record.crateVersion &&
    !isSemverIncrease(was, record.crateVersion)
  )
    refuse(
      `crate ${record.crateVersion} is not a later x.y.z release than ${was} on ${base.source}`,
    );
  const moved = unbumpedPins(base.record, record);
  if (moved.length > 0) {
    let notes;
    try {
      notes = readNotes(root);
    } catch (e) {
      refuse(e instanceof Error ? e.message : String(e));
    }
    const carriers = (notes ?? []).filter((n) => n.crate !== "none");
    if (carriers.length === 0)
      refuse(
        `${moved.join(", ")} changed from ${base.source}'s record but the crate is still ${record.crateVersion} and no .changes note declares a crate level: set \`crate:\` in this PR's note, and the release PR raises the version (CONTRIBUTING.md "The engine crate version")`,
      );
    console.log(
      `${moved.join(", ")} moved under crate ${record.crateVersion}; ${carriers.map((n) => n.file).join(", ")} carry the bump to the release PR`,
    );
  }
}
writeFileSync(resolve(root, COMPAT_RECORD_PATH), recordText(record));
console.log(
  `wrote ${COMPAT_RECORD_PATH}: crate ${record.crateVersion}, lock ${record.lockDigest}, save ${record.saveVersion}, interface ${record.interfaceDigest} (compared with ${base?.source})`,
);
