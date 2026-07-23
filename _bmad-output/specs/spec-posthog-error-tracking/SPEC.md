---
id: SPEC-posthog-error-tracking
companions: []
sources: []
---

> **Canonical contract.** This SPEC is the complete, preservation-validated contract for what to build, test, and validate. It extends the shipped cookieless error tracking (`src/analyticsErrors.ts`) and sits under the analytics-posthog-migration epic; the migration SPEC's cookieless invariants are inherited here by reference.

# Cookieless PostHog error tracking: crash coverage, breakdownable type, and dashboard tiles

## Why

An opportunity to capture, and a gap to close. The merged cookieless error tracking reports genuinely uncaught JavaScript exceptions and unhandled promise rejections to PostHog as `$exception` through the same-origin relay. But the single most important real-world failure, the WebGL context loss on weak GPUs (the Pixel 8a crash, issue #538), is never an uncaught error: the game catches it and fires the typed `crash` analytics event, so it does not reach `window.onerror` and never lands in PostHog's Error Tracking product. The result is that Error Tracking is empty of the crash that matters most, and there are no dashboard tiles for error volume or trends. This work routes the WebGL crash into Error Tracking, makes exceptions breakdownable by type, and provisions the error tiles, so the reliability picture is complete and lives in one place. It matters now because the base feature just shipped and the pipeline is otherwise idle until real errors arrive.

## Capabilities

- **CAP-1: WebGL crashes surface in Error Tracking without losing the crash analytics event**
  - **intent:** a WebGL context-loss crash appears as a grouped PostHog Error Tracking issue, in addition to the existing typed `crash` analytics event (both fire; they are two lenses on one incident).
  - **success:** a `webgl-context-lost` crash on an allowed host produces exactly one synthetic `$exception` (`type` `WebGLContextLost`, `mechanism { handled: true, synthetic: true }`, a stable fingerprint, common props) AND the `crash` event still fires unchanged; neither suppresses the other, and on a dark host neither reports.

- **CAP-2: exceptions are breakdownable by type on a dashboard**
  - **intent:** analysts break errors down by type (TypeError, WebGLContextLost, UnhandledRejection, ...) without reaching into the nested `$exception_list`.
  - **success:** every emitted `$exception` carries a top-level `$exception_type` equal to the exception's type, and a PostHog trends breakdown on it separates the error kinds.

- **CAP-3: the error dashboard is provisioned as code**
  - **intent:** at-a-glance error volume and trends live on the committed, reproducible dashboard rather than being hand-clicked.
  - **success:** running `scripts/posthog-dashboard.mjs` creates or updates, idempotently, an error-tracking section (errors over time, top issues by `$exception_fingerprint`, by platform, by build version, by type); the committed script is the source of truth, live-applied via the connector when available.

- **CAP-4: app-chrome action telemetry via one parametrized event**
  - **intent:** aggregate, cookieless visibility into the app actions outside the build loop, save / export / import / TDT round-trip, dialog and navigation opens, the mute + accessibility toggles, a coarse volume-engagement bit, and landings on the standalone help/gallery pages, through a single `app_action { action; detail? }` event keyed by a closed union.
  - **success:** PostHog breaks `app_action` down by `action` with a count per action; save/export/import/TDT/settings/help/gallery all appear; the coarse `volume` bit fires at most once per session; no per-person identity and no player-authored free text (a tower name) is ever sent.

## Constraints

- **Cookieless and consent-free.** No cookie, no `localStorage` id, no cross-session or cross-device identity, no consent banner. The synthetic crash `$exception` carries only the per-tab session id and the coarse common props every event already carries, never an identifier.
- **Same transport, one gate, never-throw.** No `posthog-js`; the synthetic `$exception` flows through the same relay-only `sendException`. The single `telemetryHostAllowed` predicate gates it, re-checked per report. It is best-effort on the crash path: a reporting failure must never break WebGL crash recovery. The relay forwards no IP (GeoIP disabled), so an exception is not a de-anonymizing signal.
- **`crash` and `$exception` must not read as a double-count.** They are two lenses on one incident: `crash` keeps the structured analytics fields (`repeat`, `recoveryFailed`, `saveFlushed`, `behindSplash`); `$exception` is the Error Tracking issue. This is documented so nobody sums them as "total errors."
- **Bundle and version discipline.** The gzipped bundle delta stays under the 5 KB ceiling with the measured number recorded in the PR. A version bump applies only where a player-facing surface changes; a new client-emitted event category is player-observable (as `session_fps` and the base `$exception` were), so the synthetic emission takes a minor bump, while the dashboard/type-prop tooling alone would not.

## Non-goals

- **Structured stack-frame parsing and source-map upload** (so PostHog resolves frames instead of showing the raw string) is out of scope and tracked separately.
- **Scrubbing player-authored free text** (tower names) from exception messages is out of scope, tracked as #607.
- **Replacing the typed `crash` event with `$exception`** is explicitly not the goal: the `crash` event's structured fields are kept for analytics; the `$exception` is purely additive.
- **Deep per-facility editor economy actions** (sell / rent up-down / add-car / elevator schedule, behind `editorActions.handleEditAction`) are OUT of CAP-4 (design party). They are core gameplay-economy signal deserving their own story and a `/gds-code-review`, not bolted onto app-chrome telemetry. Tracked as a follow-up.
- **Per-person identity.** No `app_action` (or any event) answers "who are my power users." Cookieless means per-session and cohort only; a dashboard must not imply otherwise.
- **The low-signal toolbar micro-actions** undo, redo, overlay, and a tower rename VALUE are deliberately not tracked (design party): no decision they change, and blanket button logging reads as surveillance even when anonymous. A rename would never carry the player-authored name regardless.

## Success signal

When a player's GPU drops the WebGL context, the incident shows up as a grouped issue in PostHog Error Tracking within one lens (with its type, fingerprint, platform, and build version), the `crash` analytics event still records its structured detail, and the error dashboard shows the crash in its volume and top-issues tiles, all without a cookie, an identifier, or a consent banner.
