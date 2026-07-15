---
baseline_commit: 8c7627c2935098ebfb2c84ed9b741c02aa9d1ead
---

# Story: Settings modal + Game panel cleanup

Status: done (merged 2026-07-12 via PR #187, merge ff0d23b)

Grounds: owner request 2026-07-12 ("instead of import export buttons on the
page, add a settings modal; import export should live in the saves modal"),
shaped by the party-mode session recorded in
`_bmad-output/party-mode/memories/installed/.memlog.md` (entry 88). Follows
`story-volume-settings.md` on the same branch/PR.

## Story

As **a Verticopolis player**,
I want **a Settings dialog where the game's options live, and a Game panel
that is not cluttered with duplicate Export/Import buttons**,
so that **I can find volume and accessibility options where every game puts
them, and file import/export sits with the saves it operates on**.

## Party decisions (binding)

1. The Game panel's Export/Import row is removed. The Saves modal footer
   already hosts "Export to file" / "Import from file" (wired to the same
   `confirmExport()` / `openImport()` flows); it becomes the only entry point.
2. The freed row becomes one full-width **⚙️ Settings** button
   (`id="btn-settings"`).
3. The Settings modal hosts: the Sound section (Music + Effects sliders,
   moved verbatim from Help), the Reduced motion toggle, and the Steady clock
   toggle (both moved out of Help's footer).
4. Help keeps: how-to-play copy, Keyboard play, "Found a bug?", About, and
   the footer buttons Replay Getting Started + Got it.
5. Mute stays in the top bar (panic button); the Sound copy keeps pointing
   at it.
6. `colorblindCue` (a Prefs field with no UI today) is NOT exposed here;
   record a backlog row instead.
7. Title is "Settings" (not the 1994 "Options"); the button label carries the
   gear glyph.

## Context (current code, read before coding)

- `src/index.html` Game panel (~lines 101-115): three `btn-row` divs of two
  buttons each: [Quick Save][Saves…], [Export][Import], [New Tower][Help].
  The stats panel above shows the full-width pattern: `class="wide-btn btn"`
  (`#btn-stats`).
- `src/ui/UI.ts` `wireControls` (~line 219): `btn-export`/`btn-import` are
  looked up with non-null `!` assertions; removing the markup without
  removing these two listeners crashes the UI constructor. `btn-help` opens
  `this.showHelp()` internally with no callback; `btn-settings` should do
  the same with a new `showSettings()`.
- `src/ui/UI.ts` `showHelp` (~lines 1030-1130): hosts the Sound section
  (`.vol-row` sliders wired by the local `wireVolume` helper), the
  reduce-motion and steady-clock footer buttons with their label closures and
  the `osForced` matchMedia read, plus replay-onboard wiring. The slider and
  toggle wiring moves to `showSettings`; the label/`aria-pressed` logic moves
  with it unchanged.
- `src/ui/UI.ts` `showSaves` (~line 334): footer already has
  `data-act="export"` / `data-act="import"` that close the saves dialog and
  call `confirmExport()` / `openImport()`. No behavior change needed there.
- Callbacks: everything Settings needs already exists in `UICallbacks`
  (`getVolumes`, `onSetVolume`, `onToggleReducedMotion`,
  `onToggleSteadyClock`, `isSteadyClock`, `isMuted`). No new members, no
  `main.ts` changes expected.
- Tests, `src/tests/uiDialogs.test.ts`:
  - `mountAppDom` (~line 61) mirrors the app DOM and includes
    `btn-export`/`btn-import`; it must drop them and gain `btn-settings`.
  - Export/import dialog tests (~lines 441-542) enter via
    `btn-export`/`btn-import` clicks; re-enter via the real path instead:
    `ui.showSaves([])` then click `[data-act="export"]` / `"import"` in the
    dialog (the handler closes the saves modal first, then opens the
    confirm/import dialog; assert on the dialog that replaces it).
  - Help footer guard (~line 810) pins
    `["reduce-motion", "steady-clock", "replay-onboard", "close"]`; re-pin
    deliberately to `["replay-onboard", "close"]`, and add the equivalent
    pinned footer for Settings (`["close"]` plus whatever the dialog ends
    with; keep it exact).
  - Steady-clock and reduced-motion toggle tests (~lines 820-860) and the
    Sound sliders describe (~line 1163) currently drive `ui.showHelp()`;
    they move to `ui.showSettings()` with assertions otherwise unchanged.
  - The file-level matchMedia stub (line 44) exists for `showHelp`'s
    `osForced` read; the read moves to `showSettings`, stub stays valid.
- Screenshots: `scripts/screenshot-scenes.ts` first-run scene has the
  `02-help` shot (opens via `btn-help`). Add a sibling `02b-settings` shot
  (open via `btn-settings`, `keepDialogs: true`, same waitForSelector
  pattern). `docs/screenshots/02-help.png` changes (Sound section leaves)
  and `02b-settings.png` is new; both regenerate ONLY via the
  `[update-screenshots]` marker push (pinned container). Local captures are
  preview only.
- Design system (`docs/design-system.md`): tokens/components only, no skin
  on IDs, one primary per dialog. The Settings dialog reuses `.vol-row`,
  `.btn`, `.modal-actions`; no new CSS expected.

## Acceptance Criteria

1. **Game panel.** `#btn-export` and `#btn-import` are gone from
   `src/index.html` and from `wireControls`. The Game panel shows three
   rows: [Quick Save][Saves…], [⚙️ Settings] (full-width, `wide-btn btn`,
   `id="btn-settings"`), [New Tower][Help].
2. **Settings modal.** Clicking Settings opens a dialog titled "Settings"
   containing, in order: the Sound section (copy + Music/Effects sliders
   with live percent readouts, identical behavior and markup contract to
   today's, including ids `vol-music`/`vol-sfx` and `data-vol-val`
   readouts), then the Reduced motion and Steady clock toggle buttons with
   their existing label/`aria-pressed`/`osForced` behavior, then a footer
   with a single primary Close button.
3. **Help modal slims.** Help no longer contains the Sound section or the
   reduce-motion/steady-clock buttons; its footer is exactly Replay Getting
   Started + Got it. Everything else in Help is unchanged.
4. **Saves modal is the import/export home.** Its footer behavior is
   unchanged and remains the only UI path to `confirmExport()` /
   `openImport()`. Both flows still work end to end from there (tests drive
   this path).
5. **No engine/persistence changes.** No new `UICallbacks` members, no
   `main.ts`, `Prefs`, audio, or `src/engine/` changes. Slider moves keep
   persisting exactly as before (via the existing `onSetVolume` path).
6. **Accessibility parity.** Labels stay attached to the sliders, toggles
   keep `aria-pressed`, the dialog close affordances are unchanged, and the
   OS-forced reduced-motion state still disables that toggle with the
   "(system)" suffix.
7. **Tests.** `uiDialogs.test.ts` updated per Context: fixture, relocated
   toggle + slider suites (driving `showSettings`), re-pinned Help footer,
   new pinned Settings footer, export/import tests entering via the Saves
   modal, and a wireControls test that `btn-settings` opens the Settings
   dialog. All existing assertions that are not entry-point-related stay
   byte-identical.
8. **Screenshots.** `scripts/screenshot-scenes.ts` gains the `02b-settings`
   shot; regeneration happens via the `[update-screenshots]` marker push.
9. **Version bump.** Minor: 1.19.0 to 1.20.0 (player-facing chrome
   capability).
10. **Quality gates.** typecheck, lint, test, build all green.
11. **Backlog.** A row/inbox note records the deferred `colorblindCue`
    exposure (pre-existing pref with no UI; natural future Settings row).

## Tasks / Subtasks

- [x] Tests first (RED): update `mountAppDom`, relocate/re-pin suites, add
      `btn-settings` wireControls test and Settings footer pin, move
      export/import entry to the Saves modal path. (AC: 1-4, 6, 7)
- [x] `src/index.html`: remove Export/Import row, add full-width Settings
      button. (AC: 1)
- [x] `src/ui/UI.ts`: drop the two dead listeners; add `showSettings()`
      (Sound section + toggles + footer) and move the slider/toggle wiring
      out of `showHelp`; wire `btn-settings`. (AC: 1-3, 5, 6)
- [x] `scripts/screenshot-scenes.ts`: add `02b-settings` shot. (AC: 8)
- [x] `package.json`: 1.19.0 to 1.20.0. (AC: 9)
- [x] Backlog row for `colorblindCue` exposure. (AC: 11)
- [x] Quality gates, then `/bmad-code-review` in the same session (pure UI
      plumbing; no engine/gameplay surface, so gds is not required this
      time). (AC: 10)
- [ ] Push with `[update-screenshots]` marker; update PR #187 body.

## Dev Notes

- **Order inside `showHelp` teardown matters:** `wireVolume`, the
  steady-clock/reduce-motion closures, and their `[data-act]` buttons must
  move as one unit; the replay-onboard wiring and the native-wrapper report
  link routing stay in `showHelp` untouched.
- **`showSettings` mirrors `showHelp`'s shape:** `openModal` template +
  wiring after; reuse `wireActions(box)` for close. One primary button
  (Close) per the design system.
- **Do not rename `vol-music`/`vol-sfx`/`data-vol-val`:** the volume tests
  and any player muscle memory in the DOM contract stay stable; only the
  hosting dialog changes.
- **The saves-modal path in tests:** `showSaves` closes itself before
  opening export/import dialogs, so after clicking `[data-act="export"]`
  assert on the newly opened confirm dialog exactly as the old tests did
  after `btn-export.click()`; `showSaves([])` renders fine with zero slots.
- **No em-dashes in any new prose.** American English. Keep copy plain
  ("Settings", "Music", "Effects"; reuse existing toggle labels verbatim).
- **Do not touch** `src/main.ts`, `src/storage/`, `src/audio/`,
  `src/engine/`. If an edit there seems needed, stop and re-read; it isn't.

## Change Log

- 2026-07-12: story created (bmad-create-story) from the party-mode
  decisions; grounded in code reads of index.html, UI.ts (wireControls,
  showHelp, showSaves), uiDialogs.test.ts, screenshot-scenes.ts.

## Dev Agent Record

### Debug Log

- RED: removing btn-export/btn-import from the test fixture crashed the UI
  constructor for all 92 uiDialogs tests (the exact non-null-assertion trap
  the story flagged); GREEN restored 91/92, with the one real failure being
  the Settings title assertion (openModal appends its close glyph inside the
  h2; assertion loosened to contain).
- Full suite 1111 green; typecheck/lint/build green; no em-dashes in added
  lines.

### Completion Notes

- Game panel: Export/Import row replaced by a full-width Settings button;
  the Saves modal footer is now the only import/export entry (tests drive
  that path end to end).
- showSettings hosts the Sound sliders (markup contract unchanged:
  vol-music/vol-sfx/data-vol-val) plus the Reduced motion and Steady clock
  toggles moved verbatim from showHelp; footer is a single primary Close.
- Help slimmed: footer is Replay Getting Started + Got it; negative test
  pins that no sliders or toggles remain there.
- 02b-settings screenshot scene added; regeneration rides the
  [update-screenshots] marker push.

## File List

- src/index.html (M): Game panel rows.
- src/ui/UI.ts (M): wireControls, showHelp slimmed, showSettings added.
- src/tests/uiDialogs.test.ts (M): fixture, entry-point helpers, relocated
  suites, new pins.
- scripts/screenshot-scenes.ts (M): 02b-settings shot.
- package.json / package-lock.json (M): 1.19.0 to 1.20.0.
- _bmad-output/implementation-artifacts/story-settings-modal.md (A).
- _bmad-output/implementation-artifacts/backlog.md (M): colorblindCue row.
- _bmad-output/party-mode/memories/installed/.memlog.md (M): party record.

## Review Findings

`/bmad-code-review` 2026-07-12, three adversarial layers over the settings
diff. All 11 ACs and the binding party decisions confirmed met. Triage: 4
patched, 1 deferred, 4 dismissed (each dismissal verified in code).

- [x] `[Review][Patch]` Help copy still said "Toggle Steady clock below"
      after the toggle moved; now says "in Settings" (a deliberate deviation
      from AC 3's literal "everything else unchanged") [`src/ui/UI.ts`]
- [x] `[Review][Patch]` The 02b-settings screenshot guard waited on the
      always-present `#modal` (vacuous with the Help dialog left open by the
      prior shot); now waits on `#modal #vol-music`
      [`scripts/screenshot-scenes.ts`]
- [x] `[Review][Patch]` Zero vertical gap between the Settings button and
      the New Tower row (`wide-btn` carries only a top margin); the button
      now sits in its own `.btn-row` (full width via the row's `flex: 1`,
      standard 6px gap), a deviation from AC 1's `wide-btn` wording
      [`src/index.html`]
- [x] `[Review][Patch]` The OS-forced reduced-motion "(system)" disable path
      had no coverage; test added [`src/tests/uiDialogs.test.ts`]
- [x] `[Review][Defer]` Splash lost its path to the sound/accessibility
      controls (Help hosted them; Settings sits behind the splash focus
      trap); recorded in backlog.md
- Dismissed with verification: export/import reachability (the Saves footer
  wiring pre-exists and the relocated tests drive it), `wide-btn` existence
  (present at styles.css:633, though the class was dropped for `.btn-row`
  anyway), the cross-dialog `data-act="export"` reuse (single-`#modal`
  replacement is the established pattern), and the missing e2e-baseline
  mint (no visual snapshot frames the changed chrome; verified scope).

Follow-up party decision (screenshots): added an `02c-saves` scene (the
Saves dialog, populated slot, Export/Import footer) since the dialog that
became the only import/export home had zero gallery coverage; no mobile
settings shot; no README change; no `[update-baselines]` mint needed.

## Change Log

- 2026-07-12: story created (bmad-create-story) from the party-mode
  decisions.
- 2026-07-12: implemented (bmad-dev-story); review patches + the 02c-saves
  scene applied; merged origin/main (1.18.2) keeping 1.20.0.

- 2026-07-12 (follow-up, owner request): the Motion and pace toggles became
  switch-style checkboxes (role switch, aria-describedby) with explanatory
  notes under each (the Steady clock note explains the 1994 breathing
  clock). Single-pass adversarial review: one low CSS-specificity finding
  patched (.set-note scoped under .set-row); change wiring, osForced path,
  accessible names, and copy all verified clean. Suite 1192 green.
