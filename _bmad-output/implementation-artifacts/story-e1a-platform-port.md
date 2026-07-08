---
baseline_commit: f52489e119c29b0ed6b861f83bbb8fed5c3d5770
---

# Story E1a: Platform port (`src/platform/`)

Status: done

Epic: E1 (web-side native readiness), mobile-distribution initiative. First story of the epic; unblocks E1b (PWA gating), E1c (native build mode), and E3b (iOS bridge shell in the private repo).

## Story

As a **future native wrapper shell (iOS Capacitor, built in the private distribution repo)**,
I want **one platform seam (`src/platform/`) through which the game routes file export and external-link opening, with a browser default that is byte-identical to today's behavior**,
so that **the wrapper can inject native implementations (share sheet, system browser) without the public repo taking any Capacitor dependency and without any browser regression**.

## Acceptance Criteria

1. **F1 (native detection):** the game can tell at runtime whether it runs inside a bundled native wrapper via a single flag (`isNativeWrapper`) on the platform port. Only a wrapper-injected port sets it true; the browser default is false. The Android TWA runs the plain web build and never sets it.
2. **F3 (export bridge):** the `.vctower` export (`UI.downloadFile`, `src/ui/UI.ts:803-816`) goes through `platform.saveFile`. The browser implementation keeps the exact current blob-anchor download, including the deferred 60s `revokeObjectURL` (Safari/Firefox async-fetch guard). Import is untouched (`openImport`, `UI.ts:820-839`).
3. **F4 (external-link routing):** the GitHub issue link (`UI.ts:874`) keeps its plain `target="_blank" rel="noopener noreferrer"` anchor in browser builds (existing unit tests assert this and must pass unmodified). Only when the resolved port has `isNativeWrapper: true` is its activation routed through `platform.openExternal` (preventDefault + call), preserving middle-click and context-menu semantics on the web.
4. **Fallback order (arch §2):** at resolution time the port checks `import.meta.env.MODE === "native"` AND `globalThis.__VC_PLATFORM__`: native mode with a well-formed injected global uses the injected port; native mode without one (or with a malformed one) falls back to the browser default; any non-native mode uses the browser default even if the global is present (injecting into a plain-mode bundle is unsupported). Unit tests cover all four branches.
5. **N1 (zero browser regression):** plain browser build behavior is byte-identical. All existing tests green without modification; e2e and visual baselines untouched. No new npm dependency (no Capacitor anywhere).
6. `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` all green. New `src/platform/**` files meet the global coverage floors (85 stmts/lines, 80 funcs/branches) since they are NOT in the vitest coverage exclude list.
7. `package.json` version is NOT bumped (`version: none`; internal change, decision log entry 9).

## Tasks / Subtasks

- [x] `src/platform/types.ts` (NEW): `PlatformPort` interface + `__VC_PLATFORM__` global declaration. (AC: 1)
  - [x] JSDoc the cross-repo contract: the private repo's `native-shell.js` (E3b) sets `globalThis.__VC_PLATFORM__` before the game's module scripts run; wrappers must consume the `--mode native` bundle; the native `saveFile` must resolve (not reject) on user-cancel of the share sheet, rejecting only on real failure.
- [x] `src/platform/browser.ts` (NEW): `browserPlatform` default. (AC: 1, 2)
  - [x] `saveFile`: move the exact blob-anchor body from `UI.downloadFile` (octet-stream Blob, `a.download`, `a.click()`, `setTimeout(revoke, 60_000)`), returning a resolved Promise. Keep the two existing explanatory comments with the code.
  - [x] `openExternal`: `window.open(url, "_blank", "noopener,noreferrer")`.
- [x] `src/platform/index.ts` (NEW): resolution. (AC: 4)
  - [x] `resolvePlatform(mode: string, injected: unknown): PlatformPort` pure function implementing the fallback order, with a duck-type check (object with `saveFile` and `openExternal` functions and boolean-coercible `isNativeWrapper`) so a malformed global can never crash export.
  - [x] `getPlatform(): PlatformPort` caching the result of `resolvePlatform(import.meta.env.MODE, globalThis.__VC_PLATFORM__)` on first call. The shell sets the global before any game script runs, so first-use resolution sees it (arch §2 "checked at boot" intent).
- [x] `src/ui/UI.ts` (UPDATE): route the two call sites. (AC: 2, 3)
  - [x] `downloadFile` delegates: `void getPlatform().saveFile(filename, contents, "application/octet-stream").catch(...)` with a `this.toast(..., "bad")` on rejection (dead code in browser: the browser impl never rejects; the failure surface exists for the native impl).
  - [x] `showHelp`: after `openModal`, only if `getPlatform().isNativeWrapper`, attach a click listener on the `.help-report a` anchor that prevents default and calls `openExternal(href)`. Browser builds attach nothing.
- [x] `src/tests/platform.test.ts` (NEW): fallback-order and browser-default tests. (AC: 1, 2, 4, 6)
  - [x] `resolvePlatform`: native+valid → injected; native+absent → browser; native+malformed (missing function) → browser; `"production"`/`"test"`+valid global → browser.
  - [x] `browserPlatform.saveFile`: blob-anchor-revoke dance (mirror the harness in `uiDialogs.test.ts:360-383`: mock `URL.createObjectURL`/`revokeObjectURL`, spy `HTMLAnchorElement.prototype.click`, fake timers for the deferred revoke).
  - [x] `browserPlatform.openExternal`: spies `window.open` with `_blank` + `noopener,noreferrer`; `isNativeWrapper` is false.
- [x] `src/tests/uiDialogs.test.ts` (UPDATE, additive only): native-routing test for the help link: with a mocked `getPlatform` returning a fake `isNativeWrapper: true` port, clicking the report link preventDefaults and calls `openExternal` with the chooser URL; without the mock, the existing anchor tests pass unchanged. (AC: 3)
- [x] Quality gates: `npm run typecheck && npm run lint && npm test && npm run build`. (AC: 6)
- [x] `/gds-code-review` in this session; fix `patch` findings, record `defer` findings in `_bmad-output/implementation-artifacts/backlog.md`. Own PR; merge commit; no version bump. (AC: 7)

### Review Findings

Run 2026-07-08, three layers (Blind Hunter / Edge Case Hunter / Acceptance Auditor), triage: 11 patch, 2 defer, 4 dismissed. All patch findings fixed and re-verified in this session.

- [x] [Review][Patch] Injected saveFile that throws synchronously or returns a non-Promise bypassed the failure toast [src/ui/UI.ts downloadFile] (blind+edge). Fixed with try/catch + Promise.resolve normalization. The first fix attempt (Promise.resolve().then) deferred the browser download by a microtask and the pre-existing tripwire test caught it, so the call stays synchronous.
- [x] [Review][Patch] Duck-check property reads unguarded: a throwing getter/Proxy injection crashed boot instead of degrading [src/platform/index.ts isPlatformPort] (edge). Wrapped in try/catch returning false.
- [x] [Review][Patch] Malformed-injection fallback was silent, zero diagnostic for the shell author [src/platform/index.ts resolvePlatform] (blind). Now warns on console for a defined-but-malformed injection; stays quiet for undefined (bare native preview is legitimate).
- [x] [Review][Patch] downloadFile's catch discarded the rejection reason [src/ui/UI.ts] (edge). Now logs the cause before the toast.
- [x] [Review][Patch] openExternal throwing after preventDefault left the report link dead [src/ui/UI.ts showHelp] (edge). Handler now falls back to window.open on a throwing wrapper hook.
- [x] [Review][Patch] Only click was intercepted; middle-button auxclick bypassed the port in native shells [src/ui/UI.ts showHelp] (blind+edge). auxclick button 1 now routes the same way; types.ts contract notes that activations the DOM never sees are the shell's navigation-delegate duty.
- [x] [Review][Patch] UI.downloadFile delegation had zero direct test coverage [src/tests/uiDialogs.test.ts] (blind). Added tests for the delegation args (incl. MIME), the rejection toast, and the sync-throw survival path.
- [x] [Review][Patch] Test hygiene: mid-test mockRestore leaked a native-mode getPlatform on assertion failure, and two scenarios shared one it [src/tests/uiDialogs.test.ts] (blind+edge). Split into three tests; describe-scoped afterEach restoreAllMocks.
- [x] [Review][Patch] isNativeWrapper contract ambiguity: story said boolean-coercible, code required strict boolean, and a false flag created an undocumented half-native state [src/platform/index.ts + types.ts] (auditor+blind). Duck-check now requires literally true; the contract documents it.
- [x] [Review][Patch] openExternal URL hygiene was unstated in the cross-repo contract [src/platform/types.ts] (blind). Contract now states the game only passes http(s) URLs and the shell should validate the scheme.
- [x] [Review][Patch] Em-dashes in three new describe titles [src/tests/platform.test.ts] (auditor). Replaced with colons.
- [x] [Review][Defer] Native export feedback is wrong-shaped: exportGame toasts "Check your downloads" synchronously before the port settles, so a native failure shows contradictory toasts and the copy is wrong for a share sheet [src/game/saveLoad.ts:168-170] — deferred, browser-neutral; the fix belongs with E3b's native shell UX.
- [x] [Review][Defer] The real native-mode plumbing (import.meta.env.MODE === "native" reaching getPlatform, cache with no reset seam) is unreachable from vitest [src/platform/index.ts] — deferred, covered by E1c's local-server verification of the native bundle.

## Dev Notes

- **Do not touch:** `src/engine/**` (DOM-free, out of scope), `src/pwa.ts` (that is E1b), `vite.config.ts` / npm scripts (that is E1c), `package.json` (no dependency, no version bump), import path (`openImport` works in WKWebView as-is; the `.vctower` UTI is E3a's job in the private repo).
- **Port shape** (arch §2 sketch says "shape, final naming up to the story"): this story fixes `saveFile(filename: string, contents: string, mime: string): Promise<void>` with **string** contents, deviating from the sketch's `Uint8Array`. Rationale: the export payload is text (`SaveGame.export` builds a string; `downloadFile(filename, contents: string)` is the existing signature), the browser path stays byte-identical with zero encode/decode churn, and Capacitor's `Filesystem.writeFile` takes string data natively. Record this in types.ts so E3b implements against it.
- **Call graph today:** `saveLoad.ts:168` → `deps.ui.downloadFile` ← wired in `main.ts:205`. Keep `UI.downloadFile`'s public signature so neither file changes.
- **`import.meta.env.MODE`:** first use of `import.meta.env` in `src/` (only precedent is the `__APP_VERSION__` define). `vite-env.d.ts` already references `vite/client`, so `MODE` is typed. Vitest sets MODE to `"test"`, dev `"development"`, build `"production"`, the future E1c bundle `"native"`; that is why `resolvePlatform` takes mode as a parameter: tests exercise the `"native"` branches without env mocking, and `getPlatform()` stays a thin cached wrapper.
- **Testability of `getPlatform` at call sites:** have UI.ts call `getPlatform()` lazily at use time (not capture it at construction), so tests can `vi.spyOn(platformModule, "getPlatform")`. Do not add a test-only setter.
- **Existing test harness:** `uiDialogs.test.ts` `makeUI()` builds the DOM scaffold; the downloadFile test (:360) and the Report-an-issue tests (:452-469) pin current behavior and MUST keep passing without edits (they are the N1 regression tripwire).
- **Coverage:** `src/platform/**` lands under the global floors (statements/lines 85, functions 80, branches 80). The duck-type guard branches all need tests or the branch floor bites.
- **Style:** no em-dashes in new comments or copy; no AI marketing vocabulary; American English. Match the codebase's comment voice (explain constraints, not narration).

### Project Structure Notes

- New directory `src/platform/` with `types.ts`, `browser.ts`, `index.ts` per arch §2. UI plumbing stays in `src/ui/UI.ts`. Tests in `src/tests/` (repo convention: all vitest files live there or beside sources matching `src/**/*.test.ts`; existing UI tests are under `src/tests/`).

### Project Context Rules

- Quality gates before pushing: typecheck, lint, test, build (CLAUDE.md).
- Deep review is `/gds-code-review` in the same session (E1a is game-facing UI plumbing per epics doc); `patch` findings fixed, `defer` findings to the backlog.
- Merge commits only; this story is its own PR on `claude/mobile-app-init-ukdxq1`.
- Hot-path rule not implicated (export/help are user-gesture paths, not per-tick), but keep the resolver O(1) and cached anyway.
- No em-dashes in new prose; no version bump (internal, N1).

### References

- [Source: _bmad-output/planning-artifacts/design/arch-mobile-distribution-2026-07-08.md §2 (port shape, hybrid detection, call sites), §3 (native mode preview)] (on branch `claude/android-ios-feasibility-u92666`, PR #159; local copy in session scratchpad)
- [Source: _bmad-output/planning-artifacts/design/epics-mobile-distribution-2026-07-08.md E1a]
- [Source: _bmad-output/planning-artifacts/prds/prd-mobile-distribution-2026-07-08/prd.md F1, F3, F4, N1]
- [Source: prd decision-log.md entries 9 (version: none), 10 (review routing), 11 (TWA runs plain build)]
- [Source: src/ui/UI.ts:803-816 downloadFile; :820-839 openImport; :874 GitHub link]
- [Source: src/tests/uiDialogs.test.ts:360-383, :452-469 (behavior tripwires)]
- [Source: src/game/saveLoad.ts:168; src/main.ts:205 (callers)]
- [Source: vite.config.ts:150-186 (coverage include/floors)]

## Dev Agent Record

### Agent Model Used

Claude Code agent session (branch claude/mobile-app-init-ukdxq1)

### Debug Log References

- RED confirmed twice: platform.test.ts failed on missing module before src/platform/ existed; the uiDialogs native-routing test failed (defaultPrevented false) before the showHelp wiring.
- Gates: typecheck green; lint 0 problems (dropped one unused eslint-disable in types.ts: no-var does not fire in ambient declarations); vitest 55 files / 723 tests green; coverage thresholds pass with src/platform/** at 100/100/100/100; vite build green.

### Completion Notes List

- 2026-07-08: Implemented per spec. `src/platform/` seam (types/browser/index) with `resolvePlatform(mode, injected)` pure resolver + cached `getPlatform()`; `UI.downloadFile` delegates to `platform.saveFile` (browser port keeps the exact blob-anchor-deferred-revoke behavior, moved verbatim); `showHelp` routes the report link through `openExternal` only when `isNativeWrapper`. No new dependency, no engine change, no version bump. Existing behavior tripwires (`uiDialogs.test.ts` downloadFile + report-link tests) pass unmodified; one additive test covers native routing plus the browser no-interception path.
- Deviation note honored from Dev Notes: `saveFile` takes string contents (not the arch sketch's Uint8Array); rationale recorded in types.ts JSDoc as the E3b contract.

### File List

- src/platform/types.ts (NEW)
- src/platform/browser.ts (NEW)
- src/platform/index.ts (NEW)
- src/ui/UI.ts (MODIFIED: platform import, downloadFile delegation, showHelp native-only link routing)
- src/tests/platform.test.ts (NEW)
- src/tests/uiDialogs.test.ts (MODIFIED: additive native-routing test + platform module import)
- _bmad-output/implementation-artifacts/story-e1a-platform-port.md (NEW: this story)

## Change Log

- 2026-07-08: E1a platform port implemented; all quality gates green; status → review (pending /gds-code-review in this session).
- 2026-07-08: /gds-code-review ran (3 layers): 11 patch findings fixed (hardened saveFile failure handling kept synchronous, guarded duck-check, malformed-injection diagnostic, openExternal fallback + auxclick routing, contract tightening in types.ts, direct downloadFile tests, test hygiene, em-dash cleanup), 2 deferred to the backlog (native export feedback → E3b; native-mode plumbing verification → E1c), 4 dismissed. Gates re-run green; platform files at 100% coverage; status → done.
