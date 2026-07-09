---
baseline_commit: 5931e91 (this repo, main tip at story time)
epic: mobile-distribution E1b (NOT SimTower-parity E1b; the letters overlap)
---

# Story E1b: PWA gating in native builds

Status: done

Epic: E1 (mobile-distribution web-side native readiness), story E1b. Depends on E1a (`src/platform/` port, PR #160, merged). Unblocks E1c (which owns the operational verification of native mode). Spec: `_bmad-output/planning-artifacts/design/epics-mobile-distribution-2026-07-08.md` E1b, `design/arch-mobile-distribution-2026-07-08.md` §3, `prds/prd-mobile-distribution-2026-07-08/prd.md` F2 / N1.

## Story

As **the future iOS Capacitor wrapper (bundled build, arch §5)**,
I want **`src/pwa.ts` to not register the service worker or run the hourly `version.json` update poll when built with `--mode native`**,
so that **the iOS app updates through the App Store rather than through the site's PWA update flow, and the poll doesn't fetch a version file that would only ever see the bundled snapshot**.

## Acceptance Criteria

1. **PRD F2:** `registerPWA()` is a no-op in native-mode builds. No `registerSW()` call, no `setInterval` for the hourly poll, no `visibilitychange` listener, no `version.json` fetch, no `updateSW` returned.
2. **PRD N1:** the plain browser build is byte-identical in behavior. Existing e2e and visual baselines pass without regeneration, including the update-chip / update-prompt paths that drive `game.onUpdateAvailable` directly (per `e2e/visual.spec.ts:76,100,121`, unaffected because those bypass the SW).
3. **Android TWA note preserved:** the TWA renders the live site with the plain build, so it deliberately keeps the SW and full update flow. That is stated in F2 already; the gate condition MUST be `import.meta.env.MODE === "native"`, not any Android or wrapper-runtime check.
4. Quality gates green: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`.
5. `package.json` version is NOT bumped (`version: none`; internal change, per decision log entry 9).
6. **Native path verification is E1c's job, not this story's** (recorded in the public backlog under the E1a review deferrals): under vitest, `import.meta.env.MODE` is pinned to `"test"`, and there is no test-only setter on `getPlatform` (or on this file's gate). The vitest surface for E1b is limited to the plain-browser path; E1c owns building `--mode native` through a local server and observing the native resolution end-to-end. Delete the corresponding E1a inbox note from the backlog only when E1c lands, not here.

## Tasks / Subtasks

- [x] `src/pwa.ts` (UPDATE): added the `import.meta.env.MODE === "native"` guard at the top of `registerPWA()`, sibling to the existing browser-precondition guard. Comment names the arch §3 rationale and calls out that the Android TWA runs the plain build. (AC: 1, 3)
- [x] `src/tests/pwa.test.ts` (NEW): three tests, `vi.mock("virtual:pwa-register")` via `vi.hoisted` so the mock ref survives `vi.resetModules`:
  - default MODE (vitest pins `"test"`): `registerSW` is called once and the four handler seams (immediate, onRegisteredSW, onNeedRefresh, onOfflineReady) all reach it. This is the N1 tripwire.
  - `vi.stubEnv("MODE", "native")`: spies on `window.setInterval`, `document.addEventListener`, and `fetch` prove the guard leaves NO side effect behind, not just that `registerSW` was skipped. `vi.unstubAllEnvs()` in `afterEach`.
  - `isSecureContext=false` with `serviceWorker` present: pins the specific pre-existing secure-context precondition (not just "some check failed"), so a guard-reorder that dropped the check would flip the assertion.
  - happy-dom environment; `Object.defineProperty` stubs restored per test. (AC: 1, 2)
- [x] Quality gates: typecheck, lint, 996 tests, build all green. (AC: 4)
- [x] `/bmad-code-review` in this session (3 layers). Fixed patch findings same-session. Deferrals extended to the E1a review's existing inbox note (see Review Findings). Own PR; merge commit; no version bump.

## Dev Notes

- **Guard placement.** Put the check inside `registerPWA()`, sibling to the existing environment guard, not at the call site in `main.ts`. Keeping the mode check where the SW logic lives avoids scattering wrapper awareness through the boot code and matches E1a's pattern (the browser default IS the fallback; native shells opt out).
- **Do NOT touch `src/main.ts:1318`**: the boot code keeps calling `registerPWA(...)`. The gate is inside `registerPWA` for encapsulation. The e2e tests drive `game.onUpdateAvailable(...)` directly (`e2e/visual.spec.ts:76,100,121`), so they're unaffected either way; keeping the call site stable also keeps a native session's boot indistinguishable from a browser session up to the point registerPWA decides.
- **Do NOT touch `src/pwaUpdateInfo.ts`** (the pure parser). It has its own unit test and is imported for its type only; nothing about it changes.
- **`import.meta.env.MODE` typing.** `vite-env.d.ts` already references `vite/client`, so `MODE` is typed as `string`. Do not add a Vite mode enum type or a runtime type guard: the plain-build value is `"development"` / `"production"`, the future native build sets it via `--mode native` (E1c wires the npm script). Any other value is treated as "not native", which is the safe default.
- **Interaction with the E1a runtime global.** The runtime `__VC_PLATFORM__` injection is orthogonal to this compile-time gate: E1a's arch §2 note is explicit that "injecting the global into a plain-mode bundle is unsupported, since the PWA layer is gated at compile time." This story implements that gate. A wrapper that ships the plain build has the SW running; a wrapper that ships the native build does not.
- **Version bump: none.** Behavior in the plain build is byte-identical (N1), and the native mode does not ship to players yet (there is no `--mode native` npm script until E1c). Internal change per CONTRIBUTING versioning rules and decision-log entry 9.

### Review Findings

Run 2026-07-08, three layers (Blind Hunter / Edge Case Hunter / Acceptance Auditor; Edge ran the tests to verify, Blind wrote and deleted a probe test to prove happy-dom's precondition defaults). Triage: 7 patch (all fixed), 0 defer, 1 documentation extension (below).

- [x] [Patch][med] Test 3 was ambiguous: bare happy-dom fails both preconditions, so a guard-reorder deleting either check would still leave test 3 green. Rewritten to explicitly stub `serviceWorker` present and `isSecureContext=false`, so the assertion now pins the specific secure-context check. (Blind F1)
- [x] [Patch][med] Native-mode test only checked `registerSW`; the story's F2 AC promised "no interval, no visibilitychange, no fetch" explicitly. Added spies on `window.setInterval`, `document.addEventListener`, and `fetch`, so a future refactor that hoists any of those side effects above the `onRegisteredSW` callback would trip the test instead of silently leaking. (Blind F2)
- [x] [Patch][low] JSDoc "compile-time mode, not any runtime flag" was strictly true only in production builds (`import.meta.env` is a mutable object under vitest, which is exactly why the tests can stub it). Softened to "the build's Vite mode (inlined in production builds)" in both the source comment and the test-file header. (Blind F3)
- [x] [Patch][low] Em-dash in the new `describe("registerPWA — gating")` title. Same class of finding E1a's review patched; replaced with a colon. (Auditor F1)
- [x] [Patch][low] Existing em-dash in a `src/pwa.ts` comment was accidentally rewritten to a colon while touching the file. Reverted so the diff carries only the AC-mandated addition. (Auditor F2)
- [x] [Patch][low] "X, not Y" emphatic-restatement pattern in the new pwa.ts comment and test header; the AC-3 story wording carries the same pattern from the spec pointer (defensible). Rewrote the two novel occurrences without the pattern. (Auditor F3)
- [x] [Extension] The E1b native-mode gate shares its coverage hole with the E1a `getPlatform()` gate (vitest pins `MODE=test`). Extended the existing E1a review deferral in the backlog to name both surfaces so the E1c author, when running the local-server verification, remembers to observe both resolution paths end-to-end. (Auditor F4)
- [x] [Refuted] No cross-file mock leak, `vi.hoisted` + `vi.mock` capture the same spy across `vi.resetModules`, guard ordering is correct, e2e/visual baselines cannot degrade in production builds (dead-branch stripped after inlining). (Edge, all five boundaries + Blind's non-defects.)

### References

- [Source: _bmad-output/planning-artifacts/design/epics-mobile-distribution-2026-07-08.md, E1b entry]
- [Source: _bmad-output/planning-artifacts/design/arch-mobile-distribution-2026-07-08.md §3 Native build mode]
- [Source: _bmad-output/planning-artifacts/prds/prd-mobile-distribution-2026-07-08/prd.md F2, N1, N5]
- [Source: _bmad-output/planning-artifacts/prds/prd-mobile-distribution-2026-07-08/decision-log.md, entries 9-11 for the TWA vs native gating rationale]
- [Source: _bmad-output/implementation-artifacts/backlog.md, E1a review deferral about vitest's blindness to native mode → owned by E1c, not E1b]
- [Source: src/pwa.ts:89-136 `registerPWA` (existing preconditions and SW registration); src/main.ts:1318 (single call site); vite.config.ts:60-84 (VitePWA manifest + `injectRegister: false`)]

### Project Context Rules

- Quality gates before pushing: typecheck, lint, test, build (CLAUDE.md).
- Deep review is `/bmad-code-review` in the same session (E1b is storage/plumbing per epics doc + decision-log entry 10); `patch` findings fixed, `defer` findings recorded in the public backlog.
- Merge commits only; this story is its own PR on `claude/e1b-pwa-native-gating`.
- No em-dashes in new prose; no version bump (internal, N1).

## Dev Agent Record

_(Filled by dev)_

### Agent Model Used

Claude Code agent session (`claude-opus-4-7`), both public and private repos in scope.

### Debug Log References

- Initial test run: 1 failed / 2 passed, root cause was `vi.mock` factory closing over `registerSW` before its `vi.fn()` binding was assigned (Vitest hoists `vi.mock` above the file). Fix: use `vi.hoisted` so the mock ref lives at the top of the module. TypeScript then complained the mock's calls tuple was empty; fix: type the spy signature as `(_opts: Record<string, unknown>) => vi.fn()`.
- Second run: 2 failed. Root cause was happy-dom's navigator having no `serviceWorker` property, so the browser-precondition guard fired before the native gate could be evaluated. Fix: stub both `isSecureContext` and `serviceWorker` inside `makeBrowserBranchReachable` (originally named `makeSecureContext`).
- Final run: 3/3 pass, 996/996 across the suite, all four gates green.

### Completion Notes

- Guard placement inside `registerPWA` (not at the `main.ts` call site), sibling to the existing browser-precondition check, so wrapper awareness stays contained to the module that owns the SW logic.
- Test file uses happy-dom (existing `src/tests` precedent), `vi.hoisted` + `vi.mock` for `virtual:pwa-register`, and `vi.stubEnv` for the mode. All stubs restored per test; no cross-test or cross-suite leakage.
- No engine touches, no new dependency, no version bump (internal per CONTRIBUTING and decision-log entry 9). Plain-browser build is byte-identical.
- Three-layer `/bmad-code-review` ran; 7 patch findings fixed same-session, backlog note extended to name the second gate that shares the E1a review's coverage hole.

### File List

- src/pwa.ts (MODIFIED: MODE === "native" early return + JSDoc note)
- src/tests/pwa.test.ts (NEW: N1 tripwire + F2 side-effect assertion + secure-context precondition)
- _bmad-output/implementation-artifacts/backlog.md (MODIFIED: extended the E1a review inbox note to cover the pwa.ts gate)
- _bmad-output/implementation-artifacts/story-e1b-pwa-native-gating.md (NEW: this story)

## Change Log

- 2026-07-08: E1b implemented in one session (headless). No deviations from the epics E1b Change clause; the vitest surface for the native branch uses `vi.stubEnv("MODE", "native")` (an honest simulation of the compile-time constant) because vitest pins `MODE=test` and there is no test-only setter on the gate. Real-bundle verification of the native path stays with E1c per the E1a backlog deferral, now extended to cover this file too.
- 2026-07-08: `/bmad-code-review` (3 layers) ran; 7 patch findings fixed (test 3 disambiguation, F2 side-effect spies, JSDoc softening, three prose fixes, backlog note extension), 0 deferred, Edge Case Hunter reported 0 findings. Status → done.
