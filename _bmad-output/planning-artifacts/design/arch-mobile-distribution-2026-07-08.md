---
title: "Architecture: Mobile Distribution (Android TWA + iOS Capacitor)"
game: Verticopolis (browser SimTower clone)
author: Cloud Dragonborn (Game Architect, gds agent)
date: 2026-07-08
status: Final
pairs_with: _bmad-output/planning-artifacts/prds/prd-mobile-distribution-2026-07-08/prd.md
scope: How to package the existing web game for the Play Store (TWA) and the App
  Store (Capacitor) without touching gameplay. Pairs with a PRD, not a GDD; there
  is no game design in this effort (deviation noted per repo convention).
grounds:
  - src/ui/UI.ts (downloadFile blob export :802-816; external GitHub link :874; import picker :828-838)
  - src/pwa.ts (SW registration gated on isSecureContext :94; hourly update poll + version.json fetch :98-135)
  - vite.config.ts (root "src" :44, so the effective publicDir is src/public/, already live: it serves CNAME and the PWA icons; base "./" :45; VitePWA manifest :60-84)
  - src/main.ts (audio unlock :708-711; WebGL context-loss recovery :633-636)
  - src/render/excalibur/TowerEngine.ts (unified pointer input; pinch/pan :263-268, :525-587)
  - .github/workflows/deploy-pages.yml (Pages deploy of dist/; site serves https://verticopolis.com)
  - package.json (version 1.9.4; engines node >=22.18.0)
---

# Architecture: Mobile Distribution

## 1. Two-repo topology

**Public `maniator/verticopolis` (MIT)** stays the single source of truth for all game code. It gains platform seams that are inert in the browser build, one protocol-public file (assetlinks), and the analytics client from PRD F8 (§9, the one sanctioned non-inert addition). **The private distribution repo** holds everything store-shaped: the Bubblewrap TWA project, the Capacitor iOS project, CI workflows, fastlane config, store listings and privacy answers, the version ledger, and (later, gated) monetization artifacts.

The private repo never vendors game source. Its CI checks out the public repo at the ref named in a tracked one-line `PUBLIC_REF` file (tag or commit SHA) and builds it, so the pin is declarative and every pin bump is a reviewable commit the version ledger cross-checks. A fork of this public repo cannot be made private on GitHub (fork visibility follows the public upstream), and the alternatives lose to this shape: a full-history mirror needs permanent sync care and blurs the public/private separation this repo exists to enforce, and a git submodule buys the same declarative pin at the cost of recursive-checkout plumbing for source the wrapper builds but never edits. If the monetization phase (E4 gate) ever decides on private game-code changes, a mirror can be created in minutes at that point (MIT permits it any time); nothing is lost by not carrying one until then. Note the sync question dissolves under this topology: Android is always current because the TWA renders the live site, and iOS is pinned on purpose so store builds stay reproducible snapshots.

```
private-distribution-repo/
  README.md                  what lives here and why; pointer to the public repo
  PUBLIC_REF                 one line: the public tag/SHA iOS builds pin to
  _bmad-output/              mirrors the public convention for private artifacts
  android-twa/               Bubblewrap project (twa-manifest.json + generated project)
  ios/                       Capacitor app (capacitor.config.ts, ios/App)
  store/play/  store/appstore/
  fastlane/
  .github/workflows/         build-web.yml, android-twa.yml, ios-capacitor.yml
```

## 2. The platform port (public repo, epic E1)

One tiny seam, `src/platform/`, keeps game code free of any wrapper awareness. Nothing under `src/engine/` changes (that directory stays DOM-free per CLAUDE.md). The port is available to a bundled wrapper shell in either wrapped mode, iOS or desktop (amended 2026-07-29; E3b specifies the iOS shell binding it, and no shell binds it yet); the Android TWA deliberately runs the plain web build (see §4) and never touches it.

```ts
// src/platform/types.ts (shape ratified by story E1a)
export interface PlatformPort {
  isNativeWrapper: boolean;
  saveFile(filename: string, contents: string, mime: string): Promise<void>;
  openExternal(url: string): void;
}
```

E1a fixed `saveFile` contents as a **string**, not the earlier sketch's byte array: the `.vctower` payload is text, so both sides skip an encode/decode round trip. The full cross-repo contract (strict-true flag, resolve-on-cancel, http(s)-only URLs, shell navigation-delegate duty) lives in `src/platform/types.ts`, which E3b implements against.

- **Browser default** (`src/platform/browser.ts`): `isNativeWrapper: false`, `saveFile` keeps the exact current blob-anchor download from `UI.ts:802-816`, `openExternal` keeps `target="_blank"`.
- **Native detection is a hybrid**: a Vite build mode plus a runtime global. `import.meta.env.MODE === "native"` (see §3) compiles the iOS bundle and `--mode desktop` the Electron one (both are wrapped modes, `isWrappedMode` in `src/platform`); at boot, the port checks `globalThis.__VC_PLATFORM__` (set by the wrapper shell before game scripts run, mechanism in §5) and uses it if present, else the browser default. Wrappers must consume a wrapped bundle for their platform; the runtime global is the implementation-injection channel, not a substitute for the build flag (injecting the global into a plain-mode bundle is unsupported, since the PWA layer is gated at compile time). The public repo takes **no Capacitor npm dependency**; the native implementation lives in the private repo's shell script and arrives through that global. This keeps the public dependency tree untouched and lets the wrapper evolve without public releases.
- Call sites: `UI.ts` export goes through `platform.saveFile`. The GitHub link keeps its plain anchor (`target="_blank"` + `rel="noopener noreferrer"`, asserted by existing unit tests) in browser builds; only a wrapped bundle with an injected port routes its activation through `platform.openExternal`, preserving middle-click and context-menu semantics on the web. Import stays as-is (`<input type="file">` works in WKWebView and Android; the iOS wrapper additionally declares a UTI for `.vctower`, §5).

## 3. Wrapped build modes (public repo)

`npm run build -- --mode native` produces the iOS wrapper bundle, and `--mode desktop` the Electron one (amended 2026-07-29; `isWrappedMode` in `src/platform` is the shared predicate). Both behave alike here:

- `src/pwa.ts` registration and the hourly update poll do not run (store builds update via the store or the live site; inside a wrapper the `version.json` fetch would only ever see the bundled snapshot). Gate on `import.meta.env.MODE` so the plain build is byte-identical in behavior.
- VitePWA still emits the manifest (harmless), and registration is not auto-injected (`injectRegister: false`, `vite.config.ts:62`), so SW registration lives only in `src/pwa.ts` and gating there is sufficient.
- Everything else (relative `base: "./"`, audio unlock, context-loss recovery) already works in WebViews unchanged. Note the bundle cannot be smoke-tested by opening `dist/index.html` from disk: module scripts are CORS-blocked from `file://`. Verify through a local static server; Capacitor serves through its own scheme handler, not raw `file://`.

## 4. Android pipeline: TWA (private repo, epic E2)

- **Bubblewrap** (`@bubblewrap/cli`) generates and maintains `android-twa/` from `https://verticopolis.com/manifest.webmanifest`. The TWA renders the **live site**; no web bundle ships in the AAB, and web deploys update Android players automatically.
- **Digital Asset Links**: the public repo serves `src/public/.well-known/assetlinks.json` (Vite's `root` is `src`, so the effective publicDir is `src/public/`, copied into `dist/` root; this passthrough is already proven live by the CNAME and icon files it serves). Content: package name (`io.github.maniator.verticopolis` unless the user prefers a domain-based ID) + the SHA-256 fingerprint of the signing key. Fingerprints are public by protocol design; this file is the single public exception to the private-repo rule. Until it is live and propagated, the app runs but shows Custom Tab chrome; that is the failure mode to test for.
- **Signing**: one upload keystore generated once. Enroll in **Play App Signing** (mandatory here, it is the recovery path if the upload key is lost), which means assetlinks must carry the **Play-provided** signing key fingerprint, read from the Play Console after the app record exists (plus the upload key's fingerprint for local installs). Because that fingerprint only exists after app-record creation and enrollment, the assetlinks PR (E2b) comes after that user checkpoint, not before. The keystore lives in CI secrets for builds AND in an offline escrow held by the owner (password manager or equivalent); GitHub secrets are write-only and are not a backup.
- **CI** (`android-twa.yml`): ubuntu runner, JDK 17, Bubblewrap build → signed AAB with versionCode from §6 (with the ledger monotonicity check) → upload to the Play **internal** track via a service-account JSON secret. Any third-party upload action (e.g. `r0adkll/upload-google-play`) is pinned to a commit SHA; it handles a credential that can publish builds. First upload and app-record creation are manual in the Play Console (platform rule).

## 5. iOS pipeline: Capacitor (private repo, epic E3)

- **Assets are bundled rather than loaded remotely.** CI builds the public repo at a pinned ref with `--mode native`, copies `dist/` into the Capacitor `webDir`, then `npx cap sync ios`. Bundling gives offline play and materially lowers Apple 4.2 (minimum functionality) rejection risk versus a thin remote wrapper. The public repo currently has no tags; E1d establishes the convention (annotated `v{package.json version}` tag on the merge commit that completes E1), and until a tag exists CI pins by commit SHA, which the ledger records either way.
- **Plugins**: `@capacitor/filesystem` + `@capacitor/share` (implement `saveFile`: write to cache dir, open the Share sheet), `@capacitor/browser` (`openExternal`), `@capacitor/status-bar` (match the black-translucent styling already declared in the web meta tags). The shell script registers these behind `globalThis.__VC_PLATFORM__` before the game boots (§2), so the public bundle stays Capacitor-free.
- **Shell injection mechanism** (this is the piece that makes §2 work): the private repo builds a small `native-shell.js` that bundles the plugin code and sets `__VC_PLATFORM__`; the CI sync step post-processes the copied `dist/index.html` to insert `<script src="./native-shell.js"></script>` ahead of the game's module scripts. The public build emits no reference to it; the patch step owns the ordering guarantee.
- **`.vctower` UTI**: the Xcode project's Info.plist declares an imported document type for the `.vctower` extension so the iOS document picker allows selecting exported towers; without it the picker greys the files out and import cannot round-trip.
- **Icons/splash** generate from the existing PWA 512 maskable art.
- **CI** (`ios-capacitor.yml`): `macos-14` runner; import the distribution certificate (`.p12` secret) into a temp keychain, install the provisioning profile secret, `xcodebuild archive` + `-exportArchive` (app-store method), upload to TestFlight with fastlane `pilot` using an App Store Connect API key. fastlane is preferred over raw `xcrun` because it owns keychain setup, export options, and upload retries in one Fastfile. No step touches a local Mac.

## 6. Version mapping

- One scheme for both stores: `code = major*1000000 + minor*10000 + patch*100 + seq`, where `seq` (0-99) counts re-submissions of the same package version, starting at 0 and recorded in the ledger. 1.9.4 first submission = 1090400; a 1.9.4 re-submission = 1090401; 1.9.5 = 1090500, so re-submissions can never collide with future versions. CI validates the version is a plain three-part semver with minor and patch at most 99 (prereleases are not shippable) and fails otherwise; Play's versionCode ceiling (2100000000) allows majors up to 2099.
- Android `versionCode` = the code; `versionName` = the package version (suffixed `.seq` when seq > 0). Before uploading, CI reads the ledger's last uploaded code and fails unless the new code is strictly greater. Because the TWA ships no web assets, its versionName tracks the wrapper project; the ledger records the live deploy's version alongside each Android upload for traceability.
- iOS `CFBundleShortVersionString` = package version; `CFBundleVersion` = the same code. One scheme only: App Store Connect requires strictly increasing build numbers per version string, so no run-number or other alternative numbering is ever mixed in.
- A `store/version-ledger.md` in the private repo records every upload: date, public ref (tag or commit SHA), code, seq, track, outcome. CI appends to it or fails loudly when it cannot.

## 7. Secrets inventory (private repo, GitHub Actions secrets only)

Android: `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`, `PLAY_SERVICE_ACCOUNT_JSON`.
iOS: `IOS_DIST_CERT_P12_BASE64`, `IOS_DIST_CERT_PASSWORD`, `IOS_PROVISIONING_PROFILE_BASE64`, `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_API_KEY_P8_BASE64`, `APPLE_TEAM_ID`.
Nothing from this list ever appears in either repo's files or history; the PRD's N4 makes this a review-blocking rule.

## 8. Update-model asymmetry (accepted)

The TWA serves the live site, so Android players always run the newest deploy. iOS is a snapshot per submission. The stores will drift between iOS releases; that is acceptable for a single-player game whose saves live client-side. The private repo's release checklist should pair a public tag with an iOS submission whenever player-facing changes accumulate.

## 9. Analytics seam (public repo, story E1e; PRD F8)

- **Client**: a cookieless Plausible/Umami class client, bundled with the game (never CDN-loaded), sending anonymous aggregate events only. Tool and hosting chosen in the story; self-hosting on the game's origin is preferred (browser-sense first-party, dodges most ad blocking). If self-hosted, the hosting/ops config lives in the private repo.
- **Endpoint configuration**: an absolute URL (relative paths break under the Capacitor scheme), read from a Vite define/env value. The endpoint and site identifier are public configuration, not secrets (the third public-by-design exception in PRD N2), but because their presence IS the enable signal they are never committed as active defaults: the repo's checked-in state compiles with analytics disabled, and live values are injected only by the shipping contexts (the Pages deploy workflow and the private repo's native build) or an explicit local validation opt-in. The existing CI jobs (tests, e2e, screenshot workflows) therefore keep running `npm run build` unchanged and can never pollute production metrics; the deploy contexts assert the values are present before shipping, so a dead integration cannot reach players silently.
- **Environment gating**: the enable signal is the presence of the deploy-supplied endpoint configuration itself, NOT `import.meta.env.PROD` (which is true for any local `npm run build` and would leak local builds into production data). A bundle compiled without the values has analytics disabled, period; only the contexts that deliberately inject them (the Pages deploy workflow, the private repo's native store build, or an explicit validation opt-in) produce a sending build. Ad-blocked and offline sessions degrade silently.
- **Platform dimension**: `ios` when the §2 port reports `isNativeWrapper`, `twa` when the start URL's query parameter is present (the E2a story owns overriding the Bubblewrap `twa-manifest.json` start URL to carry it; the web manifest's own `start_url` is `./` and carries nothing), `web` otherwise. Known gap (2026-07-29, issue #710): the flag is available to both wrapped modes, so a desktop wrapper session that bound a port would resolve to `ios`. Nothing is reported from a wrapped build today because the telemetry gate is closed for them, and the vocabulary is settled when desktop analytics is designed. Milestone events hook only existing UI/controller-layer notifications; nothing under `src/engine/` is instrumented.
- **Store-declaration coupling**: once the Android app is on any Play track, the deploy that enables collection is gated on the Play Data Safety form already declaring this posture (the TWA renders the live site, and the form must stay accurate at all times). Apple's nutrition labels describe it as anonymous usage data, not linked to identity, no tracking, no ATT.

## 10. What this architecture refuses to do

- No Capacitor Android now (TWA covers Android; one store listing, one approach).
- No forked game behavior per platform outside the port in §2 (PRD counter-metric).
- No engine changes; `src/engine/` remains DOM-free and untouched.
- No monetization plumbing anywhere until the gated strategy phase concludes.
