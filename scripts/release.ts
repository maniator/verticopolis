/**
 * Cuts a release from the pending change notes (`npm run release`). Run it on a
 * fresh `release/<version>` branch off an up-to-date main, review the result,
 * then commit and open the release PR:
 *
 *   npm run release                    the levels the notes ask for
 *   npm run release -- --app 3.0.0     a named app version (a headline release)
 *   npm run release -- --date 2026-11-10   the engine changelog's date (default today, UTC)
 *
 * It raises the app version with `npm version` (package.json and the lockfile
 * together) and writes the `CHANGELOG.md` section from the notes' Player lines;
 * when a note has a crate level it raises the crate in `engine-rs/Cargo.toml`
 * and the three `Cargo.lock` files that pin it (the crate, its consumer check
 * and the bench), writes the `engine-rs/CHANGELOG.md` section from
 * the Engine lines and runs `npm run engine:compat`. Then it deletes the notes.
 * The rules are in `src/build/changeNotes.ts`; CI checks the result with
 * `scripts/version-check.ts`.
 *
 * Keep this file ERASABLE (see screenshot-env.ts) so `node` runs it directly.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CHANGES_DIR,
  bumpVersion,
  highestLevel,
  insertSection,
  readNotes,
  setCargoVersion,
  setLockVersion,
} from "../src/build/changeNotes.ts";
import { cargoPackage, isSemverIncrease } from "../src/build/engineCompat.ts";
import { MAX_NOTE_LEN, MAX_NOTES } from "../src/pwaUpdateInfo.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const path = (rel: string) => join(root, rel);
const read = (rel: string) => readFileSync(path(rel), "utf8");
const write = (rel: string, text: string) => writeFileSync(path(rel), text);
const npm = (args: string[]) =>
  execFileSync(process.platform === "win32" ? "npm.cmd" : "npm", args, { cwd: root, stdio: "inherit", shell: process.platform === "win32" });
const node = (args: string[]) => execFileSync(process.execPath, args, { cwd: root, stdio: "inherit" });

const refuse = (message: string): never => {
  console.error(`release: ${message}`);
  process.exit(1);
};

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const dirty = execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).trim();
if (dirty !== "") refuse("the working tree has uncommitted changes; run it on a clean release/ branch off main");

let notes;
try {
  notes = readNotes(root);
} catch (e) {
  refuse(e instanceof Error ? e.message : String(e));
}
if (!notes || notes.length === 0) refuse(`no pending notes in ${CHANGES_DIR}/, so there is nothing to release`);
const pending = notes as NonNullable<typeof notes>;

const branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
if (!branch.startsWith("release/")) console.warn(`release: on ${branch}; CI checks a release only on a release/ branch`);

const appLevel = highestLevel(pending.map((n) => n.app));
const crateLevel = highestLevel(pending.map((n) => n.crate));
const appWas = (JSON.parse(read("package.json")) as { version: string }).version;
const named = arg("--app");
let app = bumpVersion(appWas, appLevel);
if (named !== undefined) {
  if (appLevel === "none") refuse(`--app ${named} needs a pending note with an app level`);
  if (named !== app && !isSemverIncrease(app, named)) refuse(`--app ${named} is not ${app} or later`);
  app = named;
}

if (app !== appWas) {
  npm(["version", app, "--no-git-tag-version"]);
  const lines = pending.flatMap((n) => n.player);
  write("CHANGELOG.md", insertSection(read("CHANGELOG.md"), app, lines));
  if (lines.length > MAX_NOTES) console.warn(`release: ${lines.length} player lines; the update prompt shows ${MAX_NOTES}, so merge some of them in CHANGELOG.md`);
  const long = lines.filter((l) => l.length > MAX_NOTE_LEN).length;
  if (long > 0) console.warn(`release: ${long} player line(s) over ${MAX_NOTE_LEN} characters; the update prompt would cut them, so split them in CHANGELOG.md`);
}

const crate = cargoPackage(read("engine-rs/Cargo.toml"));
const crateNow = bumpVersion(crate.version, crateLevel);
if (crateNow !== crate.version) {
  const date = arg("--date") ?? new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) refuse(`--date ${date} is not YYYY-MM-DD`);
  write("engine-rs/Cargo.toml", setCargoVersion(read("engine-rs/Cargo.toml"), crateNow));
  for (const lock of ["engine-rs/Cargo.lock", "engine-rs/consumer/Cargo.lock", "engine-bench/Cargo.lock"]) write(lock, setLockVersion(read(lock), crate.name, crateNow));
  const changelog = "engine-rs/CHANGELOG.md";
  write(changelog, insertSection(read(changelog), `${crateNow} (${date})`, pending.flatMap((n) => n.engine)));
  node(["scripts/engine-compat.ts"]);
}

for (const n of pending) unlinkSync(path(`${CHANGES_DIR}/${n.file}`));
console.log(
  `release: app ${appWas} -> ${app} (${named ? "named" : appLevel}), crate ${crate.version} -> ${crateNow} (${crateLevel}), ${pending.length} notes consumed (${pending.map((n) => n.file).join(", ")}). Review the changelogs, commit, and open the PR from release/${app}.`,
);
