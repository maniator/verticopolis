---
id: SPEC-telemetry-canary
companions: []
sources: []
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete, preservation-validated contract for what to build, test, and validate. Source documents listed in frontmatter are for traceability only.

# Telemetry canary

## Why

A pain, measured. On 2026-08-05 the production `$exception` stream went to zero and stayed there for four days while boot volume held steady (~70/day before the boundary, ~62/day during), so traffic did not explain it. Deciding whether the game had stopped erroring or the reporting chain had broken took a multi-hour investigation: PostHog SQL across 30 days, git archaeology over the build window, an audit of every emit path, and two Playwright probes driven against production. The answer turned out to be "genuinely no errors," but that answer was unavailable until the work was done, and nothing about the silence itself distinguished the two cases. Error reporting is the one signal whose failure mode is indistinguishable from good news, so it is the one signal that needs a heartbeat. A canary converts an ambiguous silence into a decisive one, for the owner of a game whose real error volume (0-4/day) is low enough that a genuine quiet stretch is ordinary.

## Capabilities

- **CAP-1**
  - **intent:** A scheduled run drives the real production origin in a browser and causes exactly one tagged synthetic exception to travel the whole client path.
  - **success:** The event is present in PostHog after the run and names the build that emitted it.

- **CAP-2**
  - **intent:** The run verifies arrival itself rather than trusting that emission implies delivery.
  - **success:** A chain broken anywhere between the browser and PostHog turns the scheduled job red; the job cannot pass while the event is missing.

- **CAP-3**
  - **intent:** Canary events stay separable from real reports everywhere a human or an alert reads error data.
  - **success:** The existing error and crash dashboards, and any alerting on real errors, show identical numbers whether or not the canary ran.

- **CAP-4**
  - **intent:** Prolonged canary absence reaches a human without anyone remembering to check.
  - **success:** A canary that stops firing for the configured window produces a notification on its own.

## Constraints

- The canary must exercise the real **client** path (browser, then relay, then PostHog). A direct POST to `/api/ingest` is insufficient: the incident's open question was specifically whether client capture still worked, and a server-side ping cannot answer it.
- A synthetic event indistinguishable from a real crash is a regression, not a feature. Crash reliability already feeds dashboards (crashes-by-version tile, commits `95f5be14` and `0e07dcb6`), so the canary needs both a reserved marker and exclusion wherever real errors are read.
- No canary code ships in the player-facing bundle or fires inside a real player session.
- `telemetryHostAllowed` gates every event to deployed hosts, so the canary must drive `https://verticopolis.com`. Localhost and preview deployments send nothing.
- The canary must not fight the guardrails in `src/analyticsErrors.ts`: fingerprint dedup via a module-level `seen` Set, `MAX_ERRORS_PER_SESSION` 10, `MAX_MESSAGE_LEN` 500, `MAX_STACK_LEN` 2000, and a re-entrancy latch. One event per run in a fresh session stays clear of all of them.
- Scheduling is GitHub Actions cron. Three scheduled workflows already exist (`analytics-report.yml`, `engine-bench.yml`, `screenshot-approval-reaper.yml`) and `vercel.json` declares no crons.
- Verification reuses `secrets.POSTHOG_PERSONAL_API_KEY` with vars `POSTHOG_PROJECT_ID` (default 524085) and `POSTHOG_HOST` (default `https://us.posthog.com`), following `scripts/posthog-report.mjs`.
- Internal-only: no `package.json` version bump and no CHANGELOG entry (CONTRIBUTING.md line 298).

## Non-goals

- Not a synthetic uptime or availability monitor. The canary answers "is error reporting alive," not "is the site up."
- Not a replacement for the real error stream, and not a source of error-rate metrics. Its only information content is presence or absence.
- Does not cover the desktop or Android shells' telemetry, which reach a different ingest route (`api/ingest/desktop.ts`).
- Does not attempt to canary the typed `crash` gameplay path. Forcing a synthetic WebGL context loss would corrupt the crash dashboards this spec exists to protect.

## Success signal

A scheduled run emits one clearly-tagged canary exception, confirms within the same run that PostHog received it, and fails loudly when it did not. The canary is invisible in the real error and crash dashboards. A four-day silence like 2026-08-05 through 2026-08-09 becomes answerable at a glance instead of by investigation.

## Assumptions

- The canary reuses the repo's existing Playwright dependency and Node version pin rather than introducing a second browser-automation stack, since e2e already standardizes on Playwright 1.61.1.

## Open Questions

- Which alert mechanism: a PostHog alert on a canary insight (fires on absence, independent of CI) or a second scheduled workflow asserting recent canary presence (keeps everything in the repo)? Absence-detection is the harder half, and PostHog's ability to alert on absence needs confirming before committing.
- What cadence? Hourly bounds detection to about an hour but adds roughly 720 synthetic events a month against a real volume of 0-4/day. Daily is quieter but accepts a full day of blindness.
