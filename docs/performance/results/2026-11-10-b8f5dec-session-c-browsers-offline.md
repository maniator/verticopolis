# Session C: offline PWA, update, browsers and throttled pass, 2026-11-10

**Snapshot of 2026-11-10, not refreshing.** The live checks are the specs named below and CI. The raw logs, JSON and screenshots are in [verticopolis-benchmarks](https://github.com/maniator/verticopolis-benchmarks/tree/main/results) (private repository) under `2026-11-10-b8f5dec-session-c-d`.

- Commit `b8f5dec` (app 3.0.0), clean tree, a `VC_TOOLING=1` build served by `vite preview` (the specs need the `window.game` handle; a production build compiles it away).
- Machine: Windows 11, Ryzen 5 5600X, RTX 3060. Browsers: Playwright's Chromium 149.0.7827.55, Firefox 151.0, WebKit 26.5. **Playwright's WebKit is a stand-in, not Safari.**
- What this is not: an install of the app as a Windows app with the operating system's network switched off, a human listening to the sound, or an update from an older production deployment of a real release. The browser, service worker, caches and offline state are real; the install and the network cut are Playwright's. Those three checks stay with the owner or with session E.

## C1 and C2, C3: the repo's offline specs on the PC

`npx playwright test` with `--retries 0` on `e2e/offline.spec.ts`, `offlineColdStart.spec.ts`, `offlineUpdate.spec.ts`, `engineRepair.spec.ts`, `engineRepairDeployments.spec.ts`, `engineInstall.spec.ts`, `engineIntegrity.spec.ts`, `engineEviction.spec.ts`, `saveRoundTrip.spec.ts`, `engineIdentity.spec.ts` and `wasmOnly.spec.ts`: **49 passed, 0 failed, 0 skipped, 2.1 minutes.** The ones that answer the checklist:

- A fresh offline browser session, after one online visit, opens the game on the WASM engine, runs the clock and plays today's sounds (`offlineColdStart`). A tower saved online loads in a fresh offline session, runs, saves and reloads.
- An installed game starts the WASM engine on its first reload offline, keeps playing after the network drops, and plays its sounds offline after the first gesture (`offline`). The spec checks that audio started and came from the worker's cache; it is not a listening check.
- An update replaces the engine files in the cache and the updated game plays with no network (`offlineUpdate`). A worker with the same engine bytes does not trust entries stored under the old keys.
- An evicted binary with no network fails with its own reason and the next online reload refills it; it is never refilled with another build's bytes; a lost precache with no network does not load a mismatched game (`engineEviction`, `engineIntegrity`, `engineRepair*`).
- The engine identity and status specs (`engineIdentity`) pass, and `wasmOnly` shows no TypeScript fallback.

## C4: Firefox and WebKit

There is no Firefox or WebKit project in the Playwright config, so this is a script (`data/d1.mjs` in the benchmarks folder) that runs the nine real saves of session D in each browser. In all three browsers every save gave the same engine (`wasm`), the same import report, and the same money, star, population, day, game minutes and room count as Chromium. The `.TDT` exports have the same byte size in all three (for example TOWER1 238,451 bytes). The `.vctower` files differ by a few bytes between browsers (TOWER1: 76,782 in Chromium, 76,778 in Firefox and WebKit), which fits each browser's own compression; every re-import still reproduced the state. No trap and no engine failure screen in any browser.

## C5: CPU-throttled Chromium

With Chromium's 4x CPU throttle (DevTools protocol) the largest real save, TOWER4 (3,293 people), ran at speed 3 for 3,039 game minutes (more than two game days) in 35 seconds. No engine failure text appeared and the engine status read `wasm`, hosted, no error, no fallback. This is not the 17,314-person performance fixture, which exists only as generated code.

## Not run

The basement-sale check of the original game (session A) was not run: the harness is ready but its placement driving is unreliable without an interactive session.
