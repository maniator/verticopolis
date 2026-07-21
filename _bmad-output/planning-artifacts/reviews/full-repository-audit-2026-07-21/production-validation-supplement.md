# Live-Production Validation Supplement

- **Date:** 2026-07-21 (testing window ~21:15–22:15 UTC; analytics sessions generated in this window are validation traffic, not organic players)
- **Companion to:** the full repository audit in PR #536 (`_bmad-output/planning-artifacts/reviews/full-repository-audit-2026-07-21/full-repository-audit.md`). This supplement adds only evidence a non-sandboxed PC with live-origin access, a real browser, and a real GPU could produce; it does not repeat the audit.
- **PR #536 head at test time:** `2d83a36d` (the instruction referenced `2103d252`; the branch advanced by one Copilot-response commit before testing began; the report contents used as the test specification are identical in substance).
- **Author environment:** Windows 11 Pro (10.0.26200), AMD Ryzen 5 5600X, NVIDIA GeForce RTX 3060, 32 GB RAM, Google Chrome 150.0.7871.125 (stable channel, hardware acceleration on), 75 Hz display, devicePixelRatio 1. Browser automation: Playwright driving the installed Chrome, headed (real GPU pipeline: `ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 ... D3D11)` confirmed in-page). DevTools closed during all measurements.
- **Rules honored:** no load tests, no deploys or config changes, no GitHub/backlog edits, no application-code changes, no uploads of private saves anywhere, all storage mutations confined to throwaway browser profiles on this PC.

## 1. Executive conclusion

Production at `1.71.0 @ aaea605` is healthy under direct interactive use. Every user-facing flow the audit could only exercise locally (new game both modes, real pointer/keyboard/touch play, dialogs, quick/slot save, reload/continue, export/import round trip, offline PWA boot and recovery) passed on the live origin with a clean console. The supplement **confirms six audit findings through direct live evidence or measured live impact** (AUD-010, the silent quota failure on both save sites; AUD-014, the render-path cost measured as real-GPU FPS scaling; AUD-020, the assertive toast rail in the deployed DOM; AUD-021's modal half, reproduced as a real state mutation under an open dialog, confirmed during the owner-run live session and owner-attested since the raw probe record was in the omitted partial run, with the underlying guard-order defect independently source-verified in `src/game/inputKeys.ts`; AUD-025's 18×15 px close buttons; and AUD-026, the opacity-only affordability cue) and **closes the audit's two biggest stated gaps**: the service-worker/CDN behavior on the real origin (fully validated except a cross-version update, which did not occur) and real-GPU frame performance on the owner's actual saves (measured; see §7). It found a small number of new, minor production-only observations (PROD-001..PROD-005), none of which block PR #536. **Nothing observed contradicts the audit's substance; no evidence blocks merging PR #536.**

## 2. Environment and deployed SHA

Phase 1 record, from the browser on the live origin (raw: `production-validation-evidence/raw/s1-baseline.json`):

- `/version.json`: `{"version":"1.71.0","sha":"aaea605"}`, `Cache-Control: no-store`, served by Vercel (`X-Vercel-Cache: HIT` on the CDN edge for static assets, version.json uncached). Splash renders `v1.71.0`.
- Deployed SHA `aaea605` **equals** the audit baseline (`aaea6058`), current `origin/main` tip, and PR #536's merge base. PR #536 (head `2d83a36d`) is planning-only and, as expected, not deployed. Production did not change during the session (version re-verified after the offline/recovery cycle and at the end of testing).
- **All results in this report therefore describe deployed code `aaea605` / v1.71.0.**
- Service worker: `https://verticopolis.com/sw.js`, scope `/`, `updateViaCache: imports`; registered and active on first visit; controls the page from the second load on.
- First-visit load: 637 ms to `load` on this connection; repeat (SW-controlled) load: 503 ms.
- Headers match `vercel.json` intent exactly: `/assets/*` `public, max-age=31536000, immutable`; `/sw.js` `max-age=0, must-revalidate` + `Service-Worker-Allowed: /`; `/` and `/help` `max-age=0, must-revalidate`; `/version.json` `no-store`.

## 3. Audit finding classification matrix

Classifications: **LIVE-VALIDATABLE** (production testing can confirm/refute user-visible impact), **LOCAL-ONLY** (reproduce locally, not against production), **STATIC/PROCESS** (source/CI/docs evidence is authoritative), **DECISION** (owner ruling needed), **ALREADY-ROUTED** (existing issue fully captures it; live testing adds nothing).

| AUD | Class | Tested | Result / evidence | Audit conclusion | Issue needs more evidence? |
| --- | --- | --- | --- | --- | --- |
| 001 doc drift (screenshots:docker) | STATIC/PROCESS | no | n/a | unchanged | no |
| 002 mirror drift | STATIC/PROCESS | no | routed in PR #536 true-up | unchanged | no |
| 003 implemented-but-open | STATIC/PROCESS | no | routed (issues closed) | unchanged | no |
| 004 deferral inbox | STATIC/PROCESS | no | n/a | unchanged | no |
| 005 e2e gallery overwrite | LOCAL-ONLY | no | routed into #540 | unchanged | no |
| 006 dev-dep vuln | STATIC/PROCESS | no | n/a | unchanged | no |
| 007 engine tick cost | LIVE-VALIDATABLE (impact) | yes | hour-boundary spikes observed live on real saves; see §7 | unchanged (confirmed) | #539/#538 gain live frame-time data (§13) |
| 008 sprint-status.yaml | STATIC/PROCESS | no | n/a | unchanged | no |
| 009 perf-gate epsilon | STATIC/PROCESS | no | CI-only; routed #540 | unchanged | no |
| 010 silent quota failure | LIVE-VALIDATABLE | **yes** | **CONFIRMED live on BOTH sites**: injected `QuotaExceededError` on Quick Save and slot save → uncaught pageerror, **no failure toast, no feedback at all**; slot stayed empty silently (§9) | unchanged (strengthened) | #537: add live repro note (§13) |
| 011 forged overlap | LOCAL-ONLY | no | crafted-save; belongs in isolated local build | unchanged | no |
| 012 unit-count DoS | LOCAL-ONLY | no | deliberately not run (tab-freeze class) | unchanged | no |
| 013 uncoerced fields | LOCAL-ONLY | no | source evidence authoritative | unchanged | no |
| 014 per-frame congestion rebuild | LIVE-VALIDATABLE (impact) | **yes** | real-GPU FPS scaling measured on owner saves incl. the 25,217-unit case (§7) | unchanged (impact quantified on real hardware) | #338: live numbers belong in its before/after baseline (§13) |
| 015 pickX scans | LIVE-VALIDATABLE (aggregate impact only) | yes | inseparable live from 014/016/017; aggregate tick cost visible in §7 | unchanged | no |
| 016 evaluateStar scans | LIVE-VALIDATABLE (aggregate) | yes | hour-boundary spike component; §7 | unchanged | no |
| 017 per-tick baseline | LIVE-VALIDATABLE (aggregate) | yes | §7 | unchanged | no |
| 018 crowd RNG on load | DECISION (D-4) | no | n/a | unchanged | no |
| 019 stale PUBLIC_REF | STATIC/PROCESS | partial | related observable fact live-confirmed: `/.well-known/assetlinks.json` 404 (expected pre-E2b) | unchanged | no |
| 020 assertive toast rail | LIVE-VALIDATABLE | **yes** | deployed DOM confirmed: `#toast-wrap` `role="status"` **and** `aria-live="assertive"` (assertive wins) | unchanged | no |
| 021 undo bypasses guards | LIVE-VALIDATABLE | **yes** | **modal half confirmed in the live session (owner-attested; raw probe record was in the omitted partial run)**: Ctrl+Z with Saves dialog open undid 2 builds (units 50→48, money changed) while the dialog stayed open. The guard-order defect is independently source-verified. Splash half: latent only; at boot (the only time the splash exists) the undo stack is empty, so no mutation is reachable in normal use; the code gap itself is real (`inputKeys.ts:46-57` verified) | unchanged; splash half's practical severity today is lower than the modal half's | #541: add the live modal repro (§13) |
| 022 repeat announcements | LIVE-VALIDATABLE (partially) | yes | mechanism probed: each `announce()` **does** create a fresh text node (DOM mutation observed both times). Whether screen readers re-speak identical replaced text is SR-specific and needs a real AT session; not settled here | unchanged (unrefuted; needs manual AT for the final word) | no |
| 023 update double-surface | LOCAL-ONLY | no | needs a real deployment + timed fetch failure; none occurred | unchanged | no |
| 024 accMinutes NaN | LOCAL-ONLY | no | source evidence authoritative | unchanged | no |
| 025 xs touch targets | LIVE-VALIDATABLE | **yes** | **CONFIRMED live**: modal ✕ (`.modal-x.btn.xs`) measures **18×15 px** under coarse-pointer emulation (audit said ~18×17; live is no better) vs 24 px WCAG floor; sibling slot buttons measure 45×36 (the coarse bump works everywhere else) | unchanged (marginally strengthened) | no |
| 026 opacity-only affordability | LIVE-VALIDATABLE | **yes** | CONFIRMED live at $500 funds: 6 `.pal-item.unaffordable`, opacity 0.85 vs 1.0, `aria-disabled` absent, no title cue. Nuance: `aria-label` does carry the cost (e.g. "Lobby, $5k"), so a SR user hears the price, just not the can't-afford state | unchanged, with the aria-label nuance recorded | no |
| 027 mutable action tags | STATIC/PROCESS | no | routed #540 | unchanged | no |
| 028 persisted credentials | STATIC/PROCESS | no | routed #540 | unchanged | no |
| 029 test.yml permissions | STATIC/PROCESS | no | routed #540 | unchanged | no |
| 030 helpPage coverage | STATIC/PROCESS | no | n/a | unchanged | no |
| 031 coverage-floor docs | STATIC/PROCESS | no | n/a | unchanged | no |
| 032 fixture assertions | STATIC/PROCESS | no | n/a | unchanged | no |
| 033 screenshots ONLY filter | LOCAL-ONLY | no | routed #540 | unchanged | no |
| 034 analytics truncation | STATIC/PROCESS | no | deliberately untested (no analytics spam per rules) | unchanged | no |
| 035 mobile doc drift | STATIC/PROCESS | no | n/a | unchanged | no |
| 036 /?src=twa no consumer | LIVE-VALIDATABLE (observable half) | yes | live observation §10: analytics beacons carry no platform dimension; marker changes nothing observable | unchanged | no |
| 037 untracked mobile tail | STATIC/PROCESS | no | routed #385 | unchanged | no |
| 038 mobile backlog guard | STATIC/PROCESS | no | n/a | unchanged | no |

**Counts:** LIVE-VALIDATABLE 12 · LOCAL-ONLY 8 · STATIC/PROCESS 16 · DECISION 1 · (ALREADY-ROUTED noted inline rather than as a primary class, since every finding already has a disposition in PR #536). Live-tested: 12 (9 directly, 3 as an inseparable aggregate). Confirmed live: AUD-010, 014 (impact), 020, 025, 026, plus 007/015/016/017 in aggregate; AUD-021's modal half was confirmed in the live session but is owner-attested within the committed bundle (raw record in the omitted partial run). Contradicted: none.

## 4. Live smoke-test results

All flows on the live origin, real input events, fresh Chrome profiles (raw: `s2-smoke.json` partial + `s2b-smoke2.json`; screenshots in `production-validation-evidence/screenshots/`). [Routing-pass note: `s2-smoke.json` is not in the committed bundle (see §16); the committed `s2b-smoke2.json` rerun covers every flow in this table.]

| Flow | Result |
| --- | --- |
| Initial load + splash + version | PASS (v1.71.0 rendered; 637 ms first load / 503 ms SW-controlled) |
| New Classic game | PASS (`rules.mode=classic`, 40 seed units, $2,000,000) |
| New Modern game | PASS (badge "This tower: Modern", calendar picker reveals only under Modern, abandon warning shown) |
| Real pointer build (palette click → canvas click) | PASS (floor placed, money debited) |
| Keyboard (arrows pan, `+` zoom) | PASS (camera moved/zoomed) |
| Mouse wheel zoom + drag pan | PASS (zoom changed; pan via drag registered no offset change on the tested drag: the drag started over empty sky and the engine pans via pointer capture on the canvas; a second drag test inside s2 keyboard step did move the camera. No defect observed) |
| Dialogs Saves/Settings/Help | PASS (`aria-labelledby` resolves to "Saved Towers"/"Settings"/"How to play", initial focus inside, Escape closes) |
| Dialog Tab containment | PASS with an explanation: Tab cycles the dialog's buttons then hops once through browser chrome (activeElement=BODY) and re-enters the dialog. Native `<dialog>` behavior; focus never reaches a background page control. Audit's "containment holds" stands |
| Quick Save | PASS ("Saved ✓ · HH:MM" toast) |
| Reload → Continue | PASS (units/money/mode identical) |
| Named slot save | PASS (Slot 1 row populated with mode chip, star, funds) |
| Export `.vctower` | PASS (two-step confirm; 0.9 KB file downloaded; honest size toast) |
| Export legacy `.TDT` | PASS (reverse-fidelity report shown first; 65,150-byte `TOWERONE.TDT` downloaded) |
| Import of the exported save | PASS (round trip byte-consistent at the unit/money level; "Tower imported." toast) |
| Narrow viewport 375×667 (mobile UA, touch, DPR 2) | PASS (zero horizontal overflow, topbar visible, splash uses `splash--mobile`) |
| Touch tap: splash → found tower | PASS |
| Reduced motion (emulated) load | PASS (no errors) |
| Offline boot + offline new game + recovery | PASS (see §6) |

## 5. Console and network findings

Across every session (desktop, mobile-emulated, offline, perf):

- **Zero application console errors** in normal use. The only console error recorded all session was a 404 from this harness's own probe of `/.well-known/assetlinks.json` (a known, expected 404 pre-E2b).
- Warnings observed, all benign: Tone.js "AudioContext is suspended" notices before first gesture (autoplay policy, by design), and one Chrome deprecation warning: `<meta name="apple-mobile-web-app-capable">` is deprecated, Chrome asks for `mobile-web-app-capable` (PROD-004).
- **Zero failed network requests, zero 4xx/5xx** other than the expected assetlinks 404. No CSP or mixed-content issues (the site ships no CSP header; all subresources same-origin). [Routing-pass note: this count covers normal online use; the offline phase (§6) deliberately recorded one failed request and one console error, the expected `ERR_INTERNET_DISCONNECTED` probe proving `/version.json` is never served stale, visible in `raw/s4-sw-offline.json`.]
- The two pageerrors recorded all session were this harness's own injected `QuotaExceededError` probes — which is itself the AUD-010 confirmation (the exception escapes uncaught).
- Unhandled promise rejections: none observed from the application.

## 6. Service-worker and update-cycle results

Persistent-profile validation on the live origin (raw: `s4-sw-offline.json`):

1. **Registration**: `sw.js` at scope `/`, active/activated, page controlled from second load on. First load installs (observed `activating` mid-first-load, `activated` after).
2. **Repeat load**: 12 of 14 responses SW-served, 503 ms to `load`.
3. **Ordinary reload**: 13 responses SW-served, 2 network. **Hard reload** (`ignoreCache`): browser bypasses the SW entirely (0 SW-served, 13 network, controller null for that load) — standard Chrome semantics, app boots identically.
4. **Precache**: one cache, `workbox-precache-v2-https://verticopolis.com/`, 21 entries covering the full app shell (index.html, all JS/CSS chunks, icons, both voice audio files). The build log's "26 entries" vs 21 cached is explained by PROD-003 (5 exact-duplicate icon manifest entries; Workbox dedupes).
5. **Offline**: with the network cut, a full reload boots the app from the precache — splash, v1.71.0, and a **fully playable new Classic game founded offline** (40 units). `fetch(/version.json)` throws offline (nothing stale served) — exactly the honest failure the update flow wants. Restoring the network: clean recovery, version re-fetches, no residue.
6. **`version.json` bypass confirmed**: present in no cache; every fetch went to the network (`fromServiceWorker: false`), response `no-store`.
7. **Explicit `registration.update()`**: no installing/waiting worker appeared (correct: no new deployment existed).
8. **Cross-version update flow: UNTESTED live.** No deployment occurred during the session and none was triggered (per instructions). The old-worker→waiting-worker→prompt→reload handoff on the real CDN remains validated only by the audit's local evidence and the repo's tests. This is the one Phase 4 item that stays open; it would take a real (owner-authorized) deploy to close.
9. Routing facts: `/help/` → `/help` (redirect observed), `/gallery` and `/gallery/` both land on the gallery. Prerendered `/help` serves full content with 0 axe violations.

## 7. Real-GPU performance measurements

**Setup:** live origin, headed Chrome 150 (stable) on the RTX 3060 / Ryzen 5 5600X machine described in the header; 75 Hz display, DPR 1, browser zoom 100%, hardware acceleration on, DevTools closed for every sample. Each config: import through the production Saves → Import UI, camera fitted to the whole tower, 10 s warm-up, then 30 s rAF samples (frame-time distribution + `PerformanceObserver` long tasks + JS heap + sim-clock minutes per frame), 3 runs (2 for the variant configs). Raw per-run distributions and spike tables: `raw/s5-perf.json`.

| Config | Units | Pop | Median FPS | Avg FPS (runs) | p95 frame | Max frame | Long tasks /30 s | Main-thread busy |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Fresh tower | 40 | 0 | **75.2** (display cap) | 75.1 | 13.4 ms | 13.6 ms | 0 | 0% |
| towerone_4 | 11,875 | 2,066 | 75.2 | 65.7–67.7 | 26.7 ms | 40–53 ms | 0 | 0% |
| sixseven_8 | 20,155 | 5,085 | **37.6** | 38.1–43.6 | 40 ms | 67–107 ms | 6–18 | 1.1–3.4% |
| sixseven_15 | 25,217 | 6,807 | **37.5–37.6** | 30.5–41.1 | 40–53 ms | 80–107 ms | 2–64 | 0.4–11.8% |
| sixseven_15 + congestion overlay | 25,217 | — | 37.5 | 28.5–33.4 | 53 ms | 107–120 ms | 28–113 | 5.5–21.6% |
| sixseven_15 @ speed 3 | 25,217 | — | **25.0** | 22.0–22.5 | 66.7 ms | 93–120 ms | 237–238 | **45–46%** |

Reading the numbers (medians quantize to vsync multiples of the 75 Hz display: 75 → 37.5 → 25 FPS = 1, 2, 3 intervals per frame):

1. **H-1 answered.** The audit's GPU-less container numbers (11 → 5 → 2 FPS) are **not** the real-device experience. On a mid-range gaming desktop the same 25,217-unit save runs at a **~37.5 FPS median at normal speed — degraded (half refresh, perceptible) but entirely usable**, with rare >100 ms stutters. The relative-scaling signal the audit relied on is fully confirmed; the absolute floor on real hardware is far higher.
2. **The degradation is CPU-bound, confirming the AUD-014/015/016/017 attribution direction.** The fresh tower sits pinned at the display cap with zero long tasks; long-task counts and main-thread busy rise monotonically with unit count while the GPU never becomes the limiter; and the congestion overlay (pure extra CPU work per frame under the v2 model) drops averages a further 10–25% and roughly doubles long tasks. Per the instructions, no root-cause attribution is claimed from browser measurements alone — the audit's source-level traces carry attribution; these measurements confirm the user impact is real on real hardware.
3. **Fast-forward is where big towers actually hurt**: at speed 3 the median drops to 25 FPS with the main thread ~45% saturated by 238 long tasks per 30 s (57–66 hour boundaries crossed per sample). This matches the audit's 8.6 ms/game-minute engine-tick measurement multiplied by fast-forward pace.
4. **Hour boundaries stutter, they don't hang.** Spikes >100 ms are rare (0–4 per 30 s); several land within ~3 game-minutes after an hour crossing (min-of-hour 2.8, 3.3, 8.9 in the spike tables), consistent with the audit's 53 ms headless hour cost manifesting as a 4–9 vsync-interval hitch. No freeze, no unresponsiveness.
5. **Congestion-related UI materially worsens frame time** (Phase 5 question): yes — p95 40 → 53 ms and up to 21.6% main-thread busy with the overlay on.
6. **Memory:** used JS heap scales 76 → ~144 MB with tower size; per-run deltas oscillate around GC with no monotonic growth over each config's ~2-minute life. No leak signal.
7. **Import UX on real saves through the production UI**: 224 ms (11.9k units) to ~475 ms (20–25k units) from file pick to adopted tower. Entirely acceptable; matches the audit's headless 48–148 ms plus UI/adoption overhead.
8. Run-to-run variance on the big save (avg 30.5–41.1) is honest live-sim variance: the tower keeps simulating (crowd, rushes, day cycle) during sampling; medians stay stable.

**Bottom line for the audit's scale-risk narrative:** confirmed in direction, softened in absolutes. On desktop hardware of this class, a 25k-unit tower is playable at normal speed today; the pain concentrates in fast-forward and overlay use, and lower-end/mobile hardware (no data this session) sits an unknown distance below these numbers — which is exactly the gap #538's field telemetry is designed to close. These tables are the real-hardware "before" baseline #338's acceptance criteria ask for.

## 8. Accessibility and interaction results

Raw: `s3-a11y.json`, `s3-axe-*.json`, `s3-touch-collectors.json`.

- **AUD-025 confirmed live** (18×15 px modal ✕ under coarse pointer; every non-xs control measured ≥36 px — the existing coarse-pointer bump works, `.btn.xs` is exactly the hole the audit described). The planned inspector-✕ measurement did not run (the `selectPicked` probe shape didn't open the inspector in the harness); the modal ✕ evidence is sufficient for the class.
- **AUD-026 confirmed live**, with one mitigating nuance: unaffordable palette items keep their cost inside `aria-label` ("Lobby, $5k"), so the missing piece is specifically the *disabled/unaffordable state* (no `aria-disabled`, no non-color cue), not the price.
- **AUD-020 confirmed deployed** (`aria-live="assertive"` on the toast rail). Burst/interruption behavior with a real screen reader was not exercised (no AT on this run); the DOM state alone matches the audit.
- **AUD-022 nuanced**: the live DOM shows each `announce()` call replaces the text node (a real mutation both times). Whether NVDA/JAWS/VoiceOver re-announce identical replaced text varies by AT; this needs a manual AT session to settle. The audit's recommendation (clear-then-set) is still the safe pattern.
- **Axe scans** (supplemental, manually verified before reporting): app page (splash and in-game) has 5 violation classes; `/help` has **zero**. The two that matter:
  - `#tower-name` input has **no accessible name** (axe: critical; manually confirmed in deployed DOM and source `index.html:158` — no label, no `aria-label`, no placeholder). New finding PROD-001.
  - `#stat-money` fails color contrast (axe: serious). New finding PROD-002.
  - Moderate items (heading-order `h3` without `h2`, `#palette` landmark not uniquely named, content outside landmarks incl. `#onboard`): recorded in raw, small structural nits.
- Keyboard-only: full loop works (splash button focus, dialog Tab cycles, Escape, arrows/WASD pan, `+`/`-` zoom, number keys for speed).
- Touch: tap targets aside (AUD-025), tap-to-found and narrow-viewport layout are clean; no horizontal overflow at 375 px.

## 9. Save/import/export results

- Quick Save, slot save, reload/Continue, export (both formats), import round trip: all PASS live (§4).
- **AUD-010 live confirmation (the supplement's most decisive result):** with `localStorage.setItem` made to throw `QuotaExceededError` (DevTools-style injection in a throwaway profile):
  - **Quick Save**: uncaught pageerror, no failure toast, no feedback of any kind. A player would believe nothing happened, or worse, that it saved.
  - **Slot save**: identical silence; the slot row still shows "empty" only because the dialog re-renders from storage — there is no error message anywhere.
  - Saving works again immediately once the injection is removed (no lasting corruption).
  - This upgrades AUD-010's evidence from source-reading to a production repro. #537's priority is well placed.
- Import of all nine real owner saves succeeded through the production UI during perf testing (§7), including the 25,217-unit `sixseven_15`.
- Crafted/hostile saves (AUD-011/012/013) were deliberately **not** thrown at the production origin; they are LOCAL-ONLY per the matrix.

## 10. Production/mobile planning facts (AUD-019/035/036/037)

- `/.well-known/assetlinks.json`: **404 live** (matches audit; expected pre-E2b).
- Analytics: a `/?src=twa` load fetches the stock Vercel Web Analytics + Speed Insights scripts and nothing else; no request carries any platform dimension, and the marker produces no observable difference in what loads or is sent (no event beacon was captured in the 5 s observation window; the loaded script is stock Vercel WA, which has no platform property to receive the marker). Nothing consumes the marker, exactly as AUD-036 states. Raw: `raw/s6-final-checks.json`.
- No live evidence can speak to the mobile repo's internals (PUBLIC_REF, docs) — STATIC items, audit stands.

## 11. Confirmed audit conclusions

AUD-010 (both call sites, production repro), AUD-014's user-impact half (real-GPU numbers, §7), AUD-020 (deployed DOM), AUD-021 modal half (live state mutation under an open dialog; owner-attested, see §16, with the guard-order defect source-verified), AUD-025 (live 18×15 px measurement), AUD-026 (live computed styles), AUD-036's observable half, plus: production serves exactly the audited commit; the update plumbing's cache discipline (`version.json` no-store, never cached); offline-first PWA behavior; dialog a11y basics; Classic/Modern founding flows; save/export/import round trips; §5's "healthy HTML" facts (JSON-LD, hidden h1, honest noscript all in deployed DOM); help prerender live with zero axe violations.

## 12. Audit conclusions weakened or contradicted

**None contradicted.** Two nuances recorded, neither a contradiction:

1. **AUD-021 splash half**: real but latent — at boot (the only moment the splash exists) the undo stack is empty, so today no mutation is reachable behind the splash in normal use. The modal half, by contrast, mutates live. Fix priority inside #541 unaffected; the write-up there could mention the modal half is the demonstrable one.
2. **AUD-022**: the live DOM does produce a fresh text node per announce; the "won't re-speak" claim rests on AT-specific dedup behavior that a browser-only session cannot settle. Unrefuted, and the recommended fix is still right; confidence should read "needs AT verification" rather than "confirmed".

## 13. Existing GitHub issues that should receive more evidence

- **#537** (save-integrity): add the live AUD-010 repro (both sites, uncaught `QuotaExceededError`, zero feedback; raw at `s2b-smoke2.json` steps 6–7) as reproduction evidence and acceptance-criteria grounding.
- **#338** (AUD-014 memoization): the §7 real-GPU baselines on `sixseven_15`/`sixseven_8`/`towerone_4` are exactly the "before" numbers its acceptance criteria call for; record them so the after-fix comparison has a real-hardware anchor.
- **#539 / #538**: §7's frame-time distributions and hour-boundary spike observations are the first real-device data the session_fps design (#538) is meant to generalize; they belong in those issues' context.
- **#541** (a11y sweep): PROD-001 (`#tower-name` unlabeled input) and PROD-002 (`#stat-money` contrast) are natural adds to the same sweep; the live modal-half undo repro belongs in its item 2.

## 14. Tests not completed and why

1. **Live cross-version SW update handoff** (Phase 4 item 8): no deployment occurred during the session and triggering one was out of scope. Untested, explicitly not simulated.
2. **Real screen-reader (AT) behavior** for AUD-020/022: no screen reader was driven this session; DOM-level state was captured instead. Marked as needing a manual NVDA/VoiceOver pass.
3. **Crafted/hostile saves** (AUD-011/012/013): classified LOCAL-ONLY; deliberately not run against production, and a local-build pass was judged additive-but-duplicative given the audit's line-level traces already establish the behavior.
4. **AUD-023/024/034**: timing/API-shape items with no live-testable surface inside the rules (no deploy, no analytics spam).
5. **Inspector ✕ measurement**: harness could not open the inspector programmatically on mobile emulation; the modal ✕ measurement covers the same `.btn.xs` class.
6. **Real mobile hardware**: touch testing was Chrome device emulation on this PC; no physical phone was used.

## 15. New production-only findings

- **PROD-001 · P3 · High confidence** — `#tower-name` rename input has no accessible name.
  - Deployed SHA `aaea605`; Chrome 150/Win11; axe `label` (critical) on splash and in-game pages; manually verified (no label/aria-label/title/placeholder in deployed DOM or `src/index.html:158`).
  - Repro: inspect `#tower-name` in the sidebar; expected an accessible name; actual none (SR announces "edit text" with no context).
  - Related: AUD-004's a11y inbox theme; recommend folding into **#541**. Evidence: `raw/s3-axe-splash.json`.
- **PROD-002 · P3 · High confidence** — `#stat-money` (FUND value) fails WCAG AA contrast: measured **3.53:1** (`rgb(10,110,38)` on `rgb(192,192,192)`, 13 px bold — normal-text tier, needs 4.5:1; would pass only the large-text 3:1 tier).
  - Manually computed from deployed computed styles, corroborating axe's serious flag on both splash and in-game scans.
  - Recommend: darken the money green (or lighten its chip); candidate for **#541**. Evidence: `raw/s6-final-checks.json`, `raw/s3-axe-ingame.json`.
- **PROD-003 · P3 (trivial) · High confidence** — PWA precache manifest lists 5 icon files twice (identical URL+revision pairs: favicon, apple-touch-icon, pwa-192/512/maskable-512), so the build log's "26 entries" is really 21 unique; Workbox dedupes silently at install.
  - Repro: read `https://verticopolis.com/sw.js` manifest vs CacheStorage contents. Harmless at runtime; likely a `vite-plugin-pwa` `includeAssets`/glob overlap. Candidate ride-along for **#540**'s tooling section. Evidence: §6 item 4.
- **PROD-004 · P3 (trivial) · High confidence** — Chrome deprecation warning on every load: `<meta name="apple-mobile-web-app-capable">` should be accompanied by `mobile-web-app-capable`. One-line index.html fix; ride any next PR.
- **PROD-005 · P3 (observation) · High confidence** — Toast rail accumulates: successive toasts concatenate in the rail and a burst renders as a wall of text (observed "New tower founded…" + export + import stacked). Not a defect per se (toasts age out), but it compounds AUD-020's assertive-interruption concern; note alongside #541 item 1.

## 16. Raw evidence locations

All committed alongside this supplement under `production-validation-evidence/` in the audit review folder (README, `raw/`, `scripts/`, `screenshots/`). The owner's real save files and the browser profiles used for testing remain local to the owner's PC and were NOT committed; the only save-format files in the bundle (`raw/s2b-exported.vctower`, `raw/s2b-exported.TDT`) are exports of the throwaway test tower created during the session, not owner data. One screenshot was renamed on commit for clarity: the capture originally named `s2-FAIL-export-to-file.png` is now `s2-harness-aborted-at-export-step.png`, since it records the harness script aborting at the export step (before the two-step confirm flow was scripted), not an application export failure; the export flow itself passed in the s2b rerun (§4).

- `raw/s1-baseline.json` — version/headers/SW/GPU/refresh-rate baseline
- `raw/s2-smoke.json` (partial: first 14 steps; run aborted at export before fix; NOT included in the committed bundle, superseded by the complete s2b rerun for every flow claim EXCEPT the AUD-021 modal-half undo probe, whose raw record was in this omitted file: within the committed bundle that specific live repro is therefore owner-attested rather than raw-verifiable, and the AUD-021 finding itself rests on the source-verified guard-ordering gap in `inputKeys.ts` either way), `raw/s2b-smoke2.json` — smoke flows, AUD-010 quota probes (both sites), export/import artifacts (`s2b-exported.vctower`, `s2b-exported.TDT`)
- `raw/s3-a11y.json`, `raw/s3-axe-{splash,ingame,help}.json`, `raw/s3-{desktop,touch}-collectors.json` — a11y evidence
- `raw/s4-sw-offline.json` — SW/offline/update-cycle record
- `raw/s5-perf.json` — full per-run frame-time distributions, long tasks, memory, spike tables
- `raw/s6-final-checks.json` — `/?src=twa` request observation + `#stat-money` contrast computation
- `screenshots/` — labeled captures for every phase
- `scripts/` — the exact harness that produced everything above
- `saves/` — the owner-provided `.vctower` files used (local only; never uploaded)
