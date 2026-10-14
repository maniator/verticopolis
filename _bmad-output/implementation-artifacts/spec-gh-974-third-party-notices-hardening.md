---
title: 'Close the roads around the third-party notices (#974)'
type: 'chore'
created: '2026-10-14'
status: 'in-review'
baseline_commit: '9a18b958ccd19fc373ee2efb7f996edc485b52f9'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/spec-gh-951-web-third-party-notices.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-gh-955-wasm-engine-third-party-notices.md'
---

<frozen-after-approval reason="human-owned intent: do not modify unless human renegotiates">

## Intent

**Problem:** `dist/third-party-notices.txt` (#951, #955) lists what the shipped sourcemaps and the engine's record name. The review of #951 found roads a later change could open for third-party content to ship without a notice: files copied from `src/public/`, a generator that copies package content without the header the test reads, an outside-repo source excused by any `INJECTED_CODE` pattern, a sourceless chunk that only has to contain the polyfill marker, a pixelarticons version the notices read from the installed package while the generated file pins another, a linked local package that would read as our own code, and two separate parsers for "is this a package path" (issue #974). None is used today.

**Approach:** Close each road with a fail-closed check in `verify:dist` or a test, keeping the logic in pure helpers under `src/build/` with unit tests, and leave the shipped notices file byte for byte unchanged.

## Boundaries & Constraints

**Always:**
- Fail closed, with one line naming the problem, in the existing `fail()` style.
- Keep scripts ERASABLE and keep `src/` free of imports from `scripts/`.
- The notices file a build writes stays identical before and after this change.

**Ask First:** a third-party file in `src/public/`; a linked or workspace dependency; raising `WHOLE_CHUNK_MAX_BYTES`.

**Never:** add a dependency; touch the WASM engine's record handling (`src/build/rustNotices.ts`).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Unlisted public file | a file under `src/public/` (outside `engine/`) with no `PUBLIC_FILES` entry | `verify:dist` fails naming it | Non-zero exit, one line |
| Stale list | an entry whose file is gone, or did not ship | `verify:dist` fails naming it | Non-zero exit, one line |
| Undeclared generator | a `scripts/gen-*` file with no `copies-package:` line | Test fails naming the script | N/A |
| Declared copy without attribution | a declared copy with no matching `INJECTED_CODE` entry or no AUTO-GENERATED header | Test fails | N/A |
| Outside-repo source | matches an entry without `outsideRepo` | Generator fails | Non-zero exit, one line |
| Sourceless chunk | the polyfill plus other code, or over the size bound | Generator fails | Non-zero exit, one line |
| Pixelarticons bump | installed version differs from the generated header | Freshness test fails | N/A |
| Linked package | `file:`, `link:`, `portal:`, `workspace:` or a bare path in a dependency field, or `workspaces` | Generator fails | Non-zero exit, one line |
| Package path | `/` or `\` separators, a `?query` suffix | One predicate answers for the plugin and the generator | N/A |

</frozen-after-approval>

## Code Map

- `src/build/thirdPartyNotices.ts` -- `outsideRepo` on `INJECTED_CODE` entries and `isKnownOutsideRepoSource`; `isWholeInjectedChunk` and `WHOLE_CHUNK_MAX_BYTES`; `isPackagePath` and `PACKAGE_STYLESHEET`; `linkedDependencyProblems` and `lockfileLinkProblems`.
- `src/build/installedLinks.ts` -- `installedLinkProblems`, the walk of the installed `node_modules` tree for links.
- `src/build/publicFiles.ts` -- `PUBLIC_FILES`, `PUBLIC_EXCLUDED_DIRS`, `isExcludedPublicPath`, `publicFileProblems`.
- `scripts/verify-public-files.ts` -- the `verify:dist` step for the public list (`VC_PUBLIC_SRC` and `VC_PUBLIC_DIST` fixture overrides, honored only under vitest).
- `scripts/gen-third-party-notices.ts` -- uses the `thirdPartyNotices.ts` helpers and `installedLinkProblems`; refuses a linked package before reading the build.
- `scripts/gen-*.{ts,mjs}` -- each declares `copies-package:`.
- `vite.config.ts` -- the `no-unlisted-package-files` plugin uses `isPackagePath` in place of its own regexes.
- `package.json` -- `verify:dist` runs `verify-public-files.ts` right after the notices.
- `src/tests/thirdPartyNotices.test.ts`, `src/tests/thirdPartyNoticesHardening.test.ts`, `src/tests/thirdPartyNoticesEngine.test.ts`, `src/tests/publicFiles.test.ts`, `src/tests/installedLinks.test.ts`, `src/ui/iconPaths.generated.test.ts` -- coverage.

## Tasks & Acceptance

**Execution:**
- [x] (1) Public files: the list and its check, unit-tested and run against fixture trees.
- [x] (2) Generators: `copies-package:` in every `scripts/gen-*` file; the generated-file test reads every declaration and checks each copy against `INJECTED_CODE` and the output's header, and each header's script against its declaration.
- [x] (3) Outside-repo sources: `outsideRepo` on vite-plugin-pwa's register module (its id climbs out of `dist/` to `/@vite-plugin-pwa/virtual:pwa-register`) and workbox-build's template (a temporary folder); the pixelarticons pattern no longer excuses a path outside the repository.
- [x] (4) Whole chunks: marker, one immediately invoked function, at most 1,536 bytes once the sourcemap comment is stripped (Vite 7's polyfill is 771 bytes with its sourcemap comment, 710 without).
- [x] (5) The icon freshness test compares the header's version with `node_modules/pixelarticons/package.json`.
- [x] (6) `linkedDependencyProblems` over `dependencies`, `devDependencies`, `optionalDependencies` and `peerDependencies`, plus `workspaces` and npm, yarn and pnpm overrides and resolutions; `lockfileLinkProblems` over both lockfiles; `installedLinkProblems` over the installed `node_modules` tree.
- [x] (7) `isPackagePath(id, extension?)` shared by the plugin and the generator.
- [x] Backlog row `third-party-notices-hardening` done (closes #974 on merge). No version bump: internal tooling, and the notices file does not change.

**Acceptance Criteria:**
- Given `npm run build` before and after the change, then `dist/third-party-notices.txt` is identical.
- Given `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, then all pass.

## Spec Change Log

- 2026-10-14, review round 1: the two `outsideRepo` patterns are anchored to the exact ids vite-plugin-pwa and workbox-build emit; `linkedDependencyProblems` also reads npm `overrides`, yarn `resolutions` and `pnpm.overrides` at any depth and drive-letter paths, and the generator refuses a `package-lock.json` entry installed with `"link": true` (`lockfileLinkProblems`), which catches `npm link` and nested links package.json does not name; an unreadable `package.json` or lockfile fails with one line; a `copies-package:` output must be JavaScript or TypeScript, since only module-graph code reaches a sourcemap; `verify-public-files` walks a linked folder like a real one. Dismissed: `src/public/engine/` is covered by the notices generator's own check that refuses any file there its record does not describe (#955); `isWholeInjectedChunk` bounds rather than parses the polyfill's body, a deliberate size trade-off.
- 2026-10-14, review round 2: the generator also refuses a symlink installed in `node_modules` (a hand-made link or an unsaved `npm link`) and a link in `node_modules/.package-lock.json`, so what is installed is checked as well as what is declared; an id that names no file is excused only by an entry marked `outsideRepo`, like an outside-repo path, and the vite-plugin-pwa pattern accepts its bare `virtual:pwa-register` id too; a local tarball spec is not a link (npm unpacks it into `node_modules`); the plugin again refuses a package id whose stylesheet extension sits in the query; `isWholeInjectedChunk` counts UTF-8 bytes; `verify-public-files` fails with one line on a broken link or a link loop. Dismissed: an unminified build's polyfill writes its marker with escaped quotes and so already failed the marker check before this change (production builds are always minified, and it fails closed); `packageDirFromSource` keeps its own parse for extracting the package directory, and it agrees with `isPackagePath` on the normalized paths the generator gives it.

- 2026-10-14, review round 3: the installed-tree scan moved into `installedLinkProblems` (`src/build/installedLinks.ts`), which also refuses a linked `@scope` folder and a link in any nested `node_modules`, and fails with one line on a tree it cannot read; a link in `node_modules/.package-lock.json` is named with that file; the plugin's stylesheet test finds an extension that ends any query part (`?vue&type=style&lang.css&inline`), and the pattern moved to `PACKAGE_STYLESHEET` so a test covers it; `verify-public-files` refuses only a link back to a folder above it, so two links to one folder pass, and it refuses `.DS_Store`, `Thumbs.db` and `desktop.ini` with a line asking for them to be deleted, since Vite would ship them. Dismissed: a pnpm install, where every package is a link, fails closed, and the project installs with npm (`package-lock.json`); `packageDirFromSource` and `isPackagePath` can disagree only on an in-repo id whose query names `node_modules`, which already fails the not-a-file check.
- 2026-10-14, review round 4: `installedLinkProblems` refuses a `node_modules` that is itself a link (a dangling one included) and names a nested `node_modules` it cannot read (a missing one is fine); `verify-public-files` fails with one line on a folder it cannot read; an operating system's file in `src/public/` fails with a line asking for it to be deleted, where round 3 skipped it and Vite still shipped it. `installedLinkProblems` reads the file system itself, unlike the other helpers, because the tree it checks is the input; its tests build real trees. Round 5 found no defect: it named a missing `node_modules` as passing (nothing installed), gave the unreadable lines one wording, and brought the script header up to date. The unreadable-folder branches have no test, because CI runs as root and a permission fixture cannot block root's reads. Dismissed: a link inside a package's own folder (`node_modules/a/lib`) is not looked for, since npm never installs one (a packed tarball holds no links), so only a hand edit makes it, and a hand edit could as easily copy the code into `src/`; walking every installed file to catch it costs more than it prevents.

## Design Notes

The public list is a typed module rather than JSON, so the license field is a closed set the compiler checks, and the verify script and the tests share one import. The check compares the `src/public/` tree with the list and confirms each listed file shipped; Vite copies the folder verbatim, so a file that came from it sits at the same path in `dist/`.

`src/` cannot import `scripts/`, so a generator declares its copies in a comment line the test reads, rather than an export.

## Verification

**Commands:**
- `npm run build` -- expected: `verify-public-files: 12 public files, ...`, and the notices file unchanged.
- `npx vitest run src/tests/thirdPartyNotices.test.ts src/tests/thirdPartyNoticesHardening.test.ts src/tests/thirdPartyNoticesEngine.test.ts src/tests/publicFiles.test.ts src/tests/installedLinks.test.ts src/ui/iconPaths.generated.test.ts` -- expected: pass.
