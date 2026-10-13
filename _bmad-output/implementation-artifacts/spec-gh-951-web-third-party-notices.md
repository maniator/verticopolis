---
title: 'Ship third-party license notices with the web build (#951)'
type: 'feature'
created: '2026-10-13'
status: 'done'
baseline_commit: '87527a06086e72412f01371cafbd304881672aa3'
context:
  - '{project-root}/CONTRIBUTING.md'
---

<frozen-after-approval reason="human-owned intent: do not modify unless human renegotiates">

## Intent

**Problem:** The website serves bundled third-party JavaScript (excalibur, tone, lit-html, fflate, the Vercel analytics clients, workbox) with no attribution, while MIT, BSD-2, BSD-3 and Apache-2.0 require their notices to accompany a distributed copy (issue #951).

**Approach:** After every build, generate `dist/third-party-notices.txt` from what actually shipped: the `node_modules` sources listed in the emitted JS sourcemaps. Each package gets its name, version, license id and full license text. Link the file from Help's About section.

## Boundaries & Constraints

**Always:**
- Derive the package list from the built output, so serverless-only `api/` dependencies never appear and nothing bundled is missed.
- Fail the build when a bundled package has no license id or no license text, rather than shipping an incomplete file.
- Keep the output stable for a given lockfile: packages sorted, no timestamps.
- Run on every build mode (`build`, `build:desktop`, `build:native`) through the existing `verify:dist` chain.

**Ask First:** adding a runtime dependency; a license that is not permissive (GPL, LGPL, MPL, unknown).

**Never:** hand-maintain the package list; precache the file in the service worker; add a third-party license-checker dependency.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Normal build | `dist/**/*.js.map` list node_modules sources | `dist/third-party-notices.txt`: header, then per package `name@version`, license id, full license text | N/A |
| Nested or scoped path | `node_modules/@vercel/analytics/dist/x.mjs`, `node_modules/a/node_modules/b/...` | Package resolved by its innermost `node_modules/<name>` (scope included) and listed once | N/A |
| Same package from several chunks | Several maps cite one package | Listed once | N/A |
| Package with no license file | `package.json` has `license` but no LICENSE/LICENCE/COPYING file | Build fails naming the package | Non-zero exit with one-line message |
| Missing `license` field | `package.json` lacks `license` | Build fails naming the package | Non-zero exit |
| No sourcemaps found | `dist` without `.map` files | Build fails, so silent emptiness never ships | Non-zero exit |

</frozen-after-approval>

## Code Map

- `src/build/thirdPartyNotices.ts` -- pure helpers: `sourceToPath`, `packageDirFromSource`, `collectPackageDirs`, `declaredLicense`, `isAllowedLicense` (SPDX parser over `ALLOWED_LICENSES`), license and NOTICE file-name tests, `noticeProblem`, `renderNotices`, and the `INJECTED_CODE` detection table.
- `scripts/gen-third-party-notices.ts` -- post-build step: reads `dist/**/*.{js,mjs,css}.map`, places each package (re-anchoring workbox's temp-dir chain at the repo root), adds detected build-tool code, reads every license and NOTICE file, fails with one line on any problem, writes `dist/third-party-notices.txt`.
- `package.json` -- `verify:dist` runs the generator first, for every build mode.
- `vite.config.ts` -- `navigateFallbackDenylist` gains the notices file (query string allowed); the `no-unlisted-package-files` plugin fails the build on a package file no sourcemap lists (stylesheets, CSS-referenced assets).
- `src/ui/templates/helpContent.ts` -- `helpAboutBody` renders the link; `src/ui/templates/help.ts` (modal, relative href) and `src/helpPage.ts` (`/help`, root-relative href) hide it in wrapped builds.
- `src/tests/thirdPartyNotices.test.ts`, `src/helpPage.test.ts` -- unit coverage.

## Tasks & Acceptance

**Execution:**
- [x] `src/build/thirdPartyNotices.ts` -- pure helpers listed in the Code Map -- testable without a build.
- [x] `scripts/gen-third-party-notices.ts` -- generator as in the Code Map.
- [x] `package.json` -- generator first in `verify:dist`; version 2.30.0 with the lockfile in lockstep.
- [x] `vite.config.ts` -- denylist entry with its reasoning in the existing comment; `no-unlisted-package-files` plugin.
- [x] `src/ui/templates/helpContent.ts`, `help.ts`, `src/helpPage.ts` -- "Third-party licenses" link in About, new tab, hidden in wrapped builds.
- [x] `src/tests/thirdPartyNotices.test.ts`, `src/helpPage.test.ts` -- the matrix rows the pure module decides (path parsing, nesting, dedupe, missing license id or text), source forms, SPDX precedence, license shapes, link rendering; the script-level rows (no sourcemaps, malformed input) are checked by running the build.
- [x] `CHANGELOG.md` -- 2.30.0 player line.
- [x] `_bmad-output/implementation-artifacts/backlog.md` -- `web-third-party-notices` done (closes #951 on merge); `wasm-engine-third-party-notices` (#955) for the WASM engine's Rust crates. `third-party-notices-hardening` (#974) for the review's deferred roads.

**Acceptance Criteria:**
- Given a production build, when it finishes, then `dist/third-party-notices.txt` lists the npm packages whose code ships (today: excalibur, tone with standardized-audio-context, automation-events and tslib, lit-html, fflate, @vercel/analytics, @vercel/speed-insights, five workbox modules, workbox-build's service worker template, pixelarticons (icon path data copied into `src/ui/iconPaths.generated.ts`), vite, vite-plugin-pwa) and no `api/`-only package such as @vercel/functions.
- Given the Help page or modal outside a wrapped build, when About is opened, then a "Third-party licenses" link opens the notices file in a new tab.
- Given `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, when run, then all pass.

## Spec Change Log

- 2026-10-13, review round 1 (`/bmad-code-review` layers in step 4): sourcemaps miss build-tool code (Vite's preload helper and modulepreload polyfill, vite-plugin-pwa's register module), so `INJECTED_CODE` adds them when their code is found in the output. The "Ask First" license rule is enforced by an allowlist that fails the build. NOTICE files ship with their license, multi-file licenses are all kept, older `license` shapes are read, ordering is by UTF-16 code unit (locale-free), `file:` URLs and Windows paths are parsed, malformed input fails with one line, the `/help` page uses a root-relative link. KEEP: sourcemaps as the source of truth, failing closed.
- 2026-10-13, review round 2: SPDX parentheses are honored; a NOTICE file alone no longer passes; the workbox fallback keeps nested chains; remote or drive-letter `sourceRoot` values are handled; a `node_modules` source that names no local file fails the build; the polyfill has its own marker; both Help surfaces hide the link in wrapped builds; the denylist accepts a query string.
- 2026-10-13, review round 3: a bare `WITH` operand fails the SPDX check; an empty license file beside a NOTICE no longer passes; `\0` helper ids that wrap an absolute file are resolved, and backslash `node_modules` ids fail when unplaceable; shipped JavaScript with no sourcemap fails the build unless allowlisted (only the WASM engine glue, #955); a `node_modules` dot directory is not a package and fails clearly; a bare drive `sourceRoot` resolves.
- 2026-10-13, review round 4: a legacy `licenses` array is read as AND, so every entry must pass; prereleases sort before their release; `.cjs` output is scanned like other JavaScript; error messages quote the source id. Edge cases: code files never count as license files; packages are read only from the path inside the repository (a checkout under a `node_modules` folder, or a source that climbs out of the repo, is not attributed to the wrong copy); workbox-build's service worker template is detected; a drive-relative id names no file; an unreadable license file fails with one line. The notices link does not work offline because the file is never precached, which the spec requires. The modal's relative link stays (the game is served at the root and wrapped builds hide it), and the header's WASM gap stays with #955.
- 2026-10-13, review round 5: declared licenses keep each entry's grouping when joined (`(MIT OR GPL-3.0-only) AND GPL-2.0-only` no longer passes), an unreadable `licenses` entry fails, and `license` with `licenses` must both hold; a COPYRIGHT file alone is not license text; a sourcemap with no sources, or a non-string source, fails unless the chunk is known build-tool code; any source outside the repository fails unless `INJECTED_CODE` names it; injected packages resolve the way Node would from the package that loads them; a package stylesheet fails the build (Vite writes no CSS sourcemaps); the `/help` page gains the `.visually-hidden` rule; an unreadable license file fails with one line.
- 2026-10-13, review round 6: a sourcemap whose emitted file is missing fails with one line; the package-stylesheet check moved from a source scan to a Vite plugin that sees every module id, so preprocessor files, query suffixes, relative `node_modules` paths and a package whose main file is CSS are all caught.
- 2026-10-13, review round 7: a sourcemap id that names no file fails unless `INJECTED_CODE` attributes it; prerelease identifiers compare by SemVer (`beta.2` before `beta.10`); the build plugin (now `no-unlisted-package-files`) also fails on a package stylesheet inlined by a CSS `@import`, on a package asset emitted or inlined from a CSS `url()` (checked through the build's watch list and asset origins), and on every extension Vite treats as CSS. Each case was probed with a throwaway package.
- 2026-10-13, review round 8: only an `INJECTED_CODE` entry marked `wholeChunk` (Vite's modulepreload polyfill) excuses a sourcemap with no sources, so a chunk that merely contains the preload helper or the service worker template still needs its sources listed. Package content a code generator copies into our own source (pixelarticons' icon paths) is attributed through `INJECTED_CODE`, and a unit test holds every `AUTO-GENERATED ... from <pkg>@` file to an entry.
- 2026-10-13, review round 9: clean (no patch findings from any layer). Its defer findings are row `third-party-notices-hardening` (#974).
- 2026-10-13, Codex review on the PR: every sourcemap must have its emitted file beside it (a stale or partial `dist` fails); Windows UNC paths keep their `//server/share` root; the frozen-section tag loses its em dash.

## Design Notes

Sourcemaps are the bundler's own record of what each emitted file contains. The workbox runtime is bundled by workbox-build separately from the Vite graph, so a Rollup `generateBundle` hook would miss it, while its `.map` lists it.

`INJECTED_CODE` is a detection table: each entry names a build tool and the evidence of its code in the output (a sourcemap source id or a string the emitted JavaScript always contains), and the package is listed only when that evidence is present. It exists because these tools write code into the bundle without a sourcemap source; when a build stops emitting that code, the package drops out by itself.

Known limits, recorded so a reader does not assume more: static assets copied from a package with no sourcemap (fonts, images, `?url` imports) are not detected; none ship today. Vite emits no sourcemap for CSS, so a `no-unlisted-package-files` Vite plugin fails the build when a package stylesheet enters the build (imported from JavaScript or inlined by a CSS `@import`) or a package file reaches the output from CSS (an emitted or inlined `url()` asset); the game imports none today. The WASM engine's Rust crates appear in no JS sourcemap and are row `wasm-engine-third-party-notices` (#955). Roads no build uses today (a package file copied into `src/public/`, a generated file without the header, a linked package inside the repository) are row `third-party-notices-hardening` (#974). Vite's own LICENSE file bundles the licenses of its Node-side dependencies, which makes the notices longer than strictly needed.

## Verification

**Commands:**
- `npm run build && head -40 dist/third-party-notices.txt` -- expected: header plus the packages in the first acceptance criterion; no @vercel/functions.
- `npx vitest run src/tests/thirdPartyNotices.test.ts src/helpPage.test.ts` -- expected: pass.
- `npm run typecheck && npm run lint && npm test` -- expected: green.
