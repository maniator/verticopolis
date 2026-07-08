---
title: "Epics & Stories: Mobile Distribution (Android TWA + iOS Capacitor)"
game: Verticopolis (browser SimTower clone)
date: 2026-07-08
status: Ready for development
pairs_with:
  - ../prds/prd-mobile-distribution-2026-07-08/prd.md
  - arch-mobile-distribution-2026-07-08.md
note: >
  Pairs with a PRD, not a GDD (deliberate deviation; this effort has no game
  design content, see the PRD decision log). Each public-repo story is its own
  PR: quality gates (typecheck/lint/test/build) + the review skill named per
  story + package.json version bump per CLAUDE.md. E2/E3 stories live in the
  private distribution repo; same story-per-PR discipline.
  Acceptance criteria cite PRD requirement IDs; this file is the sequencing +
  change map.
---

# Epics & Stories: Mobile Distribution

**Merge order:** Public stream: E1a → E1b → E1c → E1d (E1d ends by tagging main, the repo's first release tag; E3 pins to it). E1e (analytics) lands any time after E1a, with one hard ordering rule: once the Android app is on any Play track, the Play Data Safety form must declare the F8 posture BEFORE an E1e deploy reaches the live site, because the TWA starts collecting the moment the deploy lands and Play requires the form to be accurate at all times. For iOS, E1e must be inside the ref the build pins to (before the E1d tag, or via a later tag and `PUBLIC_REF` bump). If E1e is not yet live for a given submission, E2d/E3d declare "no data collected" and update the form first when E1e later ships. Android stream, independent of E1a-E1c: E2a → app record + Play App Signing enrollment (user checkpoint) → E2b → E2c → E2d. iOS stream, after the E1d tag: E3a → E3b → E3c → E3d. E2 and E3 run in parallel.
The TWA renders the live site and consumes none of E1a-E1c, so E2a can start immediately; E2b waits for the Play-provided signing fingerprint, which only exists after the app record and Play App Signing enrollment (arch §4). iOS consumes all of E1.

**Repo split:** E1 = public `maniator/verticopolis`. E2, E3, E4 = the private distribution repo (E2b is a public-repo PR driven by the E2 stream). E4 is a strategy gate, not an implementation epic.

---

## E1: Web-side native readiness (public repo)

### E1a: Platform port  ·  risk: low  ·  version: none (internal; browser behavior identical per N1)
- **Change:** add `src/platform/` port + browser default (arch §2): `isNativeWrapper`, `saveFile`, `openExternal`; route the `.vctower` export (`UI.ts:802-816`) and the GitHub link (`UI.ts:874`) through it. Runtime global `__VC_PLATFORM__` checked at boot; no Capacitor dependency.
- **AC:** PRD F1, F3, F4, N1. Browser behavior byte-identical (export still downloads, link still opens a tab); unit tests cover port fallback order.
- **Review:** `/gds-code-review` (UI plumbing near gameplay).
- **Unblocks:** E1b, E1c, E3b.

### E1b: PWA gating in native builds  ·  risk: low  ·  version: none (internal)
- **Change:** gate `src/pwa.ts` SW registration + hourly update poll behind the native flag (arch §3); plain build untouched.
- **AC:** PRD F2, N1. `--mode native` bundle registers no SW; default build unchanged (e2e green without baseline regen).
- **Depends:** E1a.
- **Review:** `/bmad-code-review` (storage/plumbing).

### E1c: Native build mode  ·  risk: low  ·  version: none (internal)
- **Change:** wire `--mode native` (arch §3), document `npm run build:native`; verify the native bundle through a local static server (module scripts are CORS-blocked from `file://`, so a disk-open check is invalid; Capacitor serves through its own scheme handler).
- **AC:** PRD F1, F2, N3. Both bundles build green; mode differences limited to the platform seams.
- **Depends:** E1b.
- **Review:** `/bmad-code-review` (build tooling).

### E1d: Distribution docs + release tag  ·  risk: low  ·  version: none (docs/infra)
- **Change:** add `docs/distribution.md` documenting the assetlinks mechanism (Vite's `root` is `src`, so `src/public/` is the effective publicDir, already proven live by the CNAME and icon files it serves; git cannot track an empty `.well-known/` directory, so the directory arrives with the real file in E2b) and the native build mode; project-context addendum (already landed with the planning PR if merged there). After merge, create the repo's first release tag: annotated `v{package.json version}` on the merge commit that completes E1 (E3 pins builds to it; the ledger records it).
- **AC:** PRD F5 (mechanism documented), N2, N3. Docs merged; the passthrough is confirmed by existing files being reachable at `https://verticopolis.com/` root; the tag exists and E3a can pin to it.
- **Review:** `/bmad-code-review`.

### E1e: Privacy-first analytics  ·  risk: low  ·  version: none (invisible to players; privacy posture documented)
- **Change:** integrate a cookieless, privacy-first analytics client per PRD F8 and arch §9 (Plausible/Umami class; tool and self-host decision made in the story, self-hosting on the game origin preferred): bundled script (not CDN-loaded), absolute endpoint URL, anonymous aggregate events only (app opens, session length, a small set of gameplay milestones), platform dimension (`ios` from the E1a flag, `twa` from a Bubblewrap start-URL query parameter, `web` otherwise). Milestone events hook only existing UI/controller-layer notifications; no engine or simulation instrumentation. No cookies, no stored personal identifiers, no consent banner, no App Tracking Transparency prompt; the story defines IP/user-agent handling per PRD F8 (transient processing only, self-hosted access logs disabled or IP-anonymized). Dev, test, and CI send nothing by default, with an explicit opt-in for local validation. If self-hosted, hosting config goes to the private repo. Document the posture in `docs/distribution.md` (or a privacy note the store stories can cite).
- **AC:** PRD F8, N1 (beacons only; no gameplay, UI, or storage behavior change; e2e and visual baselines untouched), N5. Events visible in the backend from an explicitly opted-in preview or staging run (or a local run with the opt-in set and the tool's localhost guard disabled); without the opt-in, every non-production run (dev, test, CI, preview, staging) sends nothing. Adblocked and offline sessions degrade silently: no uncaught errors (the browser's own blocked-request log lines are expected), no gameplay effect.
- **Depends:** E1a (platform flag). Sequencing relative to E2d/E3d per the merge-order note above; once the Android app is on any Play track, the deploy that enables collection is gated on the Data Safety form already declaring the F8 posture.
- **Review:** `/bmad-code-review` (plumbing; milestone hooks stay in the UI layer). If a milestone needs a hook beyond the UI/controller layer, the story escalates to `/gds-code-review`.

---

## E2: Android TWA (private repo; E2b is a public PR)

### E2a: Bubblewrap project + signing identity  ·  risk: med  ·  version: n/a (private)
- **Change:** `bubblewrap init` against `https://verticopolis.com/manifest.webmanifest` into `android-twa/`; applicationId `io.github.maniator.verticopolis` (user may override); generate upload keystore once, store as CI secrets (arch §7) AND in the owner's offline escrow (arch §4: GitHub secrets are write-only, not a backup); extract the upload key's SHA-256 fingerprint.
- **AC:** PRD F5 (app half). Local `bubblewrap build` produces an installable APK/AAB.
- **Review:** `/bmad-code-review` (tooling).
- **STOP-for-user:** Play Console account; keystore secret provisioning + offline escrow; then app record creation and Play App Signing enrollment (E2b needs the Play-provided fingerprint from the Console).

### E2b: Publish assetlinks.json (public-repo PR)  ·  risk: low  ·  version: none (infra)
- **Change:** add `src/public/.well-known/assetlinks.json` with package name + fingerprints (the Play App Signing key's, read from the Play Console after enrollment, plus the upload key's from E2a for local installs; arch §4).
- **AC:** PRD F5. File live at `https://verticopolis.com/.well-known/assetlinks.json` after deploy; Play asset-links tester passes; on-device app shows no Custom Tab chrome.
- **Depends:** E1d, E2a, and the app-record/enrollment user checkpoint.
- **Review:** `/bmad-code-review`.

### E2c: Android CI  ·  risk: med  ·  version: n/a (private)
- **Change:** `android-twa.yml` (arch §4): JDK 17 + Bubblewrap, keystore from secrets, versionCode per arch §6 (seq scheme + ledger monotonicity check that fails the build on a non-increasing code), upload action pinned by commit SHA, AAB upload to Play internal track via service-account secret; append to `store/version-ledger.md`.
- **AC:** PRD F5a, F7, N3, N4. Green run uploads to internal track (after the manual first upload).
- **Review:** `/bmad-code-review` (CI).
- **STOP-for-user:** first manual AAB upload in Play Console; service-account creation.

### E2d: Play listing + data safety  ·  risk: low  ·  version: n/a (private)
- **Change:** `store/play/`: listing copy, screenshots plan (reuse docs/screenshots pipeline output), data-safety questionnaire answers reflecting the F8 analytics posture (anonymous aggregate usage data, not linked to identity, no tracking; saves are local; if E1e is not yet on the live site, answer "no data collected", and when E1e later ships, update the form BEFORE the deploy that enables collection, since the TWA picks it up immediately with no new AAB involved and the form must stay accurate at all times), content rating notes.
- **AC:** Play done-gate (PRD Done-Gates): AAB on internal track, device smoke test (touch/pinch/save/export, plus the in-app update prompt appearing after a site deploy) passes.
- **Review:** `/bmad-code-review` (store copy/docs).

---

## E3: iOS Capacitor (private repo; depends on E1 tagged)

### E3a: Capacitor project init  ·  risk: med  ·  version: n/a (private)
- **Change:** `ios/` Capacitor app (arch §5): config, plugins (Filesystem, Share, Browser, StatusBar), icons/splash from the PWA 512 art; Info.plist imported document type for `.vctower` (without it the iOS picker greys out exported towers); `webDir` filled from the pinned public ref (E1d tag) built `--mode native`.
- **AC:** PRD F6 (project half). `npx cap sync ios` clean; app boots in Simulator via CI build logs (no local Mac).
- **Review:** `/bmad-code-review` (tooling).

### E3b: Native bridge shell  ·  risk: med  ·  version: n/a (private, but reviewed as game-facing)
- **Change:** build `native-shell.js` (bundles the `@capacitor/*` plugin code, sets `globalThis.__VC_PLATFORM__`): `saveFile` = Filesystem write + Share sheet; `openExternal` = Browser plugin. The CI sync step post-processes the copied `dist/index.html` to load it ahead of the game's module scripts (arch §2, §5: the patch step owns the ordering guarantee).
- **AC:** PRD F6a, UJ-3. Export opens the Share sheet with a valid `.vctower`; re-import round-trips; GitHub link opens system browser.
- **Depends:** E1a (port shape), E3a.
- **Review:** `/gds-code-review` (game-facing behavior).

### E3c: iOS CI  ·  risk: high  ·  version: n/a (private)
- **Change:** `ios-capacitor.yml` (arch §5): macos-14, temp keychain from cert/profile secrets, xcodebuild archive/export, fastlane pilot upload via ASC API key; version mapping per arch §6 (shared code scheme + ledger monotonicity check); ledger append.
- **AC:** PRD F6, F7, N3, N4. Green end-to-end run; build visible in TestFlight.
- **Review:** `/bmad-code-review` (CI).
- **STOP-for-user:** Apple Developer enrollment, ASC app record, cert/profile/API-key creation, secret provisioning.

### E3d: App Store metadata + review notes  ·  risk: med (4.2 risk lives here)  ·  version: n/a (private)
- **Change:** `store/appstore/`: metadata, privacy nutrition labels reflecting the F8 analytics posture (anonymous aggregate usage data, not linked to identity, no tracking, so no ATT prompt; "no data collected" only if E1e has not shipped in the submitted build), reviewer notes addressing 4.2 (bundled assets, offline play, native share).
- **AC:** iOS done-gate (PRD Done-Gates): TestFlight build, real-device smoke test incl. Share-sheet export + import.
- **Review:** `/bmad-code-review` (store copy/docs).

---

## E4: Monetization strategy gate (private repo; blocked by E2 + E3 done-gates)

Not an implementation epic. Runs `bmad-market-research` → `bmad-product-brief` in the private repo per the PRD's Non-Goals and Platform & Policy constraints; ends at a user go/no-go sign-off. No monetization content in the public repo, ever; any future public hooks are generic and separately approved.
