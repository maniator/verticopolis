/**
 * Rewrites `engine-rs/src/compat-record.json` from the tree (`npm run engine:compat`).
 * Bump `version` in `engine-rs/Cargo.toml` first when the conformance lock,
 * `SAVE_VERSION` or the public Rust/WASM interface changed; the rules and the
 * guard are in `src/build/engineCompat.ts`.
 *
 * Keep this file ERASABLE (see screenshot-env.ts) so `node` runs it directly.
 */
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
if (existsSync(path)) {
  const moved = unbumpedPins(
    JSON.parse(readFileSync(path, "utf8")) as CompatRecord,
    record,
  );
  if (moved.length > 0) {
    console.error(
      `${moved.join(", ")} changed but the crate is still ${record.crateVersion}: bump \`version\` in engine-rs/Cargo.toml first (release plan 7.4)`,
    );
    process.exit(1);
  }
}
writeFileSync(path, recordText(record));
console.log(
  `wrote ${COMPAT_RECORD_PATH}: crate ${record.crateVersion}, lock ${record.lockDigest}, save ${record.saveVersion}, interface ${record.interfaceDigest}`,
);
