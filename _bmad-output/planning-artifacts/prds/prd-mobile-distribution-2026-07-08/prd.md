---
title: "PRD: Verticopolis Mobile Distribution (Android TWA + iOS Capacitor)"
created: 2026-07-08
updated: 2026-07-08
status: Final
inputs:
  - ../../design/game-brief-mobile-distribution-2026-07-08.md
feeds:
  - ../../design/arch-mobile-distribution-2026-07-08.md
  - ../../design/epics-mobile-distribution-2026-07-08.md
---

# PRD: Verticopolis Mobile Distribution

## Summary

Package the existing Verticopolis web game (live at https://verticopolis.com) for the Google Play Store as a Trusted Web Activity (TWA) and for the Apple App Store as a Capacitor-wrapped app, without changing gameplay. This PRD defines the functional and non-functional requirements, player journeys, done-gates, and scope boundaries. Design context and fixed decisions are in the game brief (`design/game-brief-mobile-distribution-2026-07-08.md`); technical shape lives in the paired architecture doc.

The work spans two repositories:

- **Public** (`maniator/verticopolis`, MIT): small web-side seams that make the game behave correctly inside native shells, plus assetlinks hosting. All changes are no-ops in the plain browser build.
- **Private** (`maniator/verticopolis-mobile`): the TWA and Capacitor wrapper projects, store configuration, CI pipelines, signing material references, and all later monetization content.

## Player Journeys

- **UJ-1, Android install.** A player finds Verticopolis in the Play Store, taps Install, and opens it. The game launches full screen with no browser address bar, plays identically to the website (touch build, pinch zoom, save/load), and picks up website updates automatically through the site's normal prompt-mode update flow (the new version arrives on the launch after a deploy, or when the player accepts the in-game update prompt, which appears inside the installed app).
- **UJ-2, iOS install.** A player installs from the App Store (TestFlight during this effort). The game launches full screen, works offline after install, and saves persist across launches.
- **UJ-3, iOS tower export.** A player taps Export in the game. Instead of a browser download (which does not work inside the iOS shell), the native Share sheet opens and they save or share their `.vctower` file. Import works through the standard file picker.
- **UJ-4, web player unaffected.** A browser player notices nothing: same update flow, same export download, same behavior. Zero regression.

## Functional Requirements

Feature: **Native-shell readiness (public repo)**

- **F1. Native-wrapper detection.** The web app can tell at runtime whether it is running inside a bundled native wrapper, through a single platform flag the wrapper shell sets and the browser build leaves unset. Today only the iOS shell sets it: the Android TWA deliberately runs the plain web build (that is how it stays current with the site), so the flag stays unset there.
- **F2. Service-worker gating.** In bundled native-wrapper builds (iOS), the service-worker registration and the hourly update poll (`src/pwa.ts`) do not run; those builds update through the store. The Android TWA keeps the full web update flow, service worker included, because it renders the live site.
- **F3. Export bridge.** Tower export (`.vctower`, currently the `downloadFile` blob-anchor helper in `src/ui/UI.ts`, lines 802-816 at time of writing) goes through a platform port: the browser implementation keeps the current download behavior; a native implementation can deliver the file through the platform's share/save mechanism. Import continues to work through the existing file picker on all platforms.
- **F4. External-link routing.** External links (the help modal's report-a-bug GitHub link, `src/ui/UI.ts:874` at time of writing) open through a platform hook so native shells can route them to the system browser instead of navigating the game's WebView away.

Feature: **Android TWA (private repo + one public file)**

- **F5. Verified TWA.** The Android app is a Bubblewrap-built TWA of https://verticopolis.com that passes Digital Asset Links verification, so it renders with no browser chrome. The verification file is served by the public repo at `https://verticopolis.com/.well-known/assetlinks.json`.
- **F5a. Play delivery.** CI builds a signed AAB and uploads it to the Play internal testing track. The first upload and app-record creation happen manually in the Play Console (platform requirement).

Feature: **iOS Capacitor app (private repo)**

- **F6. Store-built iOS app.** The iOS app bundles the web assets (built from a pinned public-repo tag with the native mode) inside a Capacitor shell, and is built, signed, and uploaded to TestFlight entirely by GitHub Actions macOS runners. No step requires a local Mac.
- **F6a. Native export/import.** The iOS shell registers the native implementation of the F3 export port (share sheet) and the F4 link hook (system browser).

Feature: **Versioning**

- **F7. Deterministic version mapping.** Store version identifiers derive from the public `package.json` version through one shared scheme: `code = major*1000000 + minor*10000 + patch*100 + seq`, where `seq` counts re-submissions of the same version (1.9.4 first submission = 1090400, its re-submission = 1090401, 1.9.5 = 1090500, so re-submissions never collide with future versions). Android `versionCode` and iOS `CFBundleVersion` both use the code; `CFBundleShortVersionString` and Android `versionName` use the package version. CI enforces plain three-part semver with minor/patch at most 99, checks the new code against the ledger's last upload, and fails on any violation. A version ledger in the private repo records every store upload.

## Non-Functional Requirements

- **N1. Zero browser regression.** All public-repo changes are behavior-neutral in the plain browser build; the existing e2e and visual baselines stay green without regeneration.
- **N2. Public repo stays clean.** No signing material, team or account identifiers, store metadata, or monetization content in the public repo. Two protocol-public exceptions: `assetlinks.json` and the Android application ID it names. The application ID is public by design (it ships inside every installed APK and in the assetlinks file), so planning docs may state it; everything else store-shaped lives in the private repo.
- **N3. Reproducible store builds.** Every iOS binary is traceable to an exact public-repo ref (tag or commit SHA) recorded in the version ledger. The Android TWA ships no web assets, so its traceability is the wrapper-project state plus the live deploy version recorded in the ledger at upload time.
- **N4. Secrets live only in CI.** Keystores, certificates, provisioning profiles, and API keys exist only as GitHub Actions secrets in the private repo, never in either repo's history.
- **N5. Repo conventions hold.** Quality gates (typecheck, lint, test, build) green on every public PR; each story is its own PR; version bump rules per CONTRIBUTING.md; American English; no em-dashes in new prose.

## Done-Gates

- **Android:** AAB on the Play internal testing track; installed on a real device it opens full screen with no custom-tab URL bar (asset links verified); touch, pinch, save, and export smoke tests pass.
- **iOS:** `ios-capacitor.yml` green end to end; build visible in TestFlight; real-device smoke test passes, including `.vctower` export through the Share sheet and re-import.
- Production rollout on either store is a separate human decision, out of this effort's scope.

## Non-Goals

- [NON-GOAL] Any gameplay, economy, balance, art, or audio change. Parity scope is untouched.
- [NON-GOAL for MVP] Capacitor Android. TWA is the Android path; revisit only if TWA limits bite (offline bundling, native export, Play Billing).
- [NON-GOAL for MVP] Monetization implementation. A separate, private, gated strategy phase follows this effort.
- [NON-GOAL] Store production releases, marketing assets beyond required listings, and rating certifications beyond store questionnaires.

## Platform & Policy Constraints

- Apple App Review 4.2 (minimum functionality) is the main iOS risk for wrapped web games. Mitigations: bundled assets, offline play, native share integration, honest review notes. Budget one resubmission cycle.
- Google Play requires the first AAB upload through the Console UI, and new personal accounts need 12 testers for 14 days of closed testing before production (does not affect the internal-track done-gate).
- The TWA updates live from the website while iOS snapshots per release; the stores will drift between iOS submissions. Accepted; noted in store review notes if needed.
- Play requires apps selling digital goods to use Play Billing; in a TWA that means the Digital Goods API. This constrains the later monetization phase, not this one.

## Success Metrics

- Both done-gates reached with no public-repo regression (N1) and no more than one Apple resubmission cycle.
- Counter-metric: do not optimize store readiness by forking game behavior per platform. If a platform needs different behavior, it goes through the platform port, not branches in game code.

## Human Checkpoints (out of agent scope)

1. Create the private repo `maniator/verticopolis-mobile` (this project's agent sessions lacked repository-creation permission; the owner creates it, then grants the sessions access).
2. Google Play Console account ($25 one-time) and app record; first manual AAB upload.
3. Apple Developer Program membership ($99/year), App Store Connect app record, distribution certificate, provisioning profile, and App Store Connect API key.
4. Provisioning all CI secrets listed in the architecture doc.
