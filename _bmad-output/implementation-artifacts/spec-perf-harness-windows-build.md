---
title: Shell-free Windows builds for the perf harnesses (B3a)
type: bugfix
created: 2026-10-20
status: in-progress
context:
  - _bmad-output/planning-artifacts/release-3.0-web-plan-2026-10-20.md
---

# Shell-free Windows builds for the perf harnesses (B3a)

Source of truth: sections 5.2 and 9.2 (row B3a) of the Phase 2 plan (PR #1080),
and OD-9 (i). The fix was written in PR #1068; this extracts only its build half
so RUN-0b can build `main` on the owner's Windows desktop. #1068's held worker
change and its hold (D2) are untouched.

## Problem

`npm run perf:worker` and `npm run perf:compare` build the app with
`execFileSync("npm", ...)` and `execFileSync("npx", ...)`. On Windows both are
`.cmd` shims, which Node refuses to run without a shell, so the build step fails
before any measurement starts. Routing the arguments through a shell instead
would let a checkout path with `&`, `%`, `^` or spaces change the command.

## Change

- `src/tests/perfWorker/build.ts` runs npm's own JS entry (`npm-cli.js`) and
  Vite's `bin/vite.js` through `process.execPath` with a literal argument list,
  so no shell reads the arguments. `npm run build` keeps its `prebuild` and
  `postbuild` hooks.
- Both harness `main.ts` files call `buildProduction` and `buildTooling` in place
  of their private `sh(...)` helper.
- `build.test.ts` covers spaces and shell characters in paths, the lifecycle
  hooks, the Vite entry and arguments, and the actionable error when npm cannot
  be found.

## Boundaries

Tooling only. The harness files sit outside the engine's package key, so the
engine source hash does not move. No measurement is taken; RUN-0b needs this
merged first.

## Verification

`npm run typecheck`, `npm run lint`, `npm test`, and a real `buildTooling` plus
`buildProduction` run on Linux into an output path with spaces, `&`, `%` and `^`
(with `VC_ALLOW_NO_ENGINE=1`). A Windows build is proven on the owner's desktop
in RUN-0a or RUN-0b, not here.
