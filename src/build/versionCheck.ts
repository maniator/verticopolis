/**
 * The CI half of the change-note flow (`src/build/changeNotes.ts`):
 * `scripts/version-check.ts` reads the pull request's base and head through git
 * and asks these functions what is wrong.
 *
 * A feature PR leaves every version line as main has it, keeps main's pending
 * notes, adds or edits a note when it changes a deployed path, and declares a
 * crate level when it moves a compatibility pin. A release PR (a `release/`
 * branch) consumes every pending note and raises each version by exactly the
 * highest pending level (only the app may go to a later version the driver
 * names, such as 3.0.0), and changes nothing but the release files.
 *
 * Node only, and ERASABLE (see scripts/screenshot-env.ts); never imported by the app.
 */
import {
  CHANGES_DIR,
  bumpVersion,
  changelogVersions,
  highestLevel,
  isNoteFile,
  parseNote,
  type ChangeNote,
} from "./changeNotes.ts";
import { COMPAT_RECORD_PATH, cargoPackage, isSemverIncrease } from "./engineCompat.ts";

/** One commit's files, read by repository path. */
export interface Tree {
  /** The file's text, or null when the commit has no such file. */
  read(path: string): string | null;
  /** The note file names in `.changes/`. */
  notes(): string[];
}

export interface Change {
  status: "A" | "M" | "D";
  path: string;
}

/** The files a release PR writes, and a feature PR leaves at main's versions. */
export const RELEASE_FILES = [
  "package.json",
  "package-lock.json",
  "CHANGELOG.md",
  "engine-rs/Cargo.toml",
  "engine-rs/Cargo.lock",
  "engine-rs/consumer/Cargo.lock",
  "engine-rs/CHANGELOG.md",
  COMPAT_RECORD_PATH,
] as const;

export const RELEASE_BRANCH = /^release\//;
/** Dependabot's branches: it cannot write a note, and a dependency bump with no
 *  note deploys at once, as it did before notes. Its version lines still hold. */
export const BOT_BRANCH = /^dependabot\//;

/** Every version a tree states, by where it states it. */
export interface Versions {
  app: string;
  "package-lock.json version": string;
  "package-lock.json root package version": string;
  crate: string;
  "engine-rs/Cargo.lock crate version": string;
  "engine-rs/consumer/Cargo.lock crate version": string;
  "compat record crateVersion": string;
  "CHANGELOG.md sections": string;
  "engine-rs/CHANGELOG.md sections": string;
}

function need(tree: Tree, path: string): string {
  const text = tree.read(path);
  if (text === null) throw new Error(`${path} is missing`);
  return text.replace(/\r\n/g, "\n");
}

function lockVersion(lock: string, name: string): string {
  return new RegExp(`name = "${name}"\\nversion = "([^"]+)"`).exec(lock)?.[1] ?? "(no entry)";
}

export function versionsOf(tree: Tree): Versions {
  const pkg = JSON.parse(need(tree, "package.json")) as { version: string };
  const lock = JSON.parse(need(tree, "package-lock.json")) as { version?: string; packages?: Record<string, { version?: string }> };
  const crate = cargoPackage(need(tree, "engine-rs/Cargo.toml"));
  const record = JSON.parse(need(tree, COMPAT_RECORD_PATH)) as { crateVersion: string };
  return {
    app: pkg.version,
    "package-lock.json version": lock.version ?? "(none)",
    "package-lock.json root package version": lock.packages?.[""]?.version ?? "(none)",
    crate: crate.version,
    "engine-rs/Cargo.lock crate version": lockVersion(need(tree, "engine-rs/Cargo.lock"), crate.name),
    "engine-rs/consumer/Cargo.lock crate version": lockVersion(need(tree, "engine-rs/consumer/Cargo.lock"), crate.name),
    "compat record crateVersion": record.crateVersion,
    "CHANGELOG.md sections": changelogVersions(need(tree, "CHANGELOG.md")).join(", "),
    "engine-rs/CHANGELOG.md sections": changelogVersions(need(tree, "engine-rs/CHANGELOG.md")).join(", "),
  };
}

/** The tree's notes, parsed, with a message for each one that does not parse. */
export function notesOf(tree: Tree): { notes: ChangeNote[]; errors: string[] } {
  const notes: ChangeNote[] = [];
  const errors: string[] = [];
  for (const file of [...tree.notes()].sort()) {
    try {
      notes.push(parseNote(need(tree, `${CHANGES_DIR}/${file}`), file));
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }
  return { notes, errors };
}

const isNotePath = (path: string): boolean =>
  path.startsWith(`${CHANGES_DIR}/`) && !path.slice(CHANGES_DIR.length + 1).includes("/") && isNoteFile(path.slice(CHANGES_DIR.length + 1));

/** The compatibility pins that moved, the crate version aside. */
function movedPins(base: Tree, head: Tree): string[] {
  const a = JSON.parse(need(base, COMPAT_RECORD_PATH)) as Record<string, unknown>;
  const b = JSON.parse(need(head, COMPAT_RECORD_PATH)) as Record<string, unknown>;
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => k !== "crateVersion" && a[k] !== b[k]);
}

const RELEASE_HOW = "versions move only in a release PR (`npm run release` on a release/ branch); add a .changes note with the tier instead (CONTRIBUTING.md \"Versioning\")";

/**
 * What a feature PR got wrong. `deployed` is every changed path that can reach
 * the deployed app (`vercel-ignore-build.sh --classify` says "build").
 */
export function checkFeature(base: Tree, head: Tree, changes: readonly Change[], deployed: ReadonlySet<string>, noteOptional = false): string[] {
  const errors: string[] = [];
  const was = versionsOf(base);
  const now = versionsOf(head);
  for (const key of Object.keys(now) as (keyof Versions)[]) {
    if (was[key] !== now[key]) errors.push(`${key} moved from "${was[key]}" to "${now[key]}": ${RELEASE_HOW}.`);
  }
  for (const c of changes) {
    if (c.status === "D" && isNotePath(c.path)) errors.push(`${c.path} was deleted: only a release PR consumes notes.`);
  }
  const { notes, errors: unreadable } = notesOf(head);
  errors.push(...unreadable);
  const touched = changes.filter((c) => c.status !== "D" && isNotePath(c.path));
  const shipped = changes.map((c) => c.path).filter((p) => deployed.has(p) && !p.startsWith(`${CHANGES_DIR}/`));
  if (shipped.length > 0 && touched.length === 0 && !noteOptional) {
    const sample = shipped.slice(0, 3).join(", ") + (shipped.length > 3 ? `, and ${shipped.length - 3} more` : "");
    errors.push(`this PR changes deployed paths (${sample}) and adds no .changes note: add .changes/<branch-slug>.md, with app: none and crate: none when no player or engine user would notice.`);
  }
  const pins = movedPins(base, head);
  const own = new Set(touched.map((c) => c.path.slice(CHANGES_DIR.length + 1)));
  if (pins.length > 0 && !notes.some((n) => own.has(n.file) && n.crate !== "none")) {
    errors.push(`${pins.join(", ")} moved in ${COMPAT_RECORD_PATH} and this PR's note declares no crate level: set crate: and add an Engine line (CONTRIBUTING.md "The engine crate version").`);
  }
  return errors;
}

/** Checks one version against the level its notes ask for. */
function checkBump(errors: string[], what: string, from: string, to: string, notes: readonly ChangeNote[], pick: (n: ChangeNote) => ChangeNote["app"], allowLater: boolean): void {
  const level = highestLevel(notes.map(pick));
  const expected = bumpVersion(from, level);
  if (to === expected) return;
  if (allowLater && level !== "none" && isSemverIncrease(expected, to)) return;
  errors.push(`${what} is ${to}, but main's ${from} raised by the highest pending ${what} level (${level}) is ${expected}.`);
}

/** A version line blanked, so two copies compare equal when only it differs. */
const blank = (pattern: RegExp) => (text: string) => text.replace(pattern, "$1");
const CRATE_LOCK = /(name = "verticopolis-engine"\nversion = )"[^"]*"/;

/** Each release file with its version fields blanked; a release PR may change
 *  nothing else in them. The changelogs are free to edit (the driver curates
 *  the new section), and the compat record may change only its crateVersion. */
const VERSION_FREE: Partial<Record<string, (text: string) => string>> = {
  "package.json": (t) => JSON.stringify({ ...JSON.parse(t), version: null }),
  "package-lock.json": (t) => {
    const lock = JSON.parse(t) as { packages?: Record<string, object> };
    const root = lock.packages?.[""];
    const packages = root ? { ...lock.packages, "": { ...root, version: null } } : lock.packages;
    return JSON.stringify({ ...lock, version: null, packages });
  },
  "engine-rs/Cargo.toml": blank(/(\[package\][^[]*?\nversion = )"[^"]*"/),
  "engine-rs/Cargo.lock": blank(CRATE_LOCK),
  "engine-rs/consumer/Cargo.lock": blank(CRATE_LOCK),
  [COMPAT_RECORD_PATH]: (t) => JSON.stringify({ ...JSON.parse(t), crateVersion: null }),
};

/** What a release PR got wrong. */
export function checkRelease(base: Tree, head: Tree, changes: readonly Change[]): string[] {
  const errors: string[] = [];
  const { notes, errors: unreadable } = notesOf(base);
  errors.push(...unreadable);
  if (notes.length === 0 && unreadable.length === 0) errors.push("main has no pending notes, so there is nothing to release.");
  const left = head.notes();
  if (left.length > 0) errors.push(`a release consumes every pending note, and ${left.join(", ")} remain: merge main in and run \`npm run release\` again.`);
  const was = versionsOf(base);
  const now = versionsOf(head);
  checkBump(errors, "app", was.app, now.app, notes, (n) => n.app, true);
  checkBump(errors, "crate", was.crate, now.crate, notes, (n) => n.crate, false);
  const same = (key: keyof Versions, want: string) => {
    if (now[key] !== want) errors.push(`${key} is "${now[key]}" and should be "${want}".`);
  };
  same("package-lock.json version", now.app);
  same("package-lock.json root package version", now.app);
  same("engine-rs/Cargo.lock crate version", now.crate);
  same("engine-rs/consumer/Cargo.lock crate version", now.crate);
  same("compat record crateVersion", now.crate);
  if (now.app !== was.app && now["CHANGELOG.md sections"].split(", ")[0] !== now.app) errors.push(`CHANGELOG.md has no ${now.app} section at the top.`);
  if (now.crate !== was.crate && now["engine-rs/CHANGELOG.md sections"].split(", ")[0] !== now.crate) errors.push(`engine-rs/CHANGELOG.md has no ${now.crate} section at the top.`);
  const release = new Set<string>(RELEASE_FILES);
  for (const c of changes) {
    if (c.status === "D" && isNotePath(c.path)) continue;
    if (!release.has(c.path)) {
      errors.push(`${c.path} changed: a release PR changes only versions, changelogs and the notes it consumes.`);
      continue;
    }
    const strip = VERSION_FREE[c.path];
    if (strip === undefined) continue;
    const a = base.read(c.path);
    const b = head.read(c.path);
    if (a === null || b === null || strip(a.replace(/\r\n/g, "\n")) !== strip(b.replace(/\r\n/g, "\n")))
      errors.push(`${c.path} changed beyond its version: a release PR changes only the version there.`);
  }
  return errors;
}
