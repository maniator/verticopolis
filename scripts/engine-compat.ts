/**
 * Rewrites `engine-rs/src/compat-record.json` from the tree (`npm run engine:compat`).
 * Bump `version` in `engine-rs/Cargo.toml` first when the conformance lock,
 * `SAVE_VERSION` or the public Rust/WASM interface changed; the rules and the
 * guard are in `src/build/engineCompat.ts`.
 *
 * The bump is judged against what `origin/main` records, since a version that
 * has not merged yet may be re-recorded as often as main's lock moves under it.
 * With no `origin/main` to ask (a checkout without it), the record in the
 * working tree stands in.
 *
 * Keep this file ERASABLE (see screenshot-env.ts) so `node` runs it directly.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  COMPAT_RECORD_PATH,
  computeCompat,
  recordText,
  unbumpedPins,
  type CompatRecord,
} from "../src/build/engineCompat.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const record = computeCompat(root);
const path = resolve(root, COMPAT_RECORD_PATH);

/** The record to compare the new one with: main's, when git can say what it holds. */
function baseRecord(): CompatRecord | null {
  try {
    const text = execFileSync(
      "git",
      ["show", `origin/main:${COMPAT_RECORD_PATH}`],
      { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    return JSON.parse(text) as CompatRecord;
  } catch {
    // Either main has no record yet (a new file needs no bump) or there is no
    // origin/main to read; the second case falls back to the working record.
  }
  try {
    execFileSync("git", ["rev-parse", "--verify", "--quiet", "origin/main"], {
      cwd: root,
      stdio: "ignore",
    });
    return null;
  } catch {
    return existsSync(path)
      ? (JSON.parse(readFileSync(path, "utf8")) as CompatRecord)
      : null;
  }
}

const base = baseRecord();
const moved = base ? unbumpedPins(base, record) : [];
if (moved.length > 0) {
  console.error(
    `${moved.join(", ")} changed from main's record but the crate is still ${record.crateVersion}: bump \`version\` in engine-rs/Cargo.toml first (release plan 7.4)`,
  );
  process.exit(1);
}
writeFileSync(path, recordText(record));
console.log(
  `wrote ${COMPAT_RECORD_PATH}: crate ${record.crateVersion}, lock ${record.lockDigest}, save ${record.saveVersion}, interface ${record.interfaceDigest}`,
);
