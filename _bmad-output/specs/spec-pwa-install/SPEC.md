---
id: SPEC-pwa-install
companions:
  - ../../project-context.md
sources: []
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete, preservation-validated contract for what to build, test, and validate. Source documents listed in frontmatter are for traceability only — consult them only if you need narrative rationale or prose color this contract intentionally omits.

# In-Game "Install app" Affordance

## Why

**An opportunity to capture.** Verticopolis is already an installable PWA (manifest `display: standalone`, a service worker that precaches the whole app), but nothing in the product ever offers the install: a player who would love a home-screen icon, a fullscreen tower with no browser bar, and offline play on a no-signal commute has no way in. A game+design roundtable (2026-07-22) ruled that the value is real for a builder people binge, but only if the offer respects the player: no toast, no timed pop-up, no dark pattern, and no faking a one-tap install on iOS where the platform forbids it. This spec is that respectful offer. It is platform/UI plumbing, not a game mechanic.

## Capabilities

- **CAP-1**
  - **intent:** A committed in-game player who could install, and hasn't, is quietly offered the install once, and can find it again later on their own terms.
  - **success:** A small "⤓ Install" chip appears in the topbar's conditional zone (the update-chip's neighbor) only when the session is in-game AND installable AND not already standalone; its first appearance waits until the player has really started playing (splash dismissed into a tower / first placement), it shows once without re-nagging, and thereafter a permanent-but-passive "Install app" entry sits in the Game panel beside Saves/Settings. A test pins the show condition (hidden for standalone/TWA/pre-play, shown for an installable in-game session) and the once-only behavior.

- **CAP-2**
  - **intent:** On a browser that supports programmatic install (Chrome/Edge, Android and desktop), the player installs in one tap from the affordance.
  - **success:** The app captures `beforeinstallprompt`, calls `preventDefault`, and stashes the deferred event; activating the chip or the Game-panel entry calls `prompt()` on it. The deferred event is consumed only through that deliberate UI, so a stray dismissal never burns the one-shot. A test pins that the affordance drives `prompt()` and that the event is not consumed except on explicit activation.

- **CAP-3**
  - **intent:** On iOS Safari, where there is no programmatic install, the player who reaches for the affordance gets honest instructions instead of a dead or fake button.
  - **success:** On iOS-Safari-not-standalone the same affordance is present, and tapping it (chip or Game-panel entry) opens a short, honest "Add to Home Screen" how-to; the how-to is never auto-shown and the control is never dressed as one-tap. A test pins that iOS routes to the how-to, not to a `prompt()` path.

- **CAP-4**
  - **intent:** The team learns how many players install, and how the affordance performs, without interrupting anyone.
  - **success:** The `appinstalled` event and a boot-time display-mode bucket (standalone vs browser) flow into the existing cookieless analytics enrichment; no player-facing telemetry surface is added. A test pins the display-mode bucket value and that `appinstalled` emits through the existing analytics path.

## Constraints

- No player-facing "PWA" or "install our app" wording anywhere. Copy is outcomes only: play offline, fullscreen, from your home screen.
- Already-installed sessions (`display-mode: standalone` / `navigator.standalone`) and Android TWA sessions see the affordance in no surface.
- `beforeinstallprompt` is consumed only through deliberate UI (the one-shot is guarded); the iOS how-to is never auto-shown.
- Reuse the update-chip (`#btn-update`) appear/disappear plumbing; introduce no new timed pop-up or toast region.
- Show once, then go passive: no re-nagging, no dark patterns.
- No em-dashes in new player-facing copy or comments; American English.

## Non-goals

- Any install offer on the splash/title screen (the splash mute stays the splash's only new control; install is in-game only).
- Timed or auto-appearing pop-ups or toasts of any kind.
- Win-moment or star-gated triggering of the offer. This is an explicit phase-2 lever, taken only if the plain play-gated chip underperforms.
- The word "PWA" in any user-visible surface.
- Any change to the first-visitor autoplay gating or the existing update-prompt flow.

## Success signal

A player who has been building on Android or desktop Chrome sees a quiet "⤓ Install" chip once, taps it, gets the browser's native install sheet, and next launch opens Verticopolis fullscreen from a home-screen icon, playable with no signal. An iPhone player who taps the same affordance gets clear "Add to Home Screen" steps, not a dead button. A player already running the installed app, or inside the Android wrapper, never sees any of it. Adoption shows up in analytics without a single interruption.

## Assumptions

- "Installable" means the `beforeinstallprompt` event has been captured this session; if a browser never fires it (install criteria unmet), the chip simply stays hidden there, which is acceptable.
- `matchMedia('(display-mode: standalone)')` plus `navigator.standalone` (iOS) reliably identify an already-installed session for the not-standalone gate.

## Open questions

- None.
