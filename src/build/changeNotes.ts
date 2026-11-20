/**
 * Change notes: how a pull request records its version tier without editing a
 * version. Each PR adds one file, `.changes/<branch-slug>.md`:
 *
 *     ---
 *     app: minor
 *     ---
 *     ## Player
 *     - Elevators now skip floors with nobody waiting.
 *     ## Contributors
 *     - (optional, any level) who to thank and for what.
 *
 * `app` takes `major`, `minor`, `patch` or `none`, by the tier rules in
 * CONTRIBUTING.md "Versioning". The engine is versioned and released from
 * Verticopolis/engine; the game moves to a new engine by raising
 * `@verticopolis/engine` in package.json, which is a game change like any
 * other. Notes written before the split say `crate: none`, which is still
 * read and means nothing. The release driver runs `npm run release`
 * (`scripts/release.ts`) on a `release/` branch: it raises the version by the
 * highest pending level, writes the changelog section from the notes and
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
  /** Lines for `CHANGELOG.md`, the player-facing "What's new". */
  player: string[];
  /** Who to thank in the release notes: a community author, reporter or
   *  tester, by the name they go by, and what they did. */
  contributors: string[];
}

/** A note's file name: a branch slug, lower case, ending in `.md`. */
const NOTE_NAME = /^[a-z0-9][a-z0-9._-]*\.md$/;
type Section = "player" | "contributors";
const SECTIONS = new Map<string, Section>([
  ["## Player", "player"],
  ["## Contributors", "contributors"],
]);
/** Where a note's engine change goes now. */
const ENGINE_HOME =
  "the engine is versioned in Verticopolis/engine: write its change there, and raise @verticopolis/engine here once it is released";
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
  let app: Level | undefined;
  for (const raw of lines.slice(1, close)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (line === "") continue;
    // A note from before the split; its only allowed value says nothing.
    if (line === "crate: none") continue;
    if (/^(crate|readmes):/.test(line)) fail(`"${raw}": ${ENGINE_HOME}`);
    const m = /^app:\s*(\S+)$/.exec(line);
    if (!m) fail(`"${raw}" is not "app: <level>"`);
    const value = (m as RegExpExecArray)[1];
    if (app !== undefined) fail("app is set twice");
    if (!(LEVELS as readonly string[]).includes(value)) fail(`app: ${value} is not one of ${LEVELS.join(", ")}`);
    app = value as Level;
  }
  if (app === undefined) fail("the front matter has no app level");
  const note: ChangeNote = { file, app: app as Level, player: [], contributors: [] };
  let section: Section | null = null;
  const seen = new Set<string>();
  for (const raw of lines.slice(close + 1)) {
    const line = raw.trimEnd();
    if (line === "") continue;
    if (line === "## Engine") fail(`## Engine: ${ENGINE_HOME}`);
    const heading = SECTIONS.get(line);
    if (heading !== undefined) {
      if (seen.has(line)) fail(`${line} appears twice`);
      seen.add(line);
      section = heading;
      continue;
    }
    if (section === null) fail(`"${line}" comes before a "## Player" or "## Contributors" heading`);
    if (!line.startsWith("- ") || line.trim() === "-") fail(`"${line}" is not a one-line "- " bullet`);
    const bullet = line.slice(2).trim();
    if (!bullet.endsWith(".")) fail(`"${bullet}" does not end with a period`);
    if (bullet.includes(EM_DASH)) fail(`"${bullet}" has an em-dash`);
    note[section as Section].push(bullet);
  }
  if (note.app === "none" && note.player.length > 0) fail("Player lines need an app level other than none");
  if (note.app !== "none" && note.player.length === 0)
    fail("an app level needs at least one Player line for CHANGELOG.md and the update prompt");
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

/**
 * The notes with the highest app level first, so a release's headline (the
 * major note of a named release, say) opens its changelog section and the
 * update prompt. Notes of one level keep their file order.
 */
export function headlineFirst<T extends Pick<ChangeNote, "app">>(notes: readonly T[]): T[] {
  return [...notes].sort((a, b) => LEVELS.indexOf(b.app) - LEVELS.indexOf(a.app));
}

const PLAIN_SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

/**
 * Whether `to` is a later plain `x.y.z` than `from`. A pre-release, a build
 * suffix, a lower number or the same number is not a bump.
 */
export function isSemverIncrease(from: string, to: string): boolean {
  const a = PLAIN_SEMVER.exec(from);
  const b = PLAIN_SEMVER.exec(to);
  if (!a || !b) return false;
  for (let i = 1; i <= 3; i++) {
    const d = Number(b[i]) - Number(a[i]);
    if (d !== 0) return d > 0;
  }
  return false;
}

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
 * The notes a release must keep because their credits went nowhere: when the
 * app does not move, CHANGELOG.md gets no section, so a note that credits
 * someone waits for the next app release.
 */
export function notesKeptForCredits(notes: readonly ChangeNote[], appMoved: boolean): ChangeNote[] {
  if (appMoved) return [];
  return notes.filter((n) => n.contributors.length > 0);
}

/** The notes' Contributors lines, each once, in note order. */
export function contributorLines(notes: readonly ChangeNote[]): string[] {
  return [...new Set(notes.flatMap((n) => n.contributors))];
}

/**
 * The changelog with a new section above the newest one. `heading` is the text
 * after `## `; it must name a version the file does not have yet. `credits`
 * go under a `### Contributors` heading after the bullets, so the update
 * prompt, which reads only the section's first list, never shows them.
 */
export function insertSection(
  changelog: string,
  heading: string,
  bullets: readonly string[],
  credits: readonly string[] = [],
): string {
  const version = /^\d+\.\d+\.\d+/.exec(heading)?.[0];
  if (!version) throw new Error(`"${heading}" does not start with a version`);
  if (changelogVersions(changelog).includes(version)) throw new Error(`the changelog already has a ${version} section`);
  const eol = changelog.includes("\r\n") ? "\r\n" : "\n";
  const thanks = credits.length > 0 ? ["### Contributors", "", ...credits.map((c) => `- ${c}`), ""] : [];
  const section = [`## ${heading}`, "", ...bullets.map((b) => `- ${b}`), "", ...thanks, ""].join(eol);
  const at = changelog.search(/^## /m);
  if (at < 0) return `${changelog.replace(/\s*$/, "")}${eol}${eol}${section}`;
  return changelog.slice(0, at) + section + changelog.slice(at);
}
