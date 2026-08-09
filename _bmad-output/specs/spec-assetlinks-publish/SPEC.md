---
title: Publish assetlinks.json for the Android TWA
slug: assetlinks-publish
status: ready
routes_to: /bmad-code-review
repo: public (verticopolis), deployed on Vercel
baseline: 2.22.0
companions: []
sources:
  - _bmad-output/planning-artifacts/prds/prd-mobile-distribution-2026-07-08/prd.md
  - _bmad-output/planning-artifacts/design/arch-mobile-distribution-2026-07-08.md
  - _bmad-output/planning-artifacts/design/epics-mobile-distribution-2026-07-08.md
---

# Publish assetlinks.json for the Android TWA

## Why

`https://verticopolis.com/.well-known/assetlinks.json` returns 404, so no Android
build can ever prove it owns the domain. Without that proof a Trusted Web Activity
still runs, but Chrome renders it with a Custom Tab address bar across the top: it
reads as a browser window someone dressed up rather than an app. The file is the whole
difference, and every other piece of the Android path already exists (the Bubblewrap
project definition, the package name, the `?src=twa` analytics marker).

Nothing here is a new decision. PRD F5 already commits the public repo to serving
this file, PRD N2 already lists it and the Android application ID as the two
protocol-public exceptions, and the architecture fixes the path. This spec exists to
land it, and to record one thing the original plan did not: how to unblock a
sideloaded test build months before the Play Console record exists.

## Capabilities

**CAP-1: Digital Asset Links verification.**
Intent: Android can confirm that `io.github.maniator.verticopolis` speaks for
verticopolis.com, so a TWA of the site renders with no browser chrome.
Success: the URL returns 200 with `Content-Type: application/json`; Google's asset
links tester passes for that package name; a sideloaded APK signed with the listed
key shows no Custom Tab bar.

**CAP-2: honest manual verification.**
Intent: a person checking the file in a browser sees the file.
Success: opening the URL in a tab already controlled by the service worker returns
the JSON rather than the game shell, matching how `version.json`, `robots.txt` and
`sitemap.xml` already behave.

**CAP-3: the file cannot silently disappear.**
Intent: the build fails loudly if the file stops reaching `dist/`, rather than
shipping a site whose Android app quietly degrades to a browser bar.
Success: a check in the `verify:dist` chain asserts the built file exists, parses,
and carries the package name with at least one well-formed fingerprint; setting
`copyPublicDir: false` or moving Vite's `root` turns the build red.

## Constraints

- **The Play App Signing fingerprint cannot be included yet.** It only exists after
  the Play Console app record and enrollment (arch line 72), which is why the
  original E2b was sequenced after that checkpoint. `sha256_cert_fingerprints` is an
  array precisely so the Play fingerprint can join later without touching anything
  else. This is what lets the two stop blocking each other.
- **The one fingerprint shipping today belongs to a sideload key** held only on the
  owner's machine, never committed to either repository.
  Listing it means any app signed with that key is trusted to act as a verified TWA
  for the domain. Accepted as reversible and low-risk while the key stays on one
  machine; **it must be removed at store launch**, once the Play fingerprint is in.
  If the keystore is ever lost or leaked, the fix is to drop the entry and redeploy.
- **No build, hosting, or packaging change is required to deliver the file.** Vite's
  `root` is `src` and `publicDir` therefore defaults to `src/public/`; Vite 7.3.6's
  `copyDir` is a bare `readdirSync` recursion with no dotfile filter, so
  `.well-known/` is copied verbatim. `vercel.json` sets `framework: null` and
  `outputDirectory: dist` with no SPA catch-all, so the path is served as a static
  file with `application/json` inferred. Do not add hosting rules for it.
- **Git cannot track an empty directory**, so `.well-known/` arrives with the file in
  the same commit (epics line 49).
- **No version bump and no CHANGELOG player note.** Nothing a web player observes
  (CONTRIBUTING line 298; epics line 69 marks E2b `version: none (infra)`).
- **The file must not be precached.** Verification has to read what is live. Workbox
  `globPatterns` already exclude `json`, so this holds with no exclusion entry; do
  not add one that would change it.
- **Vercel Deployment Protection must never cover this path on production.** It
  answers every request with a 302 to `vercel.com/sso-api`, `/robots.txt` and
  `/version.json` included, and Google's verifier fetches anonymously. Turning it on
  for the production domain would silently break Android verification, and the app
  would degrade to a browser bar with nothing in this repository changing. Production
  is unprotected today; anyone enabling it must exempt `/.well-known/`.

## Non-goals

- **Building, signing, or publishing the Android app.** This spec puts the
  verification file in place. Bubblewrap builds, the Play Console record, the upload
  keystore, and store listing copy all stay where they are.
- **Adding the Play App Signing fingerprint.** Blocked on a checkpoint only the owner
  can clear; the array is the seam it arrives through.
- **Hosting configuration.** Verified unnecessary; adding headers or rewrites for
  this path would be change without a reason.
- **iOS or desktop.** Digital Asset Links is Android's mechanism.
- **Deciding the final package name.** `io.github.maniator.verticopolis` is what the
  committed Bubblewrap manifest already uses; changing it is a different change, and
  it would invalidate this file.

## Success signal

`curl -sI https://verticopolis.com/.well-known/assetlinks.json` returns 200 with
`content-type: application/json` (it returns 404 today, recorded by the repo's own
production-validation baseline). Google's Digital Asset Links tester reports a pass
for `io.github.maniator.verticopolis`. An APK signed with the sideload key, installed
on a real phone, opens the game with no address bar.

## Assumptions

- The Bubblewrap manifest's `io.github.maniator.verticopolis` is the package name the
  Play record will use. If the owner prefers a domain-based ID later, this file
  changes with it.

Resolved during implementation: **Vercel serves `.json` from static output as
`application/json`**, so no `headers` entry is needed. Measured three ways rather
than assumed: production already serves `https://verticopolis.com/version.json` as
`application/json; charset=utf-8` from the same output directory and the same
`filesystem` route handler; this branch's Vercel preview serves the file itself as
`200 application/json; charset=utf-8`; and `vercel dev` agrees locally.

## Open questions

- **Does the owner want the sideload fingerprint in production at all**, or would
  they rather wait and publish once with only the Play fingerprint? Shipping it now
  is what makes a test APK verify today; waiting costs only that test. **This was
  never put to the owner before the file was written**, so the implementation
  answered it by default. If the answer is no, the fix is to delete one line from
  the array and redeploy.
