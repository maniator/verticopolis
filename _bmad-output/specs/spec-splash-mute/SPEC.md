---
id: SPEC-splash-mute
companions:
  - ../../project-context.md
sources: []
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete, preservation-validated contract for what to build, test, and validate. Source documents listed in frontmatter are for traceability only — consult them only if you need narrative rationale or prose color this contract intentionally omits.

# Splash-Screen Mute Control

## Why

**A pain to solve**, reported live on the Reddit launch thread (2026-07-22) and owner-approved on the spot: a returning player wanted to open the game during a meeting and could not, because the splash theme starts on load and the only mute lives in the in-game topbar, unreachable behind the splash. The browser autoplay policy protects first-time visitors (no sound before a gesture), so the burned population is exactly the game's most engaged returning players, whose browsers trust the site enough to autoplay. The owner's own words: "Idk why I only put the mute in the actual game but not on the splash screen."

## Capabilities

- **CAP-1**
  - **intent:** A player on the splash screen can see and toggle the game's mute state before any interaction that would start sound, from the first rendered frame.
  - **success:** The splash renders a speaker toggle in its top-right corner: a real `<button>` the existing splash focus trap collects, `aria-pressed` reflecting state, hit target at least 44px, icon flipping between speaker and muted. A template test pins presence, ARIA state, and target size.

- **CAP-2**
  - **intent:** The splash toggle and the in-game topbar toggle are two views of ONE persisted mute, so muting anywhere holds everywhere and across sessions.
  - **success:** Toggling on the splash drives the same `toggleMute` path (persisting `prefs.muted`); after dismissing the splash the topbar toggle shows the same state with no sync step; volume sliders are untouched and unmute restores the prior mix. An integration test pins splash-toggle -> prefs -> topbar agreement, and a reload round-trip.

- **CAP-3**
  - **intent:** A player who muted once boots to a SILENT splash forever after, even where the browser allows autoplay.
  - **success:** This already holds (`main.ts:209` applies `prefs.muted` at construction, before any music program starts); a regression test pins it: with persisted mute, boot plus splash-program start produces no audible program, and the splash toggle renders in the muted state.

## Constraints

- The splash is box art and stays un-unified (design-system rule): the toggle must NOT wear the in-game `.btn` chrome; it dresses like the splash's own ghost controls.
- One mute source of truth: the button binds the existing `audioPrefs.toggleMute` (`src/game/audioPrefs.ts`), never a second flag. `toggleMute` calls `audio.start()`; that is acceptable here because the click IS the gesture, and an engine started muted is silent.
- The button joins the splash focus trap automatically (the trap collects `button:not([disabled])` inside `#splash`); it must not steal the trap's default focus from Continue/New Tower, and Escape semantics stay untouched.
- No em-dashes in new player-facing copy or comments; American English.

## Non-goals

- Removing or default-muting the splash theme. The theme is product identity (party ruling, 2026-07-22: design veto against silencing everyone to serve the meeting case).
- Per-channel volume controls on the splash. Settings owns the three sliders; the splash gets the master gate only.
- Any change to the autoplay-gating behavior for first-time visitors.

## Success signal

A returning player who muted once opens verticopolis.com in a meeting: the splash is silent from frame zero and visibly shows the muted speaker. A first-time visitor in a meeting clicks the speaker before anything else and founds a tower without a note escaping. The Reddit reporter's "so i can start during a meeting" works both ways.

## Assumptions

- The audio facade gates program playback while muted regardless of the order program-set and setMuted occur in (consistent with `main.ts:209` running before the splash program; re-verify during implementation).

## Open questions

- None.
