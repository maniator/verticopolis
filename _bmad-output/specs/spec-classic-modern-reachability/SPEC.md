---
id: SPEC-classic-modern-reachability
companions:
  - page-architecture.md
  - retro-design-system.md
  - media-plan.md
sources: []
---

> **Canonical contract.** This SPEC is the complete, preservation-validated contract for what to build, test, and validate. It was distilled from a five-agent design party (UX, visual/craft, game design, architecture, dev) whose rationale lives in `.memlog.md`; consult that only for narrative color this contract omits. Load-bearing per-file detail lives in the three companions listed above; the kernel cites them by name.

# Classic vs Modern ruleset reachability

## Why

Verticopolis founds each tower as Classic (faithful 1994) or Modern (same game plus opt-in extras), an irreversible choice, yet nothing in the running game names which rule-set the active tower uses, and a player who founded a Modern tower sessions ago has no way to recall what Modern actually changes. The full "Classic vs Modern" comparison exists only as a collapsed section buried in the Help dialog, and its copy is maintained by hand (it has already drifted twice as Modern features shipped). This work makes the active rule-set visible in play, collapses the comparison to one source so it cannot drift, and gives it a shareable home: a standalone `/help` page a player can link to, built on a small reusable retro page kit that the sprite gallery adopts too. The reference is reachable everywhere it is wanted, from one copy, without breaking the single-page game.

## Capabilities

Phasing (see the epic note in Constraints): **P1** is CAP-1 through CAP-7. **P2** is CAP-8 (the paired screenshots), which layers onto the finished pages.

- **CAP-1: single source of truth for the comparison**
  - **intent:** Every surface renders the Classic vs Modern comparison from one shared template, so the copy has a single source and cannot drift.
  - **success:** The comparison body (intro paragraph, divergence bullet list, and the "pixel-faithful to 1994" closer, without the `<details>`/`<summary>` wrapper) lives in `src/ui/templates/compare.ts` (`compareTemplate()`). `help.ts` renders it inside its unchanged `<details class="help-modes"><summary><span role="heading" aria-level="3">Classic vs Modern</span></summary>` (the a11y heading span is preserved by the extraction); the compare modal, the founding `<details>`, and the standalone `/help` page all render the same `compareTemplate()`. The existing `help.test.ts` drift guard (the `RULE_TO_HELP` map, copy-sync, and uniqueness tests, located via `sectionBySummary(frag, "Classic vs Modern")`, which matches the summary text carried in its nested `<span role="heading">`) passes with no edits. A new `compare.test.ts` asserts `compareTemplate()` emits every divergence phrase and the "pixel-faithful to 1994" closer.

- **CAP-2: active-mode badge in play**
  - **intent:** A player mid-game can see which rule-set the current tower runs.
  - **success:** A badge/button in the Tower panel (`src/index.html`, near `#tower-name`) reads "This tower: Classic" or "This tower: Modern" from the live mode via `ui.cb.getMode()` (which returns `app.getSim().mode`). A new `UI.setMode(mode)` helper, called from `uiStatus` after `setTowerName`, updates the badge's label and class only when the mode value changes (no per-pump DOM write), and it reflects an `adoptSim` swap because the mode is read live. The badge is a separate element, never rendered inside `#tower-stats` (the lit one-renderer invariant owns that element). `uiStatus.test.ts` covers the label/class following the mode and the no-op when unchanged.

- **CAP-3: reach the comparison in play, without losing sim time**
  - **intent:** A player can open the full comparison during play, and reading it never costs elevator time.
  - **success:** Clicking the mode badge opens a Compare modal (`uiDialogs.showCompare` rendering `compareModalTemplate`: an `<h2>Classic vs Modern</h2>`, `compareTemplate()`, and a close button) through the existing single `#modal` `openModalTemplate`. Opening it pauses the tower (`setSpeed(0)`) and closing it restores the speed the player had before, so the reference is free to read; it closes cleanly via the standard close/Esc/backdrop path. A `uiDialogs` integration test asserts the badge click opens it, it opens/closes, and the pause-on-open / restore-on-close behavior holds (the mode badge is added to the test DOM fixture).

- **CAP-4: founding reference, inline, without leaving the decision**
  - **intent:** At founding, a player can read the full comparison inline without leaving the mode decision.
  - **success:** A collapsed `<details class="nt-compare well">` beneath the two mode cards in `newTower.ts` reveals `compareTemplate()` inline; the existing `.nt-more` pointer is reworded to point at it. The mode radio selection is untouched (the founding dialog keeps its one DOM box), with no second surface and no change to `newTowerModal` wiring. The three-feature "Modern adds" teaser stays; no "Modern adds N" count appears. The `newTower.ts` doc comment that claims the comparison "lives on the Help screen" is corrected. `newTower.test.ts` asserts the collapsed `.nt-compare` details, its summary text, and a signature phrase inside.

- **CAP-5: a shareable standalone `/help` page (the full how-to-play guide)**
  - **intent:** Anyone can open and share a canonical How-to-play reference at a clean URL (the guide, with Classic vs Modern one section of it), and always get back to the game.
  - **success:** `src/help.html` is a Vite input rendering the **full how-to-play guide** inside the retro page shell (CAP-6): the same sections the in-game Help modal shows (the basics, going further, Classic vs Modern, keyboard, About, plus the report call to action), from a single shared source, `src/ui/templates/helpContent.ts` (`HELP_SECTIONS` + `helpLede`/`helpAboutBody`/`helpReportBlock`), which both the modal (`help.ts`) and the page render, so the guide copy has one home and cannot drift (the same discipline `compareTemplate()` brings to the Classic vs Modern section). Classic vs Modern is one section, anchored `/help#classic-vs-modern`; the in-game "Open full page" link deep-links there. Served at the clean `/help` via one targeted Vercel rewrite, with SEO/OG head parity (titled "How to Play") and Vercel telemetry parity with the game. Workbox keeps `help.html` (and its `help-*.js` page entry chunk) OUT of precache, mirroring `/gallery`, so the clean `/help` always resolves fresh over the network (Workbox precaching defaults `cleanURLs` to true, so a precached `/help.html` would otherwise answer the clean `/help` from a stale SW-install snapshot across deploys); the shared `helpContent-*.js` chunk stays precached for the in-game Help modal offline. `/help` stays on the `navigateFallbackDenylist` so the `index.html` app shell does not hijack it (both an offline `/help` copy and the clean-URL precache alias are intentionally omitted; see the backlog: a generateSW alias would fetch `/help` at SW install and 404 off-Vercel, failing the whole precache). "Back to game" is a real `<a href="/">` in the title bar and footer. The in-modal "Open full page" link is a real `<a href="/help#classic-vs-modern" target="_blank" rel="noopener noreferrer">` that a click handler downgrades to opening the in-app modal when the app is an installed standalone PWA or the native wrapper (`isInstalledStandalone()` / `getPlatform().isNativeWrapper`). Per-file detail (Vite input, precache, `navigateFallback`, the rewrite, canonical/sitemap, the standalone fallback, back-to-game, and telemetry) is in **page-architecture.md**.

- **CAP-6: a reusable retro page kit, from one palette**
  - **intent:** Standalone pages wear the same Windows-3.1 chrome the game uses, defined once, with no palette duplicated per page.
  - **success:** The retro `:root` tokens and shared component classes are extracted from `styles.css` into `src/styles/retro-tokens.css` and `src/styles/retro-components.css`; `styles.css` `@import`s both and the game render is unchanged. A new `src/styles/retro-page.css` imports the same two plus standalone-page layout, and a `pageShell(title, backHref, main, links?)` helper returns the window frame with the "Back to game" control and sibling nav. `retro-tokens.css` is the only declaration of `--r-face` in the codebase (a guard test asserts no other page HTML/CSS redeclares it), and `retro-page.css` defines a dark-theme override so a shared link is legible in a dark viewer without touching the in-game look. Full detail in **retro-design-system.md**.

- **CAP-7: the sprite gallery joins the kit**
  - **intent:** The gallery proves the kit's reuse: same chrome, a clean URL, telemetry parity, cross-links, and cells that render at true proportion.
  - **success:** `gallery.html` drops its inline duplicated palette and imports `retro-tokens.css` + `retro-page.css`, gaining the shared title bar, a "Back to game" link to `/`, and a link to `/help`; `/help` links back to the gallery. The gallery is served at the clean `/gallery` via a second targeted rewrite, its canonical moves from `/gallery.html` to `/gallery`, and it gains the Vercel telemetry it lacks today (the shared host-gated helper). The squished-cell defect is fixed: the fixed `CELL_H` plus the `roomEntry` aspect-scaling in `gallery.ts` currently shrink tall multi-floor kinds (metro at 3 floors, cinema and party hall at 2) next to single-floor rooms; cells are resized so each kind renders at its true proportion with no cell visibly vertically compressed. Because the restyle and the cell resize change rendered pixels, the gallery's existing captures drift and are regenerated through the pinned container (see the screenshot-impact note in **media-plan.md**). Cross-links and telemetry detail in **page-architecture.md**; the gallery-as-consumer detail in **retro-design-system.md**.

- **CAP-8: paired Classic vs Modern stills (P2)**
  - **intent:** The comparison shows, not just tells: each divergence that has a distinct on-screen frame carries a Modern-beside-Classic image.
  - **success:** A new `scripts/scenes/classic-vs-modern.ts` scene, run in the pinned Playwright container through `scripts/screenshots.ts`, emits paired PNG stills under `docs/screenshots/features/` for the shortlisted divergences, riding the existing drift gate (no new gate). Data/math-only divergences stay caption-only. GIFs are out of scope (no tooling; a CSS crossfade of the two stills covers motion if ever wanted). Full shortlist, format decision, and caption-only list in **media-plan.md**.

## Constraints

- **Two presentations, one system.** The in-app modal (CAP-3) and the founding `<details>` (CAP-4) keep the player in the live sim; the standalone page (CAP-5) is the shareable canonical. All four surfaces render the one `compareTemplate()` (CAP-1). No copy of the comparison prose exists anywhere else; `help.test.ts` must pass unedited because `compareTemplate()` renders inside the same "Classic vs Modern" section its guard inspects.
- **No modal stacking and no drawer.** `showModal()` puts the dialog in the browser top layer, so a drawer renders behind the backdrop and a second dialog occludes the first on mobile while compounding the dimming. Founding reveals the comparison with an inline `<details>` only; the compare modal reuses the single `#modal`.
- **Targeted routing only.** Two explicit Vercel rewrites (`/help`, `/gallery`); never sitewide `cleanUrls`. `/help` adds one Vite input and one `navigateFallbackDenylist` entry, and keeps `help.html` OUT of precache so the clean `/help` is served fresh from the network (online-only, like `/gallery`); no client-side router, no Workbox `runtimeCaching`, no self-registering SW on the pages (the root-scope game SW covers them), no SSR/hydration (the only prerender is the `/help` build-time static one; see Non-goals). (The clean-URL offline precache alias this spec originally prescribed is deliberately omitted, see CAP-5: a generateSW alias would fetch `/help` at SW install and 404 off-Vercel, failing the whole precache.)
- **CSS Modules are not adopted.** The repo styles through one global token-based sheet and lit templates carry plain `class="..."` literals; Modules would fragment the token model for no ergonomic win. The `retro-tokens.css` + `retro-components.css` extraction is the reuse mechanism (Shadow-DOM `static styles` is the lit-native path if scoping is ever wanted, out of scope here).
- **Parity-pride framing.** No "Modern adds N" count on the founding screen; frame Classic as the faithful reference build, never as the option with fewer features. Keep the existing three-feature "Modern adds" teaser.
- **Do not touch `GameRules` or engine behavior**, and do not reword the comparison beyond extracting it verbatim into `compareTemplate()`. Do not render the mode inside `#tower-stats`.
- **House style and process.** American English, no em-dashes, no marketing vocabulary, no "X, not Y" pattern. Minor `package.json` version bump (player-facing), lockfile in lockstep. Ship as an epic: P1 (CAP-1..7) then P2 (CAP-8). Review lane: `/bmad-code-review`.

## Non-goals

- A client-side router or hash routes. (A hash route is the lightest future deep-link if one is ever wanted; out of scope here.)
- Sitewide `cleanUrls`, Workbox `runtimeCaching`, a page-registered service worker, SSR/hydration of app pages, or a runtime render server. (Narrowed 2026-07-21 for #516: a build-time static prerender of the `/help` body into `dist/help.html` is in scope, as a post-build step of `npm run build` with no new dependencies and no hydration, the client re-rendering identical markup; prerendering any other page stays out.)
- CSS Modules, or any component-scoping migration.
- GIF or video tooling for the screenshots (P2 is PNG stills only).
- Any change to `GameRules` / engine behavior, or to the wording of the comparison beyond the verbatim extraction.
- Removing a live page: `preview.html` is the active e2e/screenshot harness and stays; the cleanup removes only a page proven dead (none known today).
- A "Modern adds N" feature count anywhere.

## Success signal

A returning player opens a Modern tower founded long ago, sees "This tower: Modern" in the Tower panel, clicks it, the tower pauses, and they read the full Classic vs Modern comparison, then close it and the tower resumes at its prior speed. A friend follows a shared `verticopolis.com/help` link, reads the full how-to-play guide in the retro window (with Classic vs Modern one deep-linkable section, `/help#classic-vs-modern`), browses the sprite gallery through the sibling link, and clicks "Back to game" to start their own tower. Every one of those surfaces, plus the founding screen, renders the same `compareTemplate()`; adding a future Modern divergence still fails `npm run typecheck` at the `RULE_TO_HELP` map until it is classified, and the single template means the new line appears everywhere at once. `--r-face` is declared in exactly one file, and no gallery cell renders visibly squished.

## Assumptions

- The active mode is available to the UI without new plumbing (`ui.cb.getMode()` already returns `app.getSim().mode` and is used in `uiDialogs.ts`).
- The Tower panel (`src/index.html`, near `#tower-name`) is the right home for the mode badge, which doubles as the click target for the Compare modal.
- The engine pauses only through the speed system (`setSpeed(0)`), so the modal's pause-on-open is a UI-layer call, not an engine change.
- Vercel telemetry endpoints exist only on `verticopolis.com` and `*.vercel.app`, so the host gate that guards the game's inject is the right gate for the pages.

## Open Questions

- Review lane: the dev lens placed this in `/bmad-code-review` (UI plumbing, shared copy, build/PWA/Vercel plumbing, no engine change); the architecture lens noted `/gds-code-review` because the comparison copy names gameplay-parity semantics. Default is `/bmad-code-review`; confirm whether the parity-copy content warrants also running `/gds-code-review`.
- Exact gallery cell sizing: whether to raise `CELL_H` globally or key each row's height off its tallest kind is left to implementation, as long as no cell reads squished and aspect is preserved.
