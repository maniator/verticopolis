# Report an Issue — Help-Modal Entry Point — Design & Content Spec
**Verticopolis** · Game UX (Samus Shepard, GDS) · grounded in shipped source (`src/ui/UI.ts`, `src/styles.css`, `.github/ISSUE_TEMPLATE/`)

status: ready-for-dev

> **Source-truth callouts (verified, not assumed):**
> - The Help modal is built entirely in `UI.ts` → `showHelp()` (`UI.ts:768`). It
>   is one HTML string passed to `openModal()`; sections are `<h3>`-delimited
>   ("Keyboard play" at `UI.ts:790`, "About" at `UI.ts:798`).
> - The Help footer already carries **three** buttons in `.modal-actions`
>   (`UI.ts:800`): `reduce-motion`, `replay-onboard`, and the single
>   `.btn.primary` "Got it" (`close`). One primary per dialog is a design-system
>   rule (`docs/design-system.md` §6.4).
> - `showHelp()` is reachable both in-game (`#btn-help`, wired `UI.ts:199`) and
>   from the splash "How to Play" button (`Onboarding.ts` → `opts.showHelp()`).
> - The repo has four GitHub **issue forms** (`.github/ISSUE_TEMPLATE/*.yml`):
>   `bug_report.yml`, `feature_request.yml`, `parity_report.yml`,
>   `documentation.yml`. `config.yml` sets `blank_issues_enabled: false` — a
>   blank issue is impossible, so the **chooser** (`/issues/new/choose`) is the
>   canonical entry: it forces a form and also lists three contact links
>   (play / search existing / report a security vuln).
> - There is **no outbound `<a>` link anywhere in `src/` today** — this is the
>   app's first. No analytics.

---

## 1. Problem

Now that the repo has real issue forms, players still have **no in-app path** to
them. Someone who hits a bug, wants a feature, or spots a divergence from
SimTower (1994) has to leave the game, find the repo, and locate the issue
chooser on their own — so they mostly don't. We want a low-friction, on-brand
entry point from the one screen already meant for "how does this work?": Help.

## 2. Placement

A new `<h3>` section inside the Help modal **body**, inserted **between the
"Keyboard play" list and the "About" section** (`UI.ts:797`–`798`).

- **Not the footer.** `.modal-actions` already holds three buttons; a fourth
  crowds a right-aligned row and would jostle the primary "Got it". The footer
  stays at three.
- **Not folded into About.** About is clean-room legal/attribution prose; burying
  an action there hurts scannability. A titled section matches the modal's
  existing `<h3>` rhythm and sits next to the version string it pairs with.
- **Help only — not the splash.** The splash is "box art, not UI"
  (`docs/design-system.md` §4); it already reaches this section one click away via
  "How to Play". No report affordance is added to the splash itself.

## 3. Content (exact copy)

```
Found a bug? Have an idea?
Help us improve Verticopolis — report a bug, request a feature, or flag anything
that doesn't match the 1994 original.

[ Report an issue… ]        ← opens the GitHub issue chooser in a new tab
```

- Heading: `Found a bug? Have an idea?`
- Lede (muted): `Help us improve Verticopolis — report a bug, request a feature, or flag anything that doesn't match the 1994 original.`
- Link label: `Report an issue…`

## 4. Affordance & behavior

**One link → the chooser.** A single `Report an issue…` link to
`https://github.com/maniator/verticopolis/issues/new/choose`.

- Rendered as a real **`<a class="btn" target="_blank" rel="noopener">`** — the
  established Win-3.1 button chrome, not a novel underlined web-link, and not a
  `.btn` + `window.open()` handler (a programmatic open is popup-blockable; a
  native anchor is robust and needs no `wireActions` wiring).
- **Chooser, not deep links.** GitHub already maintains the four-way form picker
  (🐛 Bug / ✨ Feature / 🏙️ Parity / 📚 Docs) plus contact links; one link covers
  all of it, matches `blank_issues_enabled: false`, and never drifts when a fifth
  template is added. No per-category maintenance in the app.
- **No version prefill.** Prefill only helps the bug path and only via a
  bug-specific deep link, which would reintroduce per-category links. The bug
  form keeps its own required "Build version" field, and the version is visible
  in the adjacent About line anyway.

## 5. Visual / chrome rules

- `class="btn"` only — **not** `.btn.primary`. The dialog's one primary stays the
  footer "Got it" (design-system §6.4).
- New CSS is minimal and token-free: `a.btn { display:inline-flex; align-items:center; text-decoration:none; }`
  so the anchor drops its underline and the coarse-pointer `min-height:36px` rule
  (`styles.css` `.modal-box .btn:not(.xs)`, ~L1334) actually applies. A
  `.help-report { display:flex; flex-wrap:wrap; gap:8px; }` wrapper handles
  spacing. No new color/focus rule — the global `:focus-visible` (navy,
  `styles.css:93`) already covers `<a>`.
- Press-only feedback (no `:hover`) is inherited from `.btn`.

## 6. Test contract (see `src/tests/uiDialogs.test.ts`)

Open Help and assert:
- an `a[href="https://github.com/maniator/verticopolis/issues/new/choose"]`
  exists, with `target="_blank"` and `rel` containing `noopener`;
- the link is in the modal **body**, not `.modal-actions` — and the footer still
  has exactly its three buttons (`reduce-motion`, `replay-onboard`, `close`).

## 7. Restraint / non-goals

- No new modal, no settings, no telemetry, no in-app issue form — we link out.
- No change to the splash, the footer button set, or the issue templates.
- Not a support inbox: we route to GitHub's existing forms and stop there.

## 8. Versioning

New player-facing capability → **minor** bump `1.2.4 → 1.3.0` (AGENTS.md
Versioning). Commit trailer:
`Player-note: You can now report a bug or request a feature from the Help screen.`

## 9. Review findings (gds-code-review, 2026-07-06)

Three adversarial layers ran (Blind Hunter, Edge Case Hunter, Acceptance
Auditor). Auditor: fully spec-compliant. Findings:

- **[Patch — applied] Initial focus landed on the external link.** `showModal()`
  focuses the first focusable descendant; the new `<a>` precedes the footer, so
  opening Help then pressing Enter/Space would pop a GitHub tab. Fixed by adding
  `autofocus` to the primary "Got it" button — activation of the report link is
  now always deliberate, and focus lands on the safe dismiss action (realizing
  the design-system intent in `docs/design-system.md` §3). Locked by a test.
- **[Defer] No "opens in a new tab" cue for assistive tech (WCAG 3.2.5).**
  Minor once focus is fixed (activation is deliberate). Recorded in
  `implementation-artifacts/backlog.md` — a shared external-link affordance is a
  cross-app decision, not a one-off on this link.
