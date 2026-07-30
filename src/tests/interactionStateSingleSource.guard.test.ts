import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, relative } from "node:path";

/**
 * Source-text ownership guard for interaction state (issue #716).
 *
 * "Can the player interact right now" is answered from five sources
 * (`shownChoice`, `shownUpdate`, `#modal.open`, `#splash`, `#crash-screen`) plus
 * the editor-busy predicate. Before the consolidation those reads were scattered
 * across a dozen files, and PR #715's review found two of them disagreeing in one
 * state. This guard pins the fix: every READ lives in exactly one module,
 * `src/game/interactionState.ts`, so a consumer cannot answer the question its own
 * way. It is the acceptance gate the consolidation drove to green (AD-1, AD-7,
 * Verification).
 *
 * Two kinds of file are allow-listed per source, because AD-8 keeps them where
 * they are:
 *  - element OWNERS: `UI` builds the `#modal` ref, `crashScreen` creates
 *    `#crash-screen`. They hold their own element; the module reads its state.
 *  - flag WRITERS: `frameLoop` sets `shownChoice`, `updateFlow` sets
 *    `shownUpdate`. The flag-read regex excludes assignments, so writers pass
 *    without an allow-list; the module is the only place the flags are READ.
 *
 * Scope, stated honestly: this is a source-text pin on the literal read
 * spellings the codebase actually uses (a `getElementById` string literal, a
 * `.shownChoice` property read, a `.isEditorBusy()` / `.isModalOpen()` call). It
 * is a lint-level backstop against re-scattering, not a proof. Exotic forms that
 * no reader uses today (a destructured `const { shownChoice } = app`, a
 * `getElementById(someVar)` with the id in a variable, a `querySelector('#splash')`
 * state read) would slip past and are left to human review. The two extra pins
 * below (`isModalOpen`, `lastAvailabilityKey`) close the two most reachable of
 * those gaps.
 */

const here = dirname(fileURLToPath(import.meta.url));
const srcRoot = resolve(here, "..");
const MODULE = "game/interactionState.ts";

/** Production TypeScript only. Tests and fixtures set these states on purpose
 *  (a test that mounts a splash to prove a guard refuses is not a scattered
 *  reader), and `src/tests/` is all test scaffolding. */
function productionFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "tests") continue;
      out.push(...productionFiles(full));
    } else if (
      entry.name.endsWith(".ts") &&
      !entry.name.endsWith(".test.ts") &&
      !entry.name.endsWith(".fixture.ts") &&
      !entry.name.endsWith(".d.ts")
    ) {
      out.push(full);
    }
  }
  return out;
}

interface Source {
  what: string;
  /** Matches a READ of the source in file text. */
  re: RegExp;
  /** Files, besides the module, allowed to contain the match: element owners. */
  allow: string[];
}

const SOURCES: Source[] = [
  {
    what: 'the splash element — getElementById("splash")',
    re: /getElementById\("splash"\)/,
    allow: [],
  },
  {
    what: 'the modal element — getElementById("modal")',
    re: /getElementById\("modal"\)/,
    allow: ["ui/UI.ts"], // UI owns the shared <dialog> element and its cached ref
  },
  {
    what: "the crash screen — getElementById(CRASH_SCREEN_ID)",
    re: /getElementById\(CRASH_SCREEN_ID\)/,
    allow: ["ui/crashScreen.ts"], // crashScreen creates the card and guards double-create
  },
  {
    what: "the editor-busy predicate — .isEditorBusy()",
    re: /\.isEditorBusy\(\)/,
    allow: [], // UI DEFINES `isEditorBusy(): boolean` (no leading dot), so it is not a match
  },
  {
    // A READ is `.shownChoice`/`.shownUpdate` not used as an assignment target.
    // `= x` (a write, which frameLoop/updateFlow keep) is excluded; `== x`,
    // `|| x`, `)` (reads) are not. So the writers pass without an allow-list and
    // the module is the only place the flags are read.
    what: "the sim-freeze flags read — .shownChoice / .shownUpdate",
    re: /\.shown(?:Choice|Update)\b(?!\s*=(?!=))/,
    allow: [],
  },
];

/** Extra pins beyond the five sources, and the content they must stay wired to.
 *  `mustAppearIn` is the file whose text has to still contain the pattern, so a
 *  rename cannot make the pin match zero files and pass vacuously. */
const IS_MODAL_OPEN_CALL = /\.isModalOpen\(\)/;
const LAST_AVAIL_KEY_STATE = /\blastAvailabilityKey\s*[:=]/;

describe("interaction-state single source (issue #716)", () => {
  const files = productionFiles(srcRoot);

  for (const source of SOURCES) {
    it(`only ${MODULE} reads ${source.what}`, () => {
      const allowed = new Set([MODULE, ...source.allow]);
      const offenders = files
        .filter((f) => source.re.test(readFileSync(f, "utf8")))
        .map((f) => relative(srcRoot, f).replace(/\\/g, "/"))
        .filter((rel) => !allowed.has(rel));
      expect(
        offenders,
        `Only ${MODULE} may read ${source.what}. Route these through the module ` +
          `(isCrashed / isSplashUp / isDialogOpen / hasBlockingModal / isEditorBusy): ${offenders.join(", ")}`,
      ).toEqual([]);
    });
  }

  it("only UI (owner) and uiDialogs (modal precedence) call ui.isModalOpen()", () => {
    // `#modal.open` has a pre-existing owner accessor, `UI.isModalOpen()`. The
    // module reads `#modal` directly for the availability question; `isModalOpen`
    // stays for UI-internal modal-stacking precedence (`uiDialogs`). Pin its
    // callers so a NEW consumer cannot gate "can the player interact" on
    // `ui.isModalOpen()` and answer the question its own way, evading the module.
    // The module names `UI.isModalOpen()` in a doc comment (explaining why it
    // reads `#modal` directly instead), so it is allowed alongside the two real
    // callers; the regex cannot tell a prose mention from a call.
    const allowed = new Set([MODULE, "ui/UI.ts", "ui/uiDialogs.ts"]);
    const offenders = files
      .filter((f) => IS_MODAL_OPEN_CALL.test(readFileSync(f, "utf8")))
      .map((f) => relative(srcRoot, f).replace(/\\/g, "/"))
      .filter((rel) => !allowed.has(rel));
    expect(
      offenders,
      `ui.isModalOpen() is a UI-internal modal-precedence accessor. For "can the player interact", ` +
        `use ${MODULE}'s isDialogOpen(). New callers: ${offenders.join(", ")}`,
    ).toEqual([]);
  });

  it(`only ${MODULE} owns lastAvailabilityKey state`, () => {
    // AD-3: the availability dirty-gate moved here from hostCommands. Pin the
    // STATE (a declaration or assignment), not bare mentions, so a comment
    // elsewhere referencing the name is fine but a second module holding its own
    // copy is not. Matches `lastAvailabilityKey:` (typed decl) and
    // `lastAvailabilityKey =` (assignment); a comment has neither.
    const offenders = files
      .filter((f) => LAST_AVAIL_KEY_STATE.test(readFileSync(f, "utf8")))
      .map((f) => relative(srcRoot, f).replace(/\\/g, "/"))
      .filter((rel) => rel !== MODULE);
    expect(
      offenders,
      `The availability dirty-gate lives only in ${MODULE} (AD-3). Offenders: ${offenders.join(", ")}`,
    ).toEqual([]);
  });

  it("the module actually reads every source (guard wired to real content)", () => {
    const module = readFileSync(resolve(srcRoot, MODULE), "utf8");
    const missing = SOURCES.filter((s) => !s.re.test(module)).map((s) => s.what);
    expect(
      missing,
      `${MODULE} should read every source, or the guard above is pinning a dead pattern. Missing: ${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("the extra pins are wired to real content (so a rename can't vacate them)", () => {
    // Without this, renaming `lastAvailabilityKey` (or removing every
    // `isModalOpen` call) would make the pin match zero files and pass while
    // silently enforcing nothing. Assert each pinned pattern still exists where
    // it is supposed to: `lastAvailabilityKey` state in the module, an
    // `isModalOpen` call in an allowed caller.
    const module = readFileSync(resolve(srcRoot, MODULE), "utf8");
    expect(
      LAST_AVAIL_KEY_STATE.test(module),
      `${MODULE} no longer declares lastAvailabilityKey; the ownership pin is now vacuous. Rename the pin to match.`,
    ).toBe(true);
    const anyModalCaller = files.some((f) => IS_MODAL_OPEN_CALL.test(readFileSync(f, "utf8")));
    expect(
      anyModalCaller,
      "No file calls ui.isModalOpen() anymore; the caller pin is now vacuous (harmless, but update it).",
    ).toBe(true);
  });
});
