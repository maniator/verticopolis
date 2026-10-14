---
title: 'List the WASM engine''s Rust crates in the third-party notices (#955)'
type: 'feature'
created: '2026-10-13'
status: 'in-review'
baseline_commit: '5eabf6946d9bc6fe8fddab2b7a64ef6ea6c1dd7a'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/spec-gh-951-web-third-party-notices.md'
---

<frozen-after-approval reason="human-owned intent: do not modify unless human renegotiates">

## Intent

**Problem:** The served engine package (`src/public/engine/`, copied to `dist/engine/`) compiles in Rust crates and the Rust standard library, which no JS sourcemap lists, so `dist/third-party-notices.txt` (#951) leaves them out and the generator allowlists the map-less engine glue (issue #955).

**Approach:** When `wasm:build` writes the engine package, it also writes a notices record beside it: every crate the WASM build compiles in (from `cargo metadata` for the wasm32 target and the `wasm` feature) plus the Rust standard library, each with its name, version, declared license and license files. The notices generator requires that record whenever the engine ships and lists its entries as Rust crates.

## Boundaries & Constraints

**Always:**
- Derive the crate list from the build's own dependency resolution (normal dependencies of the engine for wasm32 with the `wasm` feature), never a hand-kept list.
- Fail closed: the WASM build fails on a crate without a license file or with a license outside the allowlist, and the notices generator fails when the engine ships without its record or the record is malformed.
- Hold crate entries to the same license allowlist and license-text checks as npm packages.
- Work whether the engine package is committed (today) or built per deploy (#958).

**Ask First:** a license that is not permissive; a new runtime dependency.

**Never:** read crate data at site-build time from cargo (a site build without Rust must still work from the recorded package); add a license-checker dependency (cargo-about, cargo-deny).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Engine ships | `dist/engine/verticopolis_engine.js` and its record | Notices list each crate once, marked as a Rust crate, plus the standard library | N/A |
| No engine | no `dist/engine/` | Notices unchanged, no record required | N/A |
| Record missing or malformed | engine JS without a valid record | Build fails naming the file | Non-zero exit, one line |
| Crate without license text or allowed license | at `wasm:build` | WASM build fails naming the crate | Non-zero exit |
| Build-only crates | proc-macros, build and dev dependencies | Not listed | N/A |

</frozen-after-approval>

## Code Map

- `scripts/wasm-build.ts` -- writes `src/public/engine/` and its `BUILD.json`; gains the notices record.
- `scripts/engine-third-party.ts` -- runs `cargo metadata` and `cargo tree -e normal`, reads each crate's license files, adds the standard library, checks the toolchain.
- `scripts/license-files.ts` -- license-file reading shared by both generators.
- `src/build/thirdPartyNotices.ts` -- pure helpers; gains a package kind for rendering and `Unicode-3.0` on the allowlist.
- `src/build/rustNotices.ts` -- pure helpers for the engine: the crate walk over `cargo metadata` (narrowed by the `cargo tree` listing), the record check, the copyright page decoder and the standard library's reviewed parts.
- `.github/actions/engine-wasm/action.yml`, `.github/actions/engine-wasm-download/action.yml`, `.github/workflows/engine-rs.yml`, `.github/workflows/copilot-setup-steps.yml` -- the package cache key and path filters cover the attribution code, and both package checks require the record.
- `engine-rs/README.md` -- the local build's toolchain pin; `CHANGELOG.md` -- the 2.30.1 heading (no player line).
- `scripts/gen-third-party-notices.ts` -- reads the record when the engine ships; the map-less engine glue stays allowed only with it.
- `engine-rs/Cargo.toml` -- the engine's own `license` field.
- `src/tests/thirdPartyNotices.test.ts` -- unit coverage.
- `src/tests/thirdPartyNoticesEngine.test.ts` -- the real notices generator run against fixture builds (`VC_NOTICES_DIST`): a matching record is listed, and a missing, stale, malformed or incomplete one fails the build.

## Tasks & Acceptance

**Execution:**
- [x] `src/build/thirdPartyNotices.ts` -- `kind` on `NoticePackage`, rendering and dedupe by kind, `Unicode-3.0` on the allowlist; `src/build/rustNotices.ts` -- the crate walk (normal deps, no proc-macro subtrees, root excluded, narrowed by `cargo tree`), the record check and the standard library's reviewed parts -- pure and testable.
- [x] `scripts/engine-third-party.ts` -- runs `cargo metadata` and `cargo tree`, reads each crate's license and notice files, adds the standard library from the toolchain's `share/doc/rust`, validates, returns the record -- the IO side of the walk.
- [x] `scripts/wasm-build.ts` -- writes `src/public/engine/THIRD-PARTY.json` -- the record travels with the package.
- [x] `scripts/gen-third-party-notices.ts` -- require and merge the record when the engine ships -- closes the allowlisted gap.
- [x] `engine-rs/Cargo.toml` -- `license = "MIT"` -- every engine build writes the record with the package's own source hash (the package is build output since #958).
- [x] `src/tests/thirdPartyNotices.test.ts` -- the matrix rows the pure module decides.
- [x] `package.json`, backlog -- patch bump (no player line: the notices file is the only output that changes); row `wasm-engine-third-party-notices` done (closes #955 on merge).

**Acceptance Criteria:**
- Given `npm run build` with the engine package, then the notices list the crates the WASM build compiles in (28 today, matching the rlibs a clean wasm32 compile produces) and the Rust standard library, and no proc-macro or build-only crate.
- Given `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, then all pass.

## Spec Change Log

- 2026-10-13, review round 1: the record is `{ sources, crates }` and must name the package's BUILD.json source hash; the site build checks each entry with the same license-file flag the WASM build computed (`engineRecordPackages`, unit-tested); the toolchain's copyright page decodes numeric entities; the standard library entry declares `(MIT OR Apache-2.0) AND Unicode-3.0 AND Zlib` (core's Unicode tables and foldhash reach wasm32; the page's MPL-2.0 and BSD-2-Clause parts build for other targets only) and carries the Unicode license text; `wasm:build` refuses a rustc whose minor release differs from `rust-version`, or one without rustup's doc layout, before compiling; CI's engine job runs on changes to the attribution code and checks the committed record is current. Deferred: #958's package cache key (row `third-party-notices-hardening`, #974).
- 2026-10-14, review round 2: the toolchain check is exact (`rust-version` at `.0`, the release CI already pins), and `scripts/vercel-build.sh` installs that same release, so every build writes the same standard library entry; the record is gathered before the compile, so a crate that cannot be attributed leaves the old package in place; `noticeProblem` says "manifest" so its messages fit crates too.
- 2026-10-14, review round 3 and the owner's artifact check on #992: the walk is narrowed by `cargo tree -e normal` for the same target and features, because `cargo metadata` unifies features across builds and listed `zlib-rs`, which the wasm32 build never compiles; the record now equals the 28 crates a clean wasm32 compile produces. The standard library entry is license-checked at `wasm:build`, the site build refuses a record without it, and `vercel-build.sh` shares `checkToolchain`'s version rule.
- 2026-10-14, after #958 merged: the engine package (record included) is build output, written by `scripts/build-engine-wasm.sh` on every deploy and CI job that serves it, so the record is no longer committed and CI's staleness check on it is gone; `.github/actions/engine-wasm`'s cache key now hashes the attribution code, so a change to the walk or the allowlist rebuilds the record (closes the cache-key item #974 then listed as item 8).
- 2026-10-14, review round 4: the walk refuses a `cargo tree` listing that does not name the root crate, and the WASM build refuses an empty crate list, so a misread listing cannot drop every crate; the site build refuses a record with only the standard library; any file under `dist/engine/` requires the record; a crate's `license-file` must sit inside the crate and an unreadable one is a named problem; rustc must be a stable release; an empty toolchain license file is refused; the copyright page's decoder refuses an entity it does not know. Deferred: checking the standard library's license expression against the toolchain's copyright page on a `rust-version` bump (row `third-party-notices-hardening`, #974).
- 2026-10-14, review round 5: the copyright page decoder works in one pass (an encoded ampersand is decoded once however it is written), strips comments and refuses a numeric reference that is not a printable character; a crate's `license-file` is checked through links; an unreadable crate directory or a `dist/engine` that is not a directory is a named failure; the record and the compile share one feature list.
- 2026-10-14, review round 6: `cargo tree`'s listing is parsed by a tested pure helper (`cargoTreePackages`); the walk checks every id before narrowing; the copyright page decoder refuses C1 controls and any raw `<`, `>` or semicolon-less `&` left after the tag strip. The earlier entries' `vercel-build.sh` toolchain install and committed-record check were superseded when #958 merged: `scripts/build-engine-wasm.sh` installs `rust-version` at `.0`, and the record is build output.
- 2026-10-14, review round 7 and the owner's request on #992: CI's engine package checks require the record; `copilot-setup-steps.yml` runs on the attribution code; the copyright page decoder refuses a raw control byte and the standard library entry refuses an empty page; `gen-third-party-notices.ts` takes `VC_NOTICES_DIST` so `thirdPartyNoticesEngine.test.ts` runs the real generator against fixture builds and holds each fail-closed case.
- 2026-10-14, the owner's review of the merged head: the standard library check deferred to #974 lands here. `stdLicenseProblems` reads every part the toolchain's copyright page lists with its license; a part whose license offers neither MIT nor Apache-2.0 must be in `STD_REVIEWED_PARTS` with that license (Unicode-3.0 and Zlib reach wasm32; the SGX ABI's MPL-2.0 and the Fuchsia mutex's BSD-2-Clause do not), a reviewed wasm32 part's license must be in the entry's, and the page must carry foldhash's Zlib notice. A toolchain that adds or relicenses a part fails `wasm:build` until it is reviewed.
- 2026-10-14, review round 8 (Copilot and Codex unavailable): the copyright page parse reads every heading shape and every license line under its part, and fails when the page's heading or license-line count differs from what it read (a restyled part could otherwise slip past); reviewed wasm32 parts must still be listed; the entry's license is compared by SPDX token; foldhash's Zlib notice must sit in its own section; the record names the SHA-256 of the `.wasm` it describes and the site build checks it against the shipped file; the site build requires exactly one standard library entry with the reviewed license; `VC_NOTICES_DIST` is honored only under vitest. The earlier deferrals to #974 (rounds 1 and 4) are both done here.
- 2026-10-14, review round 9: the copyright page parse ignores HTML comments, reads tags in any case, counts file and directory entries and bold license labels against what it read, and requires one license line per part, so a relabeled entry cannot lend its license to the part before it; a compound reviewed license is matched id by id; foldhash's section is found the way the parse finds headings and must carry two sentences only the zlib license has; the site build refuses any file in `dist/engine/` the record does not describe and names an unreadable `.wasm`.
- 2026-10-14, review round 10: every path in a grouped file entry is a part under that entry's license, and the count check is one license line per entry; a license that is not plain SPDX (a lowercase `and`, an `&`, prose) is refused. The round found nothing else above low severity, and no acceptance or constraint violation.

## Design Notes

The record sits beside the package, so a site build reads it without a Rust toolchain, and `BUILD.json`'s source hash (which covers `Cargo.lock`) already flags a package that is stale against the crates. Proc-macro crates run inside the compiler and ship no code, so their subtrees are left out; over-attribution would be harmless, but their deps (syn and friends) would add noise.

## Verification

**Commands:**
- `npm run wasm:build && npm run build` -- expected: notices include the crates and the standard library.
- `npx vitest run src/tests/thirdPartyNotices.test.ts src/tests/thirdPartyNoticesEngine.test.ts` -- expected: pass.
- From a clean clone, on Rust `rust-version` at `.0` (`RUSTUP_TOOLCHAIN=1.97.0` today): `npm ci && npm run wasm:build && npm run build`, then compare the record's crates with the `.rlib` files in `engine-rs/target/wasm32-unknown-unknown/release/deps/` -- expected: identical sets, and every crate plus the standard library in `dist/third-party-notices.txt`.
