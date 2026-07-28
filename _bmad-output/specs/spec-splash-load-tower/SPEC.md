---
id: SPEC-splash-load-tower
companions:
  - ../../project-context.md
  - ../../planning-artifacts/ux-designs/ux-verticopolis-2026-07-28/DESIGN.md
  - ../../planning-artifacts/ux-designs/ux-verticopolis-2026-07-28/EXPERIENCE.md
sources: []
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete, preservation-validated contract for what to build, test, and validate. Source documents listed in frontmatter are for traceability only — consult them only if you need narrative rationale or prose color this contract intentionally omits.

# Title-Screen Load Tower

## Why

**A pain to solve**, and specifically a reachability failure rather than a missing feature. `appBoot.ts` derives the splash's `hasSave` from `app.hadReadableSave`, which `SaveGame.loadResult()` computes from the autosave keys alone (`verticopolis-save` plus the legacy `simtower-clone-save`). Manual slots 1 to 3 are never consulted at boot, and `SaveGame.listSlots()` is reachable only from inside a running game. The title screen therefore cannot see two thirds of the save system it sits in front of.

Two players are stranded by that today, and both have to found a tower they do not want in order to escape. A player whose autosave will not parse gets a title screen offering New Tower alone while a readable tower sits in slot 2. A player who reinstalled or changed devices has empty storage and a `.vctower` export they cannot reach, because Import lives behind the same in-game dialog. The design was ratified by a party-mode roundtable on 2026-07-28 and signed off the same day.

## Capabilities

- **CAP-1**
  - **intent:** A player on the title screen can reach every tower saved on the device, from the title screen, without founding a tower first.
  - **success:** The splash renders a `Load Tower` action in every state, in the order Continue, Load Tower, New Tower, with How to Play last. It is a real `<button>` the existing focus trap collects. It never carries `.primary` in any state, so exactly one amber plate is on screen at a time (Continue when a save exists, New Tower when none does). A template test pins presence in both states, DOM order, and the single-primary rule.

- **CAP-2**
  - **intent:** That action opens one load-only surface listing the towers on this device, so the player picks a tower rather than a storage mechanism.
  - **success:** The surface renders one row per device slot (autosave, then 1 to 3), each carrying the tower's name, rule-set chip, star, population, funds, day, and saved-at, with a single Load control. Slot presence is a raw presence check, exposed as `SlotInfo.present`. A slot present but unparseable renders with its name plus `Couldn't be read by this version.` and **no control at all** (not a disabled one). The surface carries no Save, no Delete, and no Export. A failed load re-renders the picker with the reason inline, as a `role="alert"`, and never as a toast (see Constraints). Tests pin the three row variants, the absence of every write control, and the inline failure.

- **CAP-3**
  - **intent:** A player whose tower exists only as an exported file can load it from the same place as any other tower.
  - **success:** A `Load from a file...` row is present in that same list, always last, in every state, with a detail line naming the accepted formats in text. Activating it routes through the existing importer, which already accepts `.vctower` and original 1994 `.TDT` saves and sniffs header magic so a renamed file still routes correctly. A test pins the row's presence in every state and that it reaches the existing import path.

- **CAP-4**
  - **intent:** A player with nothing loadable on the device gets one honest sentence and a route forward, not a list of dead rows.
  - **success:** With no slot present, the surface body is a single line, `No towers saved on this device.`, followed by the file row. It does not render four rows reading `empty`. With slots present but none parseable, it renders the unreadable rows followed by the file row. The action's destination does not change with state: one button, one surface, always. Tests pin both states.

- **CAP-5**
  - **intent:** Opening or abandoning the picker never costs the player the title screen.
  - **success:** The splash stays mounted and the engine stays paused when the picker opens, when it is closed or dismissed with Esc, when the OS file picker opens, when the OS file picker is cancelled, and when a load or import fails. It tears down on successful tower adoption only, from the single junction every arrival passes through (`OnboardingController.adoptSim`, which `GameApp.adoptSim` already calls). Tests pin teardown-on-success, no-teardown on each failure and cancel path, and that a mid-game tower swap with no splash up claims nothing.

- **CAP-6**
  - **intent:** A tower loaded from the title screen is entered under the same terms as Continue.
  - **success:** After adoption the game is at speed 0 with the `Welcome back. Press ▶ to resume.` toast, matching what `onContinue` already does to compensate for `teardownSplash()` resuming the engine to play speed. The host receives this through `OnboardingOpts.onEnterTower`, fired only when a splash was actually torn down. A test pins that it fires on a splash arrival and does not fire on a mid-game swap.

## Constraints

- **No Save, Delete, or Export on any surface reachable from the title screen.** This is correctness, not taste. While the splash is up the live sim may be the throwaway boot sim (`main.ts`: `boot.sim ?? Simulation.newGame(...)`), and the standing invariant, stated in `saveLoad.ts`'s `saveBeforeUpdate` comment and enforced by the 30 second autosave timer's `#splash` check, is that nothing mutates the sim while the splash is up. A Save there would not throw: `saveToSlot` reads `viewState()` from an engine that is paused but alive, so it would succeed and write an empty tower carrying a genuine timestamp.
- **Slot presence is a raw presence check, never the parse-based `exists`.** `listSlots()` carries both, as `SlotInfo.present` and `SlotInfo.exists`. Hiding an unreadable slot tells the player their tower is gone at the moment the bytes are still on disk, which is exactly what `preserveUnreadable` exists to prevent. `present` is required, not optional, so a producer that forgets it fails the compile rather than silently hiding a slot.
- **A failure raised from the title screen must not be reported by a toast.** The toast rail lives inside `#stage` with no z-index of its own, and `#splash` is fixed at z-index 40, so the title screen paints over it. The picker therefore renders its own load failures inline. Where a toast is the only channel available (the importer's own rejection messages, reached through CAP-3), the rail is raised to z-index 45 instead: above the splash, below `#boot-cover` at 50, which is removed before any toast can fire.
- **No path may write the outgoing tower on the way in.** The `.TDT` import path's `saveBeforeUpdate()` already no-ops behind the `#splash` guard, and the splash's freeze keeps a returning player's in-memory tower byte-identical to their autosave, so nothing is lost. Do not add a flush to the splash load path: the outgoing sim there is usually the throwaway boot sim, and writing it is the failure mode this whole surface avoids.
- **The picker uses the shared retro `<dialog id="modal">` shell**, as How to Play and the New Tower rule-set picker already do over this screen, and inherits the `safeDismiss` guard that stops the splash's own Esc firing underneath an open modal. The splash itself stays un-unified box art (design-system rule); the picker must not be restyled into it.
- **The new plate must not become the fallback focus target.** `Onboarding.ts` focuses `[data-splash="continue"] ?? [data-splash="new"]`, and `scripts/screenshot-page-ops.ts` selects the same pair to get past the splash for the gallery. Both must keep working. The existing assertion that mute and install are the last two controls in tab order must still hold.
- **Reuse the existing seams:** `SaveGame.listSlots` / `hasSlot` / `loadSlot`, the `adoptSim` path `loadFromSlot` already uses, and `openImport`. No new persistence format and no new storage key.
- The splash focus ring is amber, not the global navy ring, which is invisible against the night sky. Any control added here inherits that.
- American English, no em-dashes in new copy, comments, commit, or PR text.

## Non-goals

- Renaming, deleting, reordering, or writing slots from the title screen. The in-game Saved Towers manager keeps all of that and is unchanged by this work.
- Changing `Continue`'s meaning. It stays the autosave, and stays absent when the autosave will not parse.
- Changing the boot-screen rule in `resolveBootScreen`. An app-initiated resume reload still skips the title screen entirely.
- Changing import or export fidelity, the `.vctower` container, or TDT round-trip behavior. This work adds a call site, not a format change.
- Cloud saves, cross-device sync, or any account-bound storage.
- Save previews, thumbnails, or a tower screenshot on the row.

## Success signal

A player whose autosave was written by a build that has since rolled back opens the game, sees no Continue, presses Load Tower, and finds the dead autosave labeled `Couldn't be read by this version.` directly above a healthy Slot 2 they can load, landing paused in their own tower. A player who reinstalled on a new phone presses the same button, gets one line saying nothing is saved on the device, taps `Load from a file...`, and opens the `.vctower` from their cloud drive. Neither of them founds a tower they did not want, which is the only route either has today.

## Assumptions

- The picker reuses `.slot` row styling. Verify during implementation that a row with no action control still reads as a row rather than a heading.
- Three plates plus the ghost link fit one desktop row at current sizes, since `.splash-actions` already wraps. The mobile stack gains a fourth full-width 48px control; verify at 360x640 that it clears `.splash-attrib` and does not push the wordmark off screen. If something must give, the attribution shrinks and the targets do not.

## Implementation notes

- The 500-line file-size guard (a ratchet that only shrinks, so new entries are not an option) forced two splits alongside this work: the picker controller lives in its own `src/ui/uiTowerPicker.ts`, re-exported from `uiDialogs` exactly as `uiBatchPricing` and `uiElevatorSchedule` are, and `uiBatchPricing`'s dialog context and callback shapes became named exported interfaces so `UI`'s delegation references them by name instead of restating them.
- The dismissal hook lives in `OnboardingController.adoptSim` rather than `GameApp.adoptSim`. The behavior is identical, since the former is already called by the latter, and the onboarding controller is the module that owns the splash.
