# Live-production validation supplement — evidence bundle

Companion to PR #536 (full repository audit 2026-07-21). Produced 2026-07-21 on the
owner's Windows 11 PC (Ryzen 5 5600X, RTX 3060, Chrome 150 stable, 75 Hz display),
driving the live origin https://verticopolis.com (deployed 1.71.0 @ aaea605, which
equals the audit baseline). Testing window ~21:15-22:15 UTC: analytics sessions in
that window are validation traffic, not organic players.

## Layout

- `production-validation-supplement.md` — the report. Read this first; every claim
  cites a raw file below.
- `raw/`
  - `s1-baseline.json` — deployed version/SHA, response headers, SW registration,
    cache inventory, GPU renderer string, display refresh rate
  - `s2-smoke.json` — smoke flows part 1. NOT INCLUDED in the committed bundle
    (the owner's export omitted it); its valid steps (through slot save) were
    re-run and superseded by `s2b-smoke2.json`, which is committed and complete.
    The screenshot `s2-harness-aborted-at-export-step.png` records where the
    partial run stopped.
  - `s2b-smoke2.json` — smoke part 2: export/import round trip, AUD-010 quota
    injections (both save sites), Modern founding, dialog Tab trace
  - `s2b-exported.vctower` / `s2b-exported.TDT` — export artifacts from the
    throwaway test tower (not owner data)
  - `s3-a11y.json`, `s3-axe-{splash,ingame,help}.json`,
    `s3-{desktop,touch}-collectors.json` — accessibility evidence
  - `s4-sw-offline.json` — service worker / offline / recovery / update-check record
  - `s5-perf.json` — real-GPU frame-time distributions per run (fresh tower,
    towerone_4 11,875u, sixseven_8 20,155u, sixseven_15 25,217u, plus
    congestion-overlay and speed-3 variants on sixseven_15)
  - `s6-final-checks.json` — /?src=twa analytics observation, #stat-money
    contrast computation (3.53:1)
- `screenshots/` — labeled captures per phase (s1-*, s2-*, s3-*, s4-*, s5-*)
- `scripts/` — the exact Playwright harness that produced everything (runs the
  installed Chrome, channel "chrome", headed)

## Not included

- The owner's real `.vctower` save files (private; used locally for the perf
  measurements, never uploaded). The perf JSON records their unit/pop counts.
- The persistent Chrome profile used for SW testing (browsing data).

## Headline results for the audit session

- Nothing contradicts the audit; no evidence blocks merging PR #536.
- Confirmed live: AUD-010 (both save sites, uncaught QuotaExceededError, zero
  feedback), AUD-021 modal half (real mutation under an open dialog), AUD-025
  (18x15 px modal close button), AUD-020, AUD-026, AUD-036 observable half.
- H-1 answered: 25,217-unit save runs ~37.5 FPS median at normal speed on this
  desktop (not the container's 2 FPS); CPU-bound scaling confirmed; speed 3 is
  the pain point (25 FPS, ~45% main-thread busy). Real-hardware "before"
  baselines for #338 are in s5-perf.json.
- SW/offline fully validated; cross-version update handoff untested (no deploy
  occurred; not simulated).
- New minor findings PROD-001..005 (report section 15), best routed into #541
  (tower-name label, stat-money contrast) and #540 (precache duplicate icons).

Caution for local reruns: the harness scripts create Chrome profile directories
(`profile/`, `profile-tmp-*/`) beside this README; they can contain browsing data
and are gitignored here so they cannot be committed by accident. The committed
bundle is a frozen record; reruns are at your own risk and their outputs should
not overwrite the committed raw files.
