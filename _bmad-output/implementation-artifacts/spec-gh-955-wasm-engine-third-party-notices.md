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
- `src/build/thirdPartyNotices.ts` -- pure helpers; gains the crate walk over `cargo metadata` and a package kind for rendering.
- `scripts/gen-third-party-notices.ts` -- reads the record when the engine ships; the map-less engine glue stays allowed only with it.
- `engine-rs/Cargo.toml` -- the engine's own `license` field.
- `src/tests/thirdPartyNotices.test.ts` -- unit coverage.

## Tasks & Acceptance

**Execution:**
- [x] `src/build/thirdPartyNotices.ts` -- crate walk (normal deps, no proc-macro subtrees, root excluded), `kind` on `NoticePackage`, rendering and dedupe by kind, `Unicode-3.0` on the allowlist -- pure and testable.
- [x] `scripts/engine-third-party.ts` -- runs `cargo metadata`, reads each crate's license and notice files, adds the standard library from the toolchain's `share/doc/rust`, validates, returns the record -- the IO side of the walk.
- [x] `scripts/wasm-build.ts` -- writes `src/public/engine/THIRD-PARTY.json` -- the record travels with the package.
- [x] `scripts/gen-third-party-notices.ts` -- require and merge the record when the engine ships -- closes the allowlisted gap.
- [x] `engine-rs/Cargo.toml` -- `license = "MIT"`, then rebuild the committed package -- the record and the hash stay in step.
- [x] `src/tests/thirdPartyNotices.test.ts` -- the matrix rows the pure module decides.
- [x] `package.json`, backlog -- patch bump (no player line: the notices file is the only output that changes); row `wasm-engine-third-party-notices` done (closes #955 on merge).

**Acceptance Criteria:**
- Given `npm run build` with the engine package, then the notices list the 29 crates the WASM build compiles in today and the Rust standard library, and no proc-macro or build-only crate.
- Given `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, then all pass.

## Spec Change Log

- 2026-10-13, review round 1: the record is `{ sources, crates }` and must name the package's BUILD.json source hash; the site build checks each entry with the same license-file flag the WASM build computed (`engineRecordPackages`, unit-tested); the toolchain's copyright page decodes numeric entities; the standard library entry declares `(MIT OR Apache-2.0) AND Unicode-3.0 AND Zlib` (core's Unicode tables and foldhash reach wasm32; the page's MPL-2.0 and BSD-2-Clause parts build for other targets only) and carries the Unicode license text; `wasm:build` refuses a rustc whose minor release differs from `rust-version`, or one without rustup's doc layout, before compiling; CI's engine job runs on changes to the attribution code and checks the committed record is current. Deferred: #958's package cache key (row `third-party-notices-hardening`, #974).
- 2026-10-14, review round 2: the toolchain check is exact (`rust-version` at `.0`, the release CI already pins), and `scripts/vercel-build.sh` installs that same release, so every build writes the same standard library entry; the record is gathered before the compile, so a crate that cannot be attributed leaves the old package in place; `noticeProblem` says "manifest" so its messages fit crates too.

## Design Notes

The record sits beside the package, so a site build reads it without a Rust toolchain, and `BUILD.json`'s source hash (which covers `Cargo.lock`) already flags a package that is stale against the crates. Proc-macro crates run inside the compiler and ship no code, so their subtrees are left out; over-attribution would be harmless, but their deps (syn and friends) would add noise.

## Verification

**Commands:**
- `npm run wasm:build && npm run build` -- expected: notices include the crates and the standard library.
- `npx vitest run src/tests/thirdPartyNotices.test.ts` -- expected: pass.
