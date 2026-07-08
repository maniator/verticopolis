---
title: "Game Brief: Verticopolis Mobile Distribution"
status: Final
created: 2026-07-08
updated: 2026-07-08
feeds: ../prds/prd-mobile-distribution-2026-07-08/prd.md
note: >
  Distribution brief, not a design brief. The game itself does not change.
  Kept in design/ (flat dated file) alongside the arch and epics docs for this
  slug rather than a briefs/ workspace folder, matching the repo's dated-triad
  convention. Produced headless; all decisions were fixed in an approved plan,
  so decisions are recorded inline below instead of in a sidecar log.
---

# Game Brief: Verticopolis Mobile Distribution

## Executive Summary

Verticopolis is a finished, playable, browser-native SimTower clone (TypeScript on Excalibur.js, built with Vite) live at https://verticopolis.com. This brief does not propose a new game or any design change. It scopes a distribution effort: put the existing web game in the Google Play Store and the Apple App Store so players can find and install it the way they find and install everything else on their phones.

The codebase is unusually ready for this. Touch input with pinch-zoom and two-finger pan, responsive phone and tablet layouts, coarse-pointer fallbacks for hover UI, audio unlock on first gesture, WebGL context-loss recovery, and a complete PWA manifest are all already shipped and tested in the browser. What remains is packaging: an Android Trusted Web Activity (TWA) that ships the live site through the Play Store, an iOS Capacitor wrapper that bundles the web build for the App Store, and a small set of web-side seams (file export, external links, service-worker gating) so the same code behaves correctly inside native shells.

Gameplay parity scope is unchanged. No new mechanics. The single source of truth for game behavior remains SimTower 1994 and the existing engine. The gds `primary_platform` stays pinned to web.

## Vision

One sentence: players install Verticopolis from the app store on their phone and get the exact same tower game the web already delivers, full screen, offline-capable on iOS, always current on Android.

The core fantasy is unchanged (build and run a living tower). The distribution promise is: one-tap store install, no browser chrome, and no drift between what the web player and the store player experience.

## Why Stores, Why Now

- Discoverability: store search is where casual sim players look; a URL is not.
- Install friction: "Get" on a store listing beats "add to home screen" education.
- Credibility: a store listing signals a finished game, which Verticopolis is (v1.9.4, deep parity work done).
- Readiness: the mobile-web groundwork (touch, gestures, responsive UI) is already merged, so packaging cost is low and mostly one-time.

## Fixed Decisions (recorded inline, from the approved plan)

1. Android ships first as a TWA built with Bubblewrap against https://verticopolis.com. Capacitor Android is deliberately deferred and only revisited if TWA limits bite (offline bundling, native export, Play Billing).
2. iOS ships as a Capacitor wrapper with the web assets bundled (not loaded remotely), built and signed entirely on GitHub Actions macOS runners. No local Mac is assumed anywhere in the pipeline.
3. A private distribution repo holds the wrapper projects, store configs, CI workflows, and all later monetization material. The public MIT repo stays free of store identifiers and monetization content. One public exception: `/.well-known/assetlinks.json` served from verticopolis.com, which is public by protocol design.
4. Monetization is a separate, later phase (strategy first, private repo only, user sign-off gate before any implementation).

## Target Players & Market

Same audience the web game already serves: simulation and tycoon players, nostalgic SimTower/Yoot Tower fans, and casual builders who play in 10 to 40 minute sessions. The store release targets the subset who live on phones and tablets and would never open a browser game. Market context: the vertical-building tycoon niche on mobile is thin (Project Highrise ports, idle-tower clones of much lower simulation depth), so an authentic SimTower experience has clear positioning without any design change.

## Scope & MVP

- Platforms, prioritized: 1) Android (TWA, Play internal testing track), 2) iOS (Capacitor, TestFlight). Web remains the primary platform and source of truth.
- MVP Android: AAB on the Play internal testing track, Digital Asset Links verified (no browser chrome on device), touch/pinch/save/export smoke test passing. The only web-side change Android needs is publishing the assetlinks file; the TWA runs the plain web build.
- MVP iOS: build in TestFlight, on-device smoke test passing including tower export through the native Share sheet and re-import.
- Web-side work is limited to four seams, all no-ops in the plain browser build: a small platform port for file export and external links, service-worker gating in native builds, a `--mode native` Vite build, and assetlinks hosting.
- Team: Claude dev agents working the repo's BMGD story workflow, with human checkpoints for store accounts, first uploads, and secrets.

## Out of Scope

- Any gameplay, economy, balance, art, or audio change.
- Capacitor Android (deferred; decision revisited only after TWA ships).
- Monetization implementation of any kind (strategy phase comes later and is gated).
- Store production releases; the done-gates for this effort are internal testing (Play) and TestFlight (Apple). Production rollout is a separate human decision.

## Risks & Open Questions

- Apple 4.2 (minimum functionality) rejection risk for wrapped web games. Mitigations: bundled assets, offline play, native Share integration, honest review notes. First submission may still bounce; plan for one resubmission cycle.
- Play's new-personal-account rule (12 testers for 14 days of closed testing before production) stretches the Android timeline beyond the internal-track done-gate. Known, accepted.
- TWA live-updates from the website while iOS is a snapshot per release, so the two stores will drift between iOS submissions. Accepted and documented.
- Store accounts (Play Console, Apple Developer Program) do not exist yet as far as this effort knows; they are human-only prerequisites.
- versionCode discipline across Play uploads needs a ledger in the private repo; the derivation rule alone breaks on same-version re-releases.

## What Comes Next

This brief feeds `gds-prd` (PRD at `prds/prd-mobile-distribution-2026-07-08/prd.md`), then `gds-game-architecture` and `gds-create-epics-and-stories` for the same slug. A GDD is deliberately skipped: there is no game design content in this effort, and a GDD would be padding.
