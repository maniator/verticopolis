# Launch fireworks: bmad-code-review, round 1

Skill: `/bmad-code-review` (UI plumbing; no engine, save or gameplay data),
run as one lean pass per CLAUDE.md (owner, 2026-11-10), no spec file
(`no-spec` mode; the coordinator's brief stands in for acceptance).

## Blind Hunter (diff only)

1. Focus is left on `<body>` when the show ends, after it took focus from the
   title screen. **patch**, fixed: `close()` restores the earlier focus when
   focus was still inside the show.
2. Every keydown is swallowed, including lone modifiers and browser
   shortcuts (Ctrl+R). **patch**, fixed: lone modifiers are ignored, and with
   Ctrl, Alt or Meta held the key closes the show without `preventDefault`.
3. The dialog has a label but no description. **patch**, fixed:
   `aria-describedby` points at the body text.

## Edge Case Hunter (diff plus repository)

4. A 4.0 first opened in a background tab spends the latch, and the 8 s
   timer (throttled but still running) closes the show before the player
   looks. **patch**, fixed: the countdown starts only once
   `visibilityState` is not `hidden`.
5. After the launch window the frame loop keeps clearing an empty canvas
   until the timer fires. **patch**, fixed: the loop stops once the sky is
   empty.
6. The release branch (version 4.0.0) would show the overlay in e2e, the
   screenshot gallery and visual baselines. Already handled: automation
   (`navigator.webdriver`) never plays it. Checked under a simulated 4.0.0
   (`package.json` version edited locally, then restored) by running the boot
   suites (`appBoot*`, `bootstrap`) and this file: green.
7. `?debug=all` now also plays the fireworks on each load. **dismiss**: that
   flag means every debug flag, and the preview never touches the latch.
8. The canvas size is fixed at mount; rotating a phone mid-show stretches it
   for the remaining seconds. **dismiss**: cosmetic, at most 8 s, once.
9. Blocked storage: the show is skipped rather than replayed every boot.
   Intended, tested.

## Acceptance Auditor (coordinator brief)

Once per player, persisted locally: yes (`vc-launch-fireworks-4`). Brief and
skippable: 8 s, any click or key or OK. Win95 style: `.win`, `.win-title`,
`.btn.primary`, pixel canvas. Reduced motion: still frame, no frame loop.
Classic and Modern: mode-agnostic boot overlay. Help pages updated
(Installing and updates, Settings). Change note `app: minor`. No findings.

## Hot-Path Auditor (docs/performance/hot-path-review.md section 6)

Diff touches `src/ui/` and `src/game/appBoot.ts` (hot-path surfaces). The new
code runs from `runBootFlow` once per page load; the show runs a
`requestAnimationFrame` loop for at most about 7 s, once per profile.

| Item | Result | What was checked | Findings and resolution |
| --- | --- | --- | --- |
| HP-1 | clear | `maybeLaunchFireworks` is called once from `runBootFlow` (GameApp constructor); `stepSky`/`drawSky` only from the show's own rAF `tick`; nothing reachable from the game frame loop, HUD refresh or engine ticks | none |
| HP-2 | clear | `stepSky` and `drawSky` walk the live sparks (at most `MAX_SPARKS` = 480) and rockets (at most about 3 in flight); no nested scan | none |
| HP-3 | finding (1) | `stepSky` allocated two new arrays per frame | fixed: both lists compact in place; a frame allocates only a burst's new sparks |
| HP-4 | n/a | no sorting | none |
| HP-5 | n/a | no maps or sets on a per-frame path (`MODIFIER_KEYS` is read per keydown) | none |
| HP-6 | n/a | no id lookups | none |
| HP-7 | n/a | new code, no inherited algorithm | none |
| HP-8 | n/a | no cache added, dropped or bypassed | none |
| HP-9 | clear | the HP-3 remedy is named (in-place compaction) | none |
| HP-10 | clear | presentation only; no simulation result touched | none |
| HP-11 | n/a | no WASM boundary, host or build setting changed | none |
| HP-12 | finding (1) | the loop kept drawing an empty sky after the last spark | fixed: the loop stops once the sky is empty; the canvas is a quarter-resolution 2D canvas, cleared once per frame, about 480 `fillRect` at most |

## Triage

6 patch (items 1 to 5 and HP-3; item 5 is also HP-12), all fixed in this
round with tests; 0 defer; 2 dismiss.

## Confirming pass

Re-read the fixed code: the deferred `timer`/`startTimerWhenSeen` bindings
are only read after they are declared (every caller is an event or the
returned function); focus is restored only when it was still inside the
show; the stopped loop leaves `frame` at 0, so `close()` cancels nothing
stale. No new patch findings: clean.

## Follow-up (owner, 2026-11-14)

Naftali: "Just welcome to verticopolis -- no need for 4.0". The window title
is now "Welcome to Verticopolis™" and the window names no version; the bold
lead line that repeated the welcome is gone, and `shortVersion` with it. A
test pins that the window text carries no version number.

## Round 2 (owner and party changes, 2026-11-14)

- Owner: the window names no version; it shows to new players too, so it
  carries first-time links (Your first tower, Classic or Modern?, See what's
  new); it never closes by itself.
- Player panel (`_bmad-output/party-mode/welcome-window-close-party-findings-2026-11-14.md`):
  no timer; closes on OK, the ✕, Escape or a click on the sky outside the
  window; never on a click inside, Tab, or a followed link. Tab wraps inside
  the window (now `aria-modal="true"`).
- Independent review (CONDITIONAL GO at 41f4642): its condition, the copy
  naming the running minor version and "This release brings a new menu bar",
  is gone with the versionless copy; the help line now says "any version 4
  release". Its optional note is taken: a boot whose save could not be read
  skips the show and keeps the latch for a later boot.
- The auto-close and background-tab countdown code left with the timer; the
  "any key closes" path became "Escape closes, every key is kept from the
  game".

Hot path: unchanged from round 1 (same sky code and loop); the new code is
DOM built once and three listeners. Tests: 31 in this file, covering the
waiting window, the ✕, the sky click, the links, Escape and the Tab wrap.

## Round 3 (owner, 2026-11-14): the game's own dialog

Naftali: the window and its OK did not match any other modal. The welcome is
now `welcomeModalTemplate` (`src/ui/templates/welcome.ts`) opened through
`UI.openModalTemplate` with `displaceable: true` and `wireActions`, like the
Compare and About dialogs: an `<h2>` the window grammar turns into the title
bar with its ✕, `.modal-actions` with the `.btn.primary` OK. Closing comes
from that grammar (OK, ✕, Escape, a backdrop click), and the native modal
dialog keeps focus inside and restores it on close, so the hand-built key
handler, Tab trap, focus restore and scrim are gone. The fireworks canvas is
prepended inside `#modal` (fixed, `z-index: -1`, `pointer-events: none`), so
it draws over the dimmed backdrop, lets a backdrop click reach the dialog,
and leaves with the dialog when `closeModal` or a displacing dialog empties
it; the frame loop checks `canvas.isConnected` each frame. A displaceable
dialog yields to a report that arrives behind it.

Confirming pass: no new patch findings. Hot path unchanged (the same sky
loop, now also stopping when its canvas leaves the page).
