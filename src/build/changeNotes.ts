/**
 * Change notes: how a pull request records its version tier without editing a
 * version. Each PR adds one file, `.changes/<branch-slug>.md`:
 *
 *     ---
 *     app: minor
 *     crate: none
 *     readmes: unchanged   (optional, see below)
 *     ---
 *     ## Player
 *     - Elevators now skip floors with nobody waiting.
 *     ## Engine
 *     - (only when `crate` is not none) what changed in the engine's contract.
 *
 * `app` and `crate` take `major`, `minor`, `patch` or `none`, by the tier rules
 * in CONTRIBUTING.md "Versioning". `readmes: unchanged` says the PR changes the
 * engine and its author checked that both engine READMEs (the WASM package's
 * and the crate's) still describe it; `scripts/version-check.ts` asks for that
 * line or a README edit on every engine change. The release driver runs `npm run release`
 * (`scripts/release.ts`) on a `release/` branch: it raises each version by the
 * highest pending level, writes the changelog sections from the notes and
 * deletes them. `scripts/version-check.ts` (run in CI) keeps feature PRs off
 * the version lines and checks a release PR's arithmetic, and
 * `scripts/vercel-ignore-build.sh` holds production deploys while a note with a
 * level other than `none` is pending.
 *
 * Node only, and ERASABLE (see scripts/screenshot-env.ts) so the scripts run it
 * under plain `node`; never imported by the app.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const CHANGES_DIR = ".changes";
/** The folder's own guide, which is not a note. */
export const CHANGES_README = "README.md";

/** Lowest to highest, so the index orders them. */
export const LEVELS = ["none", "patch", "minor", "major"] as const;
export type Level = (typeof LEVELS)[number];

export interface ChangeNote {
  /** The file name inside `.changes/`. */
  file: string;
  app: Level;
  crate: Level;
  /** Lines for `CHANGELOG.md`, the player-facing "What's new". */
  player: string[];
  /** Lines for `engine-rs/CHANGELOG.md`. */
  engine: string[];
  /** `readmes: unchanged`: the engine READMEs were checked and still hold. */
  readmesUnchanged?: boolean;
}

/** A note's file name: a branch slug, lower case, ending in `.md`. */
const NOTE_NAME = /^[a-z0-9][a-z0-9._-]*\.md$/;
const SECTIONS = new Map<string, "player" | "engine">([
  ["## Player", "player"],
  ["## Engine", "engine"],
]);
const EM_DASH = "—";

export function isNoteFile(name: string): boolean {
  return name !== CHANGES_README && name.endsWith(".md");
}

/** Reads a note, or throws naming the file and the first problem. */
export function parseNote(text: string, file: string): ChangeNote {
  const fail = (why: string): never => {
    throw new Error(`${CHANGES_DIR}/${file}: ${why}`);
  };
  if (!NOTE_NAME.test(file)) fail("the name must be a lower-case branch slug ending in .md");
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  if (lines[0] !== "---") fail('the first line must be "---"');
  const close = lines.indexOf("---", 1);
  if (close < 0) fail('the front matter has no closing "---"');
  const levels: Partial<Record<"app" | "crate", Level>> = {};
  let readmesUnchanged = false;
  for (const raw of lines.slice(1, close)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (line === "") continue;
    const readmes = /^readmes:\s*(\S+)$/.exec(line);
    if (readmes) {
      if (readmesUnchanged) fail("readmes is set twice");
      if (readmes[1] !== "unchanged") fail(`readmes: ${readmes[1]} is not "unchanged" (leave the line out when the PR updates a README)`);
      readmesUnchanged = true;
      continue;
    }
    const m = /^(app|crate):\s*(\S+)$/.exec(line);
    if (!m) fail(`"${raw}" is not "app: <level>", "crate: <level>" or "readmes: unchanged"`);
    const [, key, value] = m as RegExpExecArray;
    const k = key as "app" | "crate";
    if (levels[k] !== undefined) fail(`${k} is set twice`);
    if (!(LEVELS as readonly string[]).includes(value)) fail(`${k}: ${value} is not one of ${LEVELS.join(", ")}`);
    levels[k] = value as Level;
  }
  if (levels.app === undefined) fail("the front matter has no app level");
  if (levels.crate === undefined) fail("the front matter has no crate level");
  const note: ChangeNote = { file, app: levels.app as Level, crate: levels.crate as Level, player: [], engine: [] };
  if (readmesUnchanged) note.readmesUnchanged = true;
  let section: "player" | "engine" | null = null;
  const seen = new Set<string>();
  for (const raw of lines.slice(close + 1)) {
    const line = raw.trimEnd();
    if (line === "") continue;
    const heading = SECTIONS.get(line);
    if (heading !== undefined) {
      if (seen.has(line)) fail(`${line} appears twice`);
      seen.add(line);
      section = heading;
      continue;
    }
    if (section === null) fail(`"${line}" comes before a "## Player" or "## Engine" heading`);
    if (!line.startsWith("- ") || line.trim() === "-") fail(`"${line}" is not a one-line "- " bullet`);
    const bullet = line.slice(2).trim();
    if (!bullet.endsWith(".")) fail(`"${bullet}" does not end with a period`);
    if (bullet.includes(EM_DASH)) fail(`"${bullet}" has an em-dash`);
    note[section as "player" | "engine"].push(bullet);
  }
  if (note.app === "none" && note.player.length > 0) fail("Player lines need an app level other than none");
  if (note.crate === "none" && note.engine.length > 0) fail("Engine lines need a crate level other than none");
  if (note.crate !== "none" && note.engine.length === 0) fail("a crate level needs at least one Engine line for engine-rs/CHANGELOG.md");
  if (note.app !== "none" && note.player.length === 0) fail("an app level needs at least one Player line for CHANGELOG.md and the update prompt");
  return note;
}

/** Every pending note under `root`, sorted by file name. */
export function readNotes(root: string): ChangeNote[] {
  const dir = join(root, CHANGES_DIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(isNoteFile)
    .sort()
    .map((name) => parseNote(readFileSync(join(dir, name), "utf8"), name));
}

export function highestLevel(levels: readonly Level[]): Level {
  return levels.reduce<Level>((a, b) => (LEVELS.indexOf(b) > LEVELS.indexOf(a) ? b : a), "none");
}

const PLAIN_SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

/** `version` raised by `level`, the way `npm version <level>` raises it. */
export function bumpVersion(version: string, level: Level): string {
  const m = PLAIN_SEMVER.exec(version);
  if (!m) throw new Error(`${version} is not a plain x.y.z version`);
  const [x, y, z] = m.slice(1).map(Number);
  if (level === "major") return `${x + 1}.0.0`;
  if (level === "minor") return `${x}.${y + 1}.0`;
  if (level === "patch") return `${x}.${y}.${z + 1}`;
  return version;
}

/** The version each `## <version>` heading names, in file order. */
export function changelogVersions(changelog: string): string[] {
  return [...changelog.replace(/\r\n/g, "\n").matchAll(/^## (\d+\.\d+\.\d+)\b/gm)].map((m) => m[1]);
}

/**
 * The changelog with a new section above the newest one. `heading` is the text
 * after `## `; it must name a version the file does not have yet.
 */
export function insertSection(changelog: string, heading: string, bullets: readonly string[]): string {
  const version = /^\d+\.\d+\.\d+/.exec(heading)?.[0];
  if (!version) throw new Error(`"${heading}" does not start with a version`);
  if (changelogVersions(changelog).includes(version)) throw new Error(`the changelog already has a ${version} section`);
  const eol = changelog.includes("\r\n") ? "\r\n" : "\n";
  const section = [`## ${heading}`, "", ...bullets.map((b) => `- ${b}`), "", ""].join(eol);
  const at = changelog.search(/^## /m);
  if (at < 0) return `${changelog.replace(/\s*$/, "")}${eol}${eol}${section}`;
  return changelog.slice(0, at) + section + changelog.slice(at);
}

/** The `version = "…"` line of a Cargo.toml's `[package]` table, by line index. */
function packageVersionLine(lines: string[]): number {
  const start = lines.findIndex((l) => l.trim() === "[package]");
  if (start < 0) throw new Error("Cargo.toml has no [package] table");
  for (let i = start + 1; i < lines.length && !lines[i].trim().startsWith("["); i++) {
    if (/^version\s*=\s*"[^"]*"\s*$/.test(lines[i].trim())) return i;
  }
  throw new Error("Cargo.toml's [package] table has no version line");
}

/** A Cargo.toml with its `[package]` version set to `version`. */
export function setCargoVersion(cargoToml: string, version: string): string {
  const lines = cargoToml.split("\n");
  const i = packageVersionLine(lines);
  lines[i] = lines[i].replace(/"[^"]*"/, `"${version}"`);
  return lines.join("\n");
}

/** A Cargo.lock with package `name`'s version set to `version`. */
export function setLockVersion(cargoLock: string, name: string, version: string): string {
  const entry = new RegExp(`(name = "${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"\\r?\\nversion = ")[^"]*(")`);
  if (!entry.test(cargoLock)) throw new Error(`the lockfile has no ${name} entry`);
  return cargoLock.replace(entry, `$1${version}$2`);
}
