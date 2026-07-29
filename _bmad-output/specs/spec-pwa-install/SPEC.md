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
  - **intent:** The team learns how many players install, which affordance they reach for, and how the offer performs, without interrupting anyone.
  - **success:** The `appinstalled` event (completion) and a boot-time display-mode bucket (standalone vs browser) flow into the existing cookieless analytics enrichment; additionally each deliberate tap on an install affordance emits an `install_offer` action carrying which surface was used (`splash`, `chip`, or `menu`), the engagement half of the funnel the OS `appinstalled` event cannot attribute. All counts are coarse and cookieless; no player-facing telemetry surface is added. Tests pin the display-mode bucket value, that `appinstalled` emits through the existing analytics path, and that each surface's tap reports its own `install_offer` detail.

- **CAP-5**
  - **intent:** A player on the splash/title screen who could install is offered it there too. The splash is the "is this a real app?" moment, so the offer is a persistent front door there, not a gated nudge.
  - **success:** A quiet install button sits on the splash near the mute (un-unified box-art styling), shown whenever the session is NOT already installed (not standalone, not TWA), independent of whether `beforeinstallprompt` has fired. Its visibility is decided at mount by the not-standalone check alone, so there is no live reveal race. Tapping it always does something honest: the native prompt when the deferred event has been captured, otherwise a short platform-appropriate "add to your device" how-to (iOS always; Chrome/Edge before the event lands). It is absent for standalone/TWA sessions, and absent in wrapped builds (`--mode native`, `--mode desktop`), which are not installable web apps and do not report standalone. The copy promises an outcome (offline, fullscreen, from your home screen), never "one-tap." A test pins that it shows for a not-standalone session and hides for standalone, and that a tap with no captured event routes to the how-to while a tap with one drives `prompt()`.

## Constraints

- No player-facing "PWA" or "install our app" wording anywhere. Copy is outcomes only: play offline, fullscreen, from your home screen.
- Already-installed sessions (`display-mode: standalone` / `navigator.standalone`) and Android TWA sessions see the affordance in no surface.
- `beforeinstallprompt` is consumed only through deliberate UI (the one-shot is guarded); the iOS how-to is never auto-shown.
- Reuse the update-chip (`#btn-update`) appear/disappear plumbing; introduce no new timed pop-up or toast region.
- Show once, then go passive on the in-game chip: no re-nagging, no dark patterns.
- One offer, three surfaces (splash button, topbar chip, Game-panel entry) all drive the SAME activation path; a single captured `beforeinstallprompt` (no second capture, no duplicate prompt event). The topbar chip and Game-panel entry gate their visibility on `installAvailability`; the splash button gates its visibility only on not-being-standalone (the persistent front door), and its tap still routes through the shared activation, degrading to the how-to when no event is captured.
- The Add-to-Home-Screen how-to has an iOS variant and a Chrome/Edge (browser-menu) variant, since a not-standalone Chrome/Edge player can reach the splash button before `beforeinstallprompt` fires; neither is ever auto-shown.
- No em-dashes in new player-facing copy or comments; American English.

## Non-goals

- Timed or auto-appearing pop-ups or toasts of any kind (the splash button and the in-game surfaces are quiet, conditional controls, never a pop).
- Win-moment or star-gated triggering of the offer. This is an explicit phase-2 lever, taken only if the plain play-gated chip underperforms.
- The word "PWA" in any user-visible surface.
- Any change to the first-visitor autoplay gating or the existing update-prompt flow.

## Success signal

A player who has been building on Android or desktop Chrome sees a quiet "⤓ Install" chip once, taps it, gets the browser's native install sheet, and next launch opens Verticopolis fullscreen from a home-screen icon, playable with no signal. An iPhone player who taps the same affordance gets clear "Add to Home Screen" steps, not a dead button. A player already running the installed app, or inside the Android wrapper, never sees any of it. Adoption shows up in analytics without a single interruption.

## Assumptions

- "Installable" (for the in-game chip and Game-panel entry) means the `beforeinstallprompt` event has been captured this session; if a browser never fires it (install criteria unmet), the chip simply stays hidden there, which is acceptable. The splash button does not use this gate: it shows for a not-standalone browser session and falls back to the how-to when no event is captured. Wrapped builds are excluded by build mode (amended 2026-07-29, desktop build mode): a Capacitor WKWebView and an Electron window are both non-standalone, so without that gate the button rendered inside a wrapper and its how-to described a browser menu those shells do not have.
- `matchMedia('(display-mode: standalone)')` plus `navigator.standalone` (iOS) reliably identify an already-installed session for the not-standalone gate.

## Open questions

- None.
