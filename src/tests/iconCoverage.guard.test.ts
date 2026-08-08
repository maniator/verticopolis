import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, relative } from "node:path";
import { EMOJI_ICONS, ICON_NAMES, ACCENT_FILLS, iconElement } from "../ui/icons";

/**
 * Bulletin icon coverage guard (issue #721).
 *
 * The engine stays DOM/render-free, so it keeps emitting emoji as plain text
 * tokens at the head of its bulletin and event messages (`🔥 Fire broke out`,
 * `🏅 Milestone: ...`). The UI render layer swaps each of those for an inline
 * pixel icon so nothing tofus on a system with no color-emoji font. That swap is
 * driven by `EMOJI_ICONS`, so every emoji the engine can emit into a message MUST
 * have an entry there: an unmapped one would render as tofu again, defeating the
 * whole change.
 *
 * This guard scans the message-source layers for the emoji they emit and asserts
 * each is mapped. If someone adds a new bulletin emoji without a mapping, this
 * fails with the exact codepoint to add.
 *
 * The scan covers ALL of `src` (issue #782). It started at `src/engine` plus
 * `src/game`, but the engine is not the only layer that puts player-facing text
 * on screen: `src/main.ts` raises toasts, and the render, ui, storage, platform,
 * and audio layers all reach the same rail. A mapped emoji written mid-message
 * from any of those files was caught by neither assertion below. Scanning the
 * whole tree means the guard does not have to be widened again the next time a
 * new layer starts talking to the player.
 *
 * Scope, stated honestly: this pins the emoji that appear as literal characters
 * in source, in code (comments are stripped first, so a note that mentions a
 * glyph does not force a mapping). An emoji assembled at runtime (from a code
 * point in a variable, say) would slip past, but the emitters write them as
 * literals today. Symbols that render as plain text are outside the scan by
 * definition (see {@link EMOJI_SCAN}), so no allow-list is needed for them. That
 * has a cost the guard does not cover: a text-presentation glyph sitting in a
 * surface that never runs the mapper is invisible here, which is how the bare
 * `⚠` in `src/ui/templates/editor.ts` went unnoticed (issue #794).
 */

const here = dirname(fileURLToPath(import.meta.url));
const srcRoot = resolve(here, "..");
const iconsPath = resolve(here, "..", "ui", "icons.ts");
/** `src/tests`, `src`-relative. Everything under it is test code, including the
 *  fixtures and helpers that are not named `*.test.ts`. */
const TEST_DIR = "tests";
/** A `tests/` directory at any depth, `src`-relative. `src/tests/` is the only
 *  one today, and matching deeper too means a future `src/ui/tests/helper.ts`
 *  reads as test code the day it lands instead of demanding an `EMOJI_ICONS`
 *  entry for a fixture glyph no player ever sees. The by-name `*.test.ts` rule
 *  is already location-agnostic; this matches it. */
const TEST_LOCATION = new RegExp(`(^|/)${TEST_DIR}/`);
/** The two roots this guard scanned before #782 widened it. The coverage check
 *  used to read their test files as well, so it keeps doing so through
 *  {@link legacyRootTests} even though tests are otherwise out of the scan.
 *  Nothing in the tree can yield this list (colocated tests live under seven
 *  top-level directories today), so it is a record of history and the test
 *  restates it to keep it from being trimmed. */
const LEGACY_ROOTS = ["engine", "game"];

/** Every character that is actually RENDERED as an emoji (and so tofus without a
 *  color-emoji font): either a default-emoji-presentation code point
 *  (`\p{Emoji_Presentation}`, the astral pictographs like 🔥 🏅), or an
 *  emoji-capable code point explicitly given emoji presentation with a VS16
 *  (`\p{Emoji}\uFE0F`, how the engine writes the text-default ones: ♻️ 🕵️ ⚠️).
 *  This is the Unicode "will display as emoji" definition, so it catches a
 *  future bulletin emoji in any block (a clock ⏰, U+23F0) while leaving
 *  plain-text symbols alone. Two different things keep those out. `©` (U+00A9),
 *  `™` (U+2122), `‼` (U+203C) and `⬅` (U+2B05) do carry `\p{Emoji}`, but the
 *  second branch wants a VS16 they never have. `★` (U+2605) carries no
 *  `\p{Emoji}` property at all, so neither branch can reach it: that is what
 *  keeps the topbar star rating (the most common glyph in `src`) out of the
 *  scan, before the VS16 rule even comes into it. The trailing VS16 is stripped
 *  in {@link messageEmoji} so the key matches EMOJI_ICONS.
 *
 *  Widening the first branch to bare `\p{Emoji}` would pick up the class issue
 *  #794 belongs to, and was rejected here: the property also covers the ASCII
 *  digits, `#` and `*`, so the scan would report every number literal in `src`.
 *  Catching a text-presentation glyph in a surface that never runs the mapper
 *  wants its own check; a looser character class here would not do it. */
const EMOJI_SCAN = /\p{Emoji_Presentation}|\p{Emoji}\uFE0F/gu;

/** The `src`-relative path used in a failure line, forward-slashed so the
 *  message reads the same on either OS. */
function where(file: string): string {
  return relative(srcRoot, file).replace(/\\/g, "/");
}

/** Whether a TypeScript file under `src` is treated as a message emitter.
 *
 *  `src/ui/icons.ts` is skipped because it IS the mapping table. Its
 *  `EMOJI_ICONS` keys are every mapped glyph written as a literal, so scanning
 *  it would only assert the table against itself, and the leading check would
 *  ride on how the object literal happens to be formatted. The comparison is
 *  against the resolved path both sides already share, so moving the module
 *  cannot leave a stale copy of its name behind here.
 *
 *  Test code is skipped because a test asserts ABOUT messages rather than
 *  emitting them: it stages tower names and DOM fixtures that hold emoji for
 *  reasons that have nothing to do with the bulletin rail (`storage`'s
 *  integration test names a tower `"✨✨"`). Skipping it by NAME alone would
 *  miss the support files that carry exactly those fixtures without the
 *  `.test.ts` suffix, so a `tests/` directory is skipped by LOCATION too (see
 *  {@link TEST_LOCATION}): hoisting that tower name into
 *  `tests/fixtures/towerFixtures.ts` must not start demanding an `EMOJI_ICONS`
 *  entry for it. Colocated tests (`src/engine/*.test.ts`) are still caught by
 *  the suffix. */
function isEmitterFile(abs: string, rel: string): boolean {
  if (abs === iconsPath) return false;
  if (rel.endsWith(".test.ts")) return false;
  if (TEST_LOCATION.test(rel)) return false;
  return true;
}

interface TsFile {
  readonly abs: string;
  readonly rel: string;
  /** False for the mapping table and for test code (see {@link isEmitterFile}).
   *  Excluded files stay in the list so the reach assertion can prove each
   *  exclusion applies to a file that really is there. */
  readonly emitter: boolean;
}

/** Every `.ts` file under `src`, declarations aside, tagged with whether the
 *  scan treats it as a message emitter. One walk for the whole run. */
function typescriptFiles(dir: string): TsFile[] {
  const out: TsFile[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      out.push(...typescriptFiles(abs));
      continue;
    }
    if (!entry.name.endsWith(".ts") || entry.name.endsWith(".d.ts")) continue;
    const rel = where(abs);
    out.push({ abs, rel, emitter: isEmitterFile(abs, rel) });
  }
  return out;
}

/** Strip block and line comments so an emoji mentioned in a comment (a note
 *  about a glyph, e.g. audioPrefs' "a stale speaker glyph") is not mistaken for
 *  one emitted into a message. Heuristic, not a parser: the line-comment rule
 *  keeps a `://` inside a URL, and message strings carry no comment delimiters. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/gm, "$1");
}

/** A scanned file: its `src`-relative path and its comment-stripped text. */
interface Source {
  readonly rel: string;
  readonly text: string;
}

function readStripped(file: TsFile): Source {
  return { rel: file.rel, text: stripComments(readFileSync(file.abs, "utf8")) };
}

/** The single walk, and the single read of each scanned file. Every assertion
 *  below reads THIS list, so pinning its reach (see the reach test) pins what
 *  the coverage and message-leading checks actually cover. Handing each
 *  consumer its own root argument would let a narrowing slip past a reach
 *  assertion that walks the tree for itself. */
const ALL_TS: readonly TsFile[] = typescriptFiles(srcRoot);
const SOURCES: readonly Source[] = ALL_TS.filter((f) => f.emitter).map(readStripped);

/** Every distinct emoji `files` emit as a source literal (comments stripped),
 *  mapped to the `src`-relative file it first appears in (for a legible
 *  failure). The captured glyph is the base code point, matching the
 *  base-codepoint keys of EMOJI_ICONS. */
function messageEmoji(files: readonly Source[] = SOURCES): Map<string, string> {
  const found = new Map<string, string>();
  for (const { rel, text } of files) {
    EMOJI_SCAN.lastIndex = 0;
    for (let m = EMOJI_SCAN.exec(text); m; m = EMOJI_SCAN.exec(text)) {
      const ch = m[0].replace(/️/g, ""); // drop the VS16 the \p{Emoji}️ branch captures
      if (!found.has(ch)) found.set(ch, rel);
    }
  }
  return found;
}

/** The emoji in `files` that `EMOJI_ICONS` does not map, each with its code
 *  point and the file it was first seen in. */
function unmappedEmoji(files: readonly Source[]): string[] {
  const out: string[] = [];
  for (const [ch, firstSeenIn] of messageEmoji(files)) {
    if (ch in EMOJI_ICONS) continue;
    const cp = "U+" + ch.codePointAt(0)!.toString(16).toUpperCase();
    out.push(`${ch} (${cp}) first in ${firstSeenIn}`);
  }
  return out;
}

/** The test files under ONE pre-#782 root, read on demand. They are out of
 *  {@link SOURCES} like all test code, and the coverage check used to reach
 *  them, so this keeps that ground rather than trusting a note that no engine
 *  or game test has ever carried an unmapped emoji. One root at a time so the
 *  caller can hold each to its own non-empty check; a single list over the union
 *  hides a root that has gone empty behind the other root's files. */
function legacyRootTests(root: string): Source[] {
  return ALL_TS.filter((f) => f.rel.endsWith(".test.ts") && f.rel.startsWith(`${root}/`)).map(
    readStripped,
  );
}

/** Occurrences of a MAPPED emoji that are not message-leading: the mapper only
 *  swaps a marker at the head of a message (whitespace tolerated), so an emoji
 *  written after any other prefix ("Day 5: 🔥...", a template interpolation)
 *  would render as plain text and tofu again (issue #743). A literal is
 *  "message-leading" when the text before it ends with a string delimiter,
 *  optionally followed by whitespace, so `"🔥 Fire..."` and a backtick template
 *  both pass while `"Day 5: 🔥..."` and `` `${day}: 🔥` `` fail.
 *
 *  Two deliberate narrowings, each closing a false positive a review probe
 *  demonstrated. Only emoji that {@link EMOJI_ICONS} actually maps are checked,
 *  because the scan matches each code point of a multi-codepoint sequence
 *  separately and a skin-tone or flag continuation is never delimiter-adjacent
 *  (`👋🏽` reported its modifier even at the head of its string). `/` and `[`
 *  count as delimiters alongside the quotes, so a regex literal or character
 *  class holding a marker (`text.split(/🔥/)`) is not read as a prefixed
 *  message. The third narrowing, skipping test code, now lives in
 *  {@link isEmitterFile} because both assertions want it.
 *
 *  Same honesty note as {@link messageEmoji}: this checks source literals, so a
 *  prefix concatenated at runtime from a separate string slips past, but the
 *  emitters build their messages as single literals today. */
function nonLeadingEmoji(): string[] {
  const out: string[] = [];
  for (const { rel, text } of SOURCES) {
    EMOJI_SCAN.lastIndex = 0;
    for (let m = EMOJI_SCAN.exec(text); m; m = EMOJI_SCAN.exec(text)) {
      const ch = m[0].replace(/️/g, "");
      if (!(ch in EMOJI_ICONS)) continue;
      if (/["'`/[]\s*$/.test(text.slice(0, m.index))) continue;
      // An excerpt, not an offset: the offset indexes the comment-stripped
      // text, so it cannot be used to find the line in the real file.
      const excerpt = text.slice(Math.max(0, m.index - 24), m.index + 8).replace(/\s+/g, " ");
      out.push(`${ch} in ${rel} (near "...${excerpt}...")`);
    }
  }
  return out;
}

/** An independent witness for the reach assertion: every file under `dir` shaped
 *  like a message emitter (a `.ts` that is neither a declaration nor a test),
 *  `src`-relative. Deliberately a second, simpler traversal. Deriving the
 *  expectation from {@link ALL_TS} would shrink alongside any narrowing of the
 *  shared walk and so could never catch one. Directory entries only, no file
 *  reads.
 *
 *  It ENUMERATES rather than answering "does this directory hold one?". The
 *  yes/no form could only see a narrowing that emptied a whole layer: dropping
 *  `src/main.ts`, the toast caller #782 was filed over, or all 22 files under
 *  `src/ui/templates/`, left every assertion green. Naming each file catches a
 *  narrowing at any granularity, including one scattered across layers (a
 *  `*.generated.ts` or `*Prefs.ts` skip added to the walk).
 *
 *  Its rules are a strict subset of the shared walk's: both skip `node_modules`
 *  and `.d.ts` and take only `.ts`, and this one drops `*.test.ts` on top. So
 *  every file it names must be in {@link ALL_TS}, and a gap is a real narrowing
 *  rather than a difference of opinion between the two traversals. */
function emitterShapedFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      out.push(...emitterShapedFiles(abs));
      continue;
    }
    if (!entry.name.endsWith(".ts") || entry.name.endsWith(".d.ts")) continue;
    if (entry.name.endsWith(".test.ts")) continue;
    out.push(where(abs));
  }
  return out;
}

describe("bulletin icon coverage (issue #721)", () => {
  it("maps every emoji the message layers emit", () => {
    const unmapped = unmappedEmoji(SOURCES);
    expect(
      unmapped,
      `These bulletin emoji have no EMOJI_ICONS entry and would render as ` +
        `tofu. Add each to EMOJI_ICONS in src/ui/icons.ts: ${unmapped.join(", ")}`,
    ).toEqual([]);
  });

  it("still covers the test files the pre-#782 scan reached", () => {
    // Widening the roots also moved the "skip test files" rule into the shared
    // walk, which would have QUIETLY NARROWED this half: an unmapped emoji added
    // to a src/engine test used to fail CI. Nothing but this assertion would
    // keep that ground. It is scoped to the two old roots because that is
    // exactly what was covered before; test code elsewhere stages fixtures
    // (a "✨✨" tower name) that were never in reach and should not be.
    //
    // Two halves, because two different edits can hand that ground back. The
    // list is a record of history the tree cannot yield, so trimming it to
    // ["engine"] would drop 37 game test files with every other assertion still
    // green: restating it here means a rename has to touch both spellings, which
    // is the friction this pin exists for.
    expect(
      [...LEGACY_ROOTS].sort(),
      "LEGACY_ROOTS no longer names both roots the pre-#782 scan walked, so this check " +
        "covers less than it did; restore the missing root or retire the pin deliberately",
    ).toEqual(["engine", "game"]);
    // The other half is per ROOT rather than over the union. A union count stays
    // positive while one root goes stale, so renaming src/game would leave this
    // reading engine alone, 29 files, still passing, and 37 files out of reach.
    const legacy: Source[] = [];
    for (const root of LEGACY_ROOTS) {
      const rootTests = legacyRootTests(root);
      expect(
        rootTests.length,
        `no test file was found under src/${root}/, so this check reads nothing from that ` +
          `root; point LEGACY_ROOTS at wherever it moved`,
      ).toBeGreaterThan(0);
      legacy.push(...rootTests);
    }
    const unmapped = unmappedEmoji(legacy);
    expect(
      unmapped,
      `These emoji sit in an engine or game test with no EMOJI_ICONS entry. ` +
        `The pre-#782 guard failed on them and this one still does: map each in ` +
        `src/ui/icons.ts, or move the fixture out of the emitter's own test: ${unmapped.join(", ")}`,
    ).toEqual([]);
  });

  it("keeps every emitted bulletin emoji message-leading (issue #743)", () => {
    // The render mapper swaps only the marker at the head of a message, so an
    // emoji the message layers emit anywhere else would stay literal text and
    // tofu on a no-emoji-font system with no error. Pin the emitter half of
    // that contract: every emoji literal must sit at the start of its string.
    const violations = nonLeadingEmoji();
    expect(
      violations,
      `These bulletin emoji are not message-leading, so the icon mapper would ` +
        `leave them as tofu-prone text. Move each marker to the start of its ` +
        `message string: ${violations.join(", ")}`,
    ).toEqual([]);
  });

  it("has a non-empty scan (the guard is wired to real content)", () => {
    // If the scan finds nothing, the assertion above passes vacuously. The
    // engine emits at least the fire/money/milestone bulletins, so a zero here
    // means the scan or the message path broke, not that coverage is complete.
    expect(messageEmoji().size).toBeGreaterThan(0);
  });

  it("reaches past the engine into every other message layer (issue #782)", () => {
    // The scan used to stop at `src/engine` and `src/game`, which let a toast
    // raised from `src/main.ts` or anywhere in the UI layer carry an unmapped or
    // mid-message emoji unchallenged. Pin the reach of SOURCES itself, the list
    // every assertion above reads, since a narrowing that left those assertions
    // green would silently stop covering the layers that regressed.
    //
    // Every expectation here is derived from the tree, so a rename, a split, or
    // a new layer moves it automatically and only a real narrowing fails it.
    const iconsRel = where(iconsPath);
    expect(iconsRel, "srcRoot no longer resolves to src/").toBe("ui/icons.ts");

    // The witness names every emitter-shaped file it can see, file by file. An
    // earlier form asked each top-level directory "do you hold one?", which only
    // ever noticed a narrowing that emptied a whole layer: losing src/main.ts by
    // itself, or all of src/ui/templates/, read as fine.
    const witness = emitterShapedFiles(srcRoot);
    expect(witness.length, "the witness traversal found no TypeScript under src/ at all").toBeGreaterThan(
      0,
    );
    const walked = new Set(ALL_TS.map((f) => f.rel));
    expect(
      witness.filter((r) => !walked.has(r)),
      "the shared walk skips TypeScript the witness can see; a file the walk never " +
        "visits is a file no assertion in this guard covers",
    ).toEqual([]);

    // Reaching a file is not scanning it, so hold SOURCES to the same list less
    // the exclusions this guard declares out loud. Those two stay honest through
    // the by-name, by-location, and icons-module checks below, which prove each
    // applies to a file that is really on disk.
    const scanned = new Set(SOURCES.map((s) => s.rel));
    expect(
      witness.filter((r) => !scanned.has(r) && r !== iconsRel && !TEST_LOCATION.test(r)),
      "these files hold message-layer TypeScript the scan never reads; either they are " +
        "in reach of the guard or the exclusion that drops them belongs in isEmitterFile",
    ).toEqual([]);

    // The location exclusion is the one exception the guard reads from the same
    // constant the scan does, so widening TEST_LOCATION would widen the excuse
    // and the exclusion together and quietly shrink the scan (GH #795: adding
    // `templates` to the pattern dropped 22 files with the suite still green).
    // Hold every file it excuses to a real path segment named TEST_DIR, which
    // rejects a widening to any non-test directory while still allowing a
    // genuine nested test directory such as src/ui/tests/.
    expect(
      witness.filter((r) => TEST_LOCATION.test(r) && !r.split("/").includes(TEST_DIR)),
      `TEST_LOCATION excuses a file that sits in no directory named ${TEST_DIR}; the pattern ` +
        `has been widened past test code, so the scan is dropping files this guard no longer sees`,
    ).toEqual([]);

    // Each exclusion has to apply to a file that is really there, or it would
    // hold trivially: an absent path is absent from any list.
    const icons = ALL_TS.find((f) => f.abs === iconsPath);
    expect(icons, "src/ui/icons.ts is not on disk where the exclusion looks for it").toBeDefined();
    expect(icons?.emitter, "the mapping table is not an emitter").toBe(false);
    const byName = ALL_TS.filter((f) => f.rel.endsWith(".test.ts"));
    const byLocation = ALL_TS.filter((f) => f.rel.startsWith(`${TEST_DIR}/`));
    expect(byName.length, "the walk found no *.test.ts file at all").toBeGreaterThan(0);
    expect(
      byLocation.length,
      `the walk found nothing under src/${TEST_DIR}/; if the test support directory moved, ` +
        `point TEST_DIR at its new home or its fixtures will start demanding icon mappings`,
    ).toBeGreaterThan(0);
    expect(
      [...byName, ...byLocation].filter((f) => f.emitter).map((f) => f.rel),
      "test code is not an emitter",
    ).toEqual([]);
  });

  it("keeps every bulletin icon currentColor-only (so severity color carries)", () => {
    // A bulletin icon inherits its log line's severity color (red for bad, green
    // for money) purely through `fill="currentColor"`. A baked fill on one of
    // its paths would freeze it off-color, so pin that no EMOJI_ICONS target
    // bakes a fill and each still declares currentColor on the <svg>.
    for (const name of new Set(Object.values(EMOJI_ICONS))) {
      const svg = iconElement(name);
      expect(svg.getAttribute("fill"), `${name} lost its currentColor root`).toBe("currentColor");
      for (const p of svg.querySelectorAll("path")) {
        expect(p.getAttribute("fill"), `${name} bakes a path fill; a bulletin icon must inherit severity color`).toBeNull();
      }
    }
  });

  it("allows an accent fill only on an allowlisted accent icon, only from the hazard palette", () => {
    // Nearly all icons are currentColor; the bulldoze wrecking ball is the one
    // exception, a two-tone red/amber glyph. Pin the exception TIGHT: only an
    // icon named in ACCENT_ICONS may bake a fill at all, and only from the
    // ACCENT_FILLS palette. Every other icon (bulletin AND chrome) must inherit
    // currentColor, so a stray `fill: "#ff6b6b"` on, say, the save glyph fails
    // here instead of silently freezing it red. The generated pixelarticons
    // paths never bake a fill at all.
    const ACCENT_ICONS = new Set<string>(["bulldoze"]);
    const allow = new Set<string>(ACCENT_FILLS);
    for (const name of ICON_NAMES) {
      for (const p of iconElement(name).querySelectorAll("path")) {
        const fill = p.getAttribute("fill");
        if (!fill) continue;
        expect(ACCENT_ICONS.has(name), `${name} bakes a fill but is not an allowlisted accent icon; it must inherit currentColor`).toBe(true);
        expect(allow.has(fill), `${name} uses a non-allowlisted fill ${fill}`).toBe(true);
      }
    }
    const generatedPath = resolve(here, "..", "ui", "iconPaths.generated.ts");
    const hexRe = /fill\s*[:=]\s*["'`]?#[0-9a-fA-F]{3,8}/g;
    const generatedFills = readFileSync(generatedPath, "utf8").match(hexRe) ?? [];
    expect(generatedFills, `generated pixelarticons paths must stay currentColor-only`).toEqual([]);
    expect(readFileSync(iconsPath, "utf8")).toContain('fill="currentColor"');
  });

  it("carries its MIT provenance", () => {
    // The vendored paths are from Pixelarticons (MIT); the attribution ships in
    // the icon module header and the generated file it draws from.
    const iconsSrc = readFileSync(iconsPath, "utf8");
    expect(iconsSrc).toMatch(/Pixelarticons/i);
    expect(iconsSrc).toMatch(/MIT/);
    expect(readFileSync(resolve(here, "..", "ui", "iconPaths.generated.ts"), "utf8")).toMatch(/pixelarticons.*MIT|MIT.*pixelarticons/is);
  });
});
