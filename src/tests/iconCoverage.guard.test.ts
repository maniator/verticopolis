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
 * literals today. Text-default symbols (`★` U+2605, `©` `™`, the emoji-arrows)
 * are deliberately excluded by the scan definition below, so no allow-list is
 * needed for them.
 */

const here = dirname(fileURLToPath(import.meta.url));
const srcRoot = resolve(here, "..");
const iconsPath = resolve(here, "..", "ui", "icons.ts");
/** `src`-relative, forward-slashed, so a path comparison behaves the same on
 *  Windows and on CI's Linux. */
const ICON_MODULE = "ui/icons.ts";

/** Every character that is actually RENDERED as an emoji (and so tofus without a
 *  color-emoji font): either a default-emoji-presentation code point
 *  (`\p{Emoji_Presentation}`, the astral pictographs like 🔥 🏅), or an
 *  emoji-capable code point explicitly given emoji presentation with a VS16
 *  (`\p{Emoji}\uFE0F`, how the engine writes the text-default ones: ♻️ 🕵️ ⚠️).
 *  This is the Unicode "will display as emoji" definition, so it catches a
 *  future bulletin emoji in any block (a clock ⏰, U+23F0) while leaving
 *  text-default symbols (★, ©, ™, ‼, the arrows) alone: those are `\p{Emoji}`
 *  but, without a VS16, render as plain text and never tofu. The trailing VS16
 *  is stripped in {@link messageEmoji} so the key matches EMOJI_ICONS. */
const EMOJI_SCAN = /\p{Emoji_Presentation}|\p{Emoji}\uFE0F/gu;

/** The `src`-relative path used in a failure line, forward-slashed so the
 *  message reads the same on either OS. */
function where(file: string): string {
  return relative(srcRoot, file).replace(/\\/g, "/");
}

/** Every file the guard treats as a message emitter: all TypeScript under `src`,
 *  minus the two kinds of file that do not emit messages.
 *
 *  `src/ui/icons.ts` is skipped because it IS the mapping table. Its
 *  `EMOJI_ICONS` keys are every mapped glyph written as a literal, so scanning
 *  it would only assert the table against itself, and the leading check would
 *  ride on how the object literal happens to be formatted.
 *
 *  `*.test.ts` files are skipped because a test asserts ABOUT messages rather
 *  than emitting them: it stages tower names and DOM fixtures that hold emoji
 *  for reasons that have nothing to do with the bulletin rail. This was already
 *  the rule for the message-leading check (issue #743); widening the scan to the
 *  whole tree extends it to the coverage check too, which costs nothing under
 *  the original roots (no `src/engine` or `src/game` test carries an emoji its
 *  own emitter does not). */
function scannedFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      out.push(...scannedFiles(full));
      continue;
    }
    if (!entry.name.endsWith(".ts") || entry.name.endsWith(".d.ts")) continue;
    if (entry.name.endsWith(".test.ts")) continue;
    if (where(full) === ICON_MODULE) continue;
    out.push(full);
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

/** Every distinct emoji the message layers emit as a source literal (comments
 *  stripped), mapped to the `src`-relative file it first appears in (for a
 *  legible failure). The captured glyph is the base code point, matching the
 *  base-codepoint keys of EMOJI_ICONS. */
function messageEmoji(): Map<string, string> {
  const found = new Map<string, string>();
  for (const file of scannedFiles(srcRoot)) {
    const text = stripComments(readFileSync(file, "utf8"));
    EMOJI_SCAN.lastIndex = 0;
    for (let m = EMOJI_SCAN.exec(text); m; m = EMOJI_SCAN.exec(text)) {
      const ch = m[0].replace(/️/g, ""); // drop the VS16 the \p{Emoji}️ branch captures
      if (!found.has(ch)) found.set(ch, where(file));
    }
  }
  return found;
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
 *  message. The third narrowing, skipping test files, now lives in
 *  {@link scannedFiles} because both assertions want it.
 *
 *  Same honesty note as {@link messageEmoji}: this checks source literals, so a
 *  prefix concatenated at runtime from a separate string slips past, but the
 *  emitters build their messages as single literals today. */
function nonLeadingEmoji(): string[] {
  const out: string[] = [];
  for (const file of scannedFiles(srcRoot)) {
    const text = stripComments(readFileSync(file, "utf8"));
    EMOJI_SCAN.lastIndex = 0;
    for (let m = EMOJI_SCAN.exec(text); m; m = EMOJI_SCAN.exec(text)) {
      const ch = m[0].replace(/️/g, "");
      if (!(ch in EMOJI_ICONS)) continue;
      if (/["'`/[]\s*$/.test(text.slice(0, m.index))) continue;
      // An excerpt, not an offset: the offset indexes the comment-stripped
      // text, so it cannot be used to find the line in the real file.
      const excerpt = text.slice(Math.max(0, m.index - 24), m.index + 8).replace(/\s+/g, " ");
      out.push(`${ch} in ${where(file)} (near "...${excerpt}...")`);
    }
  }
  return out;
}

describe("bulletin icon coverage (issue #721)", () => {
  it("maps every emoji the message layers emit", () => {
    const unmapped: string[] = [];
    for (const [ch, firstSeenIn] of messageEmoji()) {
      if (!(ch in EMOJI_ICONS)) {
        const cp = "U+" + ch.codePointAt(0)!.toString(16).toUpperCase();
        unmapped.push(`${ch} (${cp}) first in ${firstSeenIn}`);
      }
    }
    expect(
      unmapped,
      `These bulletin emoji have no EMOJI_ICONS entry and would render as ` +
        `tofu. Add each to EMOJI_ICONS in src/ui/icons.ts: ${unmapped.join(", ")}`,
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
    // mid-message emoji unchallenged. Pin the reach itself, since a narrowing
    // back to the old roots would leave both assertions above still green and
    // silently stop covering the layers that regressed.
    const scanned = new Set(scannedFiles(srcRoot).map(where));
    // `main.ts` by name: it is the toast caller the issue was filed over.
    expect(scanned.has("main.ts"), "main.ts is not in the icon guard's scan").toBe(true);
    // The rest by layer, so a file rename inside a layer does not fail this.
    const layers = new Set([...scanned].map((f) => (f.includes("/") ? f.slice(0, f.indexOf("/")) : "")));
    for (const layer of ["engine", "game", "ui", "render", "storage", "platform", "audio"]) {
      expect(layers.has(layer), `src/${layer} is not in the icon guard's scan`).toBe(true);
    }
    // The mapping table is not an emitter, and neither is a test.
    expect(scanned.has(ICON_MODULE)).toBe(false);
    expect([...scanned].filter((f) => f.endsWith(".test.ts"))).toEqual([]);
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
