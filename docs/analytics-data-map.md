# Analytics data map

Every event the game sends, what it carries, why it is collected, and how long
it is kept. A new event or field lands here in the same change that adds it to
the vocabulary (`GameplayEvents` in `src/analyticsCore.ts`), before it ships to
production. `src/analyticsDataMap.test.ts` fails when an event in the vocabulary
has no row in the Events table, when an `engine_status` field or code is
missing from its entry or listed there without the game sending it, and when
the limits below drift from the code.

The player-facing summary of this posture is the Help "Privacy" copy
(`helpPrivacyBody()` in `src/ui/templates/helpContent.ts`, drafted in
`_bmad-output/specs/spec-analytics-posthog-migration/transparency-note.md`).
Anything here that would make that copy untrue changes the copy in the same
change.

## Posture

- **Cookieless and personless.** The game posts each event to its own relay
  (`/api/ingest`, `src/analyticsIngest.ts`), which forwards it to PostHog with
  `$process_person_profile: false`. No cookie is set and no person profile
  exists.
- **The session id is per tab.** `distinct_id` is a random id kept in
  `sessionStorage` (`src/analyticsRelay.ts`). It survives a same-tab reload, so
  one session can span several page lives, and it dies with the tab. Nothing
  links one visit to the next.
- **No IP.** The relay uses the client IP only as its rate-limit key, never logs
  or forwards it, and sets `$geoip_disable: true`.
- **Production is separate.** The relay stamps `environment` from the
  deployment (`production`, `preview`, or `development` under `vercel dev`;
  `unknown` when it has none); every governed number filters on `production`.
- **Host gated.** Nothing is sent from localhost, the e2e preview server or any
  host outside `telemetryHostAllowed` (`src/telemetry.ts`).
- **Bounded.** The relay caps bodies at 8 KiB and each IP at 100 posts a minute.
  Repeating client events are capped: `crash` and `$exception` per page life,
  `engine_status` per page life as its section below sets out, and
  `economy_action`'s `demolish` at 40 a minute (its `price_tune` and
  `capacity_tune` are latched once a session).

## Fields on every event

| Field | Values | Set by | Why |
| --- | --- | --- | --- |
| `distinct_id` | random per-tab session id | relay | Counts sessions (never people) |
| `environment` | `production`, `preview`, `development`, `unknown` | relay | Keeps preview and local traffic out of production numbers |
| `$process_person_profile` | `false` | relay | No person profile |
| `$geoip_disable` | `true` | relay | No location from the relay's own IP |
| `version` | the build's `package.json` version | client | Ties every event to the build that sent it |
| `platform`, `distribution_channel` | closed label set (`INGEST_PLATFORM_LABELS`) | client, checked by the relay | Which surface the game runs on |
| `returning` | boolean | client | Coarse on-device returning signal |
| `tenure`, `recency` | coarse buckets | client | How established the tower is, how long since the last save |
| `display` | `standalone`, `browser` | client | Installed app or browser tab |

The last five arrive with the boot enrichment (`src/analyticsEnrichment.ts`);
an event sent before boot carries `version` only.

## Events

| Event | Fields | When | Why |
| --- | --- | --- | --- |
| `new_game_started` | `mode` | A tower is founded | Funnel entry: new towers |
| `first_build` | `tool` | First facility in a tower | Funnel: did they build anything |
| `tool_used` | `tool` | First use of each tool in a session | Tool mix |
| `star_reached` | `star` | Each star rung crossed | Progression depth |
| `session_end` | `seconds`, `final` | Every tab hide and page hide | Session length, read only through the `session_lengths` view |
| `boot` | `reason`, `version`, `mode`, `star`, `floors`, `population` | Once per page life | Why a session started and the tower it opened |
| `crash` | `kind`, `repeat`, `recoveryFailed`, `saveFlushed`, `behindSplash`, `version`, `star`, `population` | A crash screen | Crash reliability |
| `update` | `from`, `to` | The player applies an update | Update adoption |
| `tool_session_uses` | `tool`, `uses` | Session end, per tool used | Per-tool depth |
| `session_builds` | `builds` | Session end | Build volume |
| `session_peak_floors` | `floors` | Session end | Height reached |
| `session_fps` | `p50`, `low`, `samples` | Session end | Frame rate |
| `app_action` | `action`, `detail` | An app-chrome action | Which saves, dialogs and settings get used |
| `economy_action` | `action`, `detail` | Demolish, price or capacity tuning | The removal and tuning side of play |
| `emergency_choice` | `kind`, `decision` | An answered emergency prompt | Accept and decline split |
| `session_emergencies` | `fires`, `firesGutRooms`, `bombs` | Session end | How often emergencies happen |
| `engine_status` | see below | See below | Engine reliability for the 3.0 release |

The fields of each event are documented where they are declared
(`GameplayEvents` in `src/analyticsCore.ts`). `session_end` re-fires on every
tab hide, so never count its rows; the dashboard's `session_lengths` view is
the governed read.

Outside the typed vocabulary:

- **`$exception`** (`src/analyticsErrors.ts`): an uncaught error or rejection,
  with its type, message, a fingerprint and a raw stack clamped to 2,000
  characters, at most 10 a page life. This is the one place a player's own words
  can travel: an error message can quote game text such as a tower name. The
  Help copy says so.
- **Vercel page-view counts and Speed Insights** (`src/telemetry.ts`): anonymous
  page visits and page performance metrics, on the same host gate.

## `engine_status`

The reliability instrument for the 3.0 web release (release plan section 4.1,
step A1, in PR #1080; issue #1081). Code: `src/analyticsEngineStatus.ts`. Governed
definition: `scripts/engine-reliability.mjs`, pinned by
`src/engine-reliability.test.ts`.

**Why it is collected.** The #945 Reliability gate needs the share of engine
sessions that fell back to TypeScript (or stopped), counted by reason and by
build, with a confidence bound. Nothing else the game sends can tell a fallback
from a clean run. It also records when the engine save writer turns itself off,
the one silent failure the save path has.

**When rows go out.** One `settle` row per page life once boot has picked its
engine, sent before the boot's later steps so a throw in one of them cannot
lose it. A boot that throws before the game exists ran no engine and sends no
row; `$exception` reports it. Then one row for each later fallback or writer
latch-off. Past 10 such rows a page life drops repeats: the first row of a
reason it has not sent yet and the latch-off row still go out, so at most one
more row per code. When the cap drops a row, the next tab hide or page hide
sends a `summary` row with the true count, so a capped loop keeps its size
(the #841 lesson); `summary` rows are outside the cap, at most one a hide and
only after a drop. A reload is a new page life with its own `settle` row.

**What it never carries.** No error message, stack, tower name, path or URL.
Every value below is a code from a closed list in the code; the messages stay on
the device's console and on `window.__vcEngineBoot`, and the emitter is never
handed one. (A boot that throws still reaches `$exception`, as any uncaught
error does; see above.)

| Field | Values | Meaning |
| --- | --- | --- |
| `trigger` | `attempt`, `settle`, `fallback`, `crash-reload`, `writer-latch`, `summary`, `engaged` | Why this row was sent. `attempt` (#1090) goes once per page life when boot has chosen the engine, before the package loads, so a tab that closes or crashes during the load is still counted; it carries the settle row's fields as they stand then. `engaged` (#1090) goes once per page life at the first engagement (the running engine accepts a player's gameplay command, or 30 s of foreground play pass with the splash and dialogs closed and the game clock moving in every counted second) and names the engine running then. Neither counts toward the cap (the owner approved both with the cohort's fields on 2026-10-29). `crash-reload` is a running Rust engine that trapped, sent just before the page reloads from its last autosave (#1422); it keeps the `engine` that crashed and counts as that page life's fallback |
| `engine_requested` | `ts`, `wasm`, `wasm-frame`, `wasm-worker` | The engine the selection policy asked for (`?engine=`, the Settings choice or the cohort's arm), before any safety suppression or hold. When one moved the page life to TypeScript, `engine` is `ts` and `selected_by` says why. A wasm-only build always sends `wasm`, whatever the URL says. |
| `engine` | `ts`, `wasm`, `wasm-frame`, `wasm-worker`, `ts-fallback`, `none` | What runs when the row is sent. `ts-fallback` is a switchable build back on TypeScript; `none` is a wasm-only build that stopped. After a fallback it stays `ts-fallback` for the rest of the page life. After a running engine's fault (#874) that is exact, since no later tower is hosted; after a refused tower the host can take a later one again, and no row reports that. |
| `build` | `switchable`, `wasm-only` | The bundle kind (`src/build/engineBundle.ts`) |
| `fallback_reason` | `none`, `boot-timeout`, `boot-error`, `package-mismatch`, `unverifiable`, `attach-refused`, `trap-command`, `trap-tick`, `trap-undo`, `other`, `unclean-exit`, `marker-blocked` | The latest fallback's reason. `unclean-exit` comes only from the crash-loop check: two page lives of one build that asked for Rust and died while visible. It is sent on the `settle` row of the boot that finds them, which runs TypeScript with `selected_by: safety-device`; a backgrounded tab the browser discards does not count. `marker-blocked` is a boot that asked for Rust but could not write its crash marker (storage full or blocked), so it ran TypeScript to keep a crash countable; it is sent on that `settle` row with the selection unchanged, never ran the engine, and sits outside the rate on its own line (owner, 2026-10-29). `package-mismatch` is a package this shell cannot use (engine files that are not the package this shell was built with, which the page's byte check refuses (#985), missing exports, a link error, a catalog of another version or one this build cannot draw, or, in a wasm-only build, no save writer), which is the deploy race (#1046), and sits outside the rate. (After the byte check has passed, a link error or a missing export is a broken build, not a mixed deploy, but it keeps this code for now.) `unverifiable` is a browser that cannot hash the engine files (an insecure context, a disabled `crypto.subtle`, or a digest call that failed), so the page refuses to run them (#985): the files may be fine, so it sits outside the rate, on its own line, like `package-mismatch`. `boot-error` also covers engine files that did not arrive whole. `attach-refused` is a tower the host would not take, including an engine that could not hand over its catalog. `other` is a boot step outside the engine that failed after the worker host started, or, on a running engine, a save or the reads when a tower is let go. The three `trap-*` codes are a running engine's fault on the main-thread host (#874): a command (the undo capture's save just before an edit included), a tick, a frame sync or the per-frame event drain, and anything during an undo or redo. |
| `fallback_stage` | `none`, `load`, `start`, `adopt`, `undo` | Where the latest fallback happened: loading the package, the first tower (or a boot step just after it, for `other`), a later tower (a load or new game) or an undo restore. For a running engine's fault, how the faulted tower was hosted |
| `fallbacks` | integer | The running count for this page life. A reader takes its highest value per `page_life`, never the row count. |
| `writer_latched` | boolean | The engine save writer turned itself off this page life (also `writerLatched` on `window.__vcEngineBoot`). A running engine's fault (#874) also turns the writer off, and is reported as that fallback rather than here |
| `page_life` | random id | Minted in memory at the page life's first row and never stored, so a reload gets a new one. It only groups rows from one page life; it cannot link a page life to anything else. |
| `version` | the build's version | Which release sent the row |
| `sha` | the build's short commit (`__APP_SHA__`) | Which exact build, so two deploys of one version stay apart |
| `stage` | `0`, `1`, `2`, `3` | The cohort stage this build carries (`COHORT_STAGE`) |
| `assigned_arm` | `wasm`, `ts`, `unassigned`, `none` | The cohort's arm at this build's stage: `wasm` when the stored random bucket is below the stage's share. A setting, a URL, a suppression or the size gate never changes it. `unassigned`: the draw runs but storage cannot keep the bucket. `none`: the draw is off (tooling, dev, a wasm-only build). The bucket's number is never sent |
| `selected_by` | `default`, `cohort`, `setting`, `url`, `safety-build`, `safety-device` | Which policy rule chose `engine_requested`. `setting` and `url` are manual overrides (`setting` covers any stored choice). `safety-build`: a package that failed to load, timed out or did not match, cleared on the next build. `safety-device`: a fault (a trap, a host start failure, a crash loop), kept until the player retries in Settings |
| `engaged_by` | `command`, `play` | Only on `engaged` rows: which branch engaged the page life. Absent reads as `none` |
| `size_gated` | `true` | Only on the rows of a page life the size gate held on TypeScript (#1197): a cohort-drawn tower above the threshold at a gated stage, measured the same way in both arms. Sent only once the owner turns the gate on (`SIZE_GATE_ON`, off in this build). Absent reads as false |

**Planned, not collected yet.** The size gate's `size_gated` is built behind
its flag (above); `trigger: size-gate` comes with the gate on a later Load or
import (stage 1 runs without a gate, the owner's decision of 2026-10-29). A safety suppression is read from
`selected_by`, so no `safety_suppressed` field is sent. #954 adds `divergence_reports`, a count of commands the
engine refused after the TypeScript instance accepted them (the report moved
there from #874). #1090's `attempt` and `engaged` rows are in the table above and go out with
the cohort's fields. The governed definition already reads all of them, and an absent
value reads as `none`, `default`, false, no attempt row or not engaged. Each
lands in this table, with its reason, in the change that sends it.

**How it is counted.** Only through `scripts/engine-reliability.mjs` and
`scripts/engine-reliability-cohorts.mjs`: a window holds the page lives whose
`settle` (or `attempt`) row falls in it; sessions are distinct `distinct_id`s
in production, as in the `session_lengths` view; a page life carrying a value
the game never sends is left out and counted on its own line. The overall rate
counts the sessions with a settled page life that ran the engine (one whose
settle row already fell back on `package-mismatch` or `unverifiable` alone did
not); a session is a fault when any of those page lives fell back for a reason
other than those two, each of which is reported on its own line; overrides and
the `unassigned` arm are left out unless asked for, and safety-suppressed page
lives (which run TypeScript) are always left out and counted on their own
line; the bound is the exact one-sided 95% Clopper-Pearson bound, by build and
by arm as well. That rate is early telemetry. The 1,000-session gate counts
the engaged eligible cohort (#1090; the owner's direction of 2026-10-21):
sessions in the `wasm` arm, on the production host, chosen by the cohort, at
stage 3, not safety-suppressed and not size-gated, on commits the gate review
names, that engaged on the engine; a fault in any of their eligible page lives
counts, one before the engagement too. Its rate and bound are conditional on
engagement, so it is read beside the attempts rows, which keep every failure
before engagement. The stage 1 and 2 floors count engaged sessions at their
own stage, by the same direction; the report does not compute that count yet
(#1268). A session with an override page life (a setting or the URL chose
either engine, an opt-out to TypeScript included) never qualifies; the report
counts the sessions it left out and how many of them faulted. Beside the
cohort, the eligible attempts row holds the same sessions engaged or not, so a
fault that stopped a player engaging still shows, and the all-attempts safety
denominator holds every session that asked for the engine, overrides and
sessions that never engaged included; a size-gated page life is in it only
when the engine faulted or engaged in it. Every WASM-arm session with an
opt-out or a safety suppression is counted in the WASM arm's row, whether or
not it also ran the engine; one that never ran the engine is outside the fault
rate's N, and the report also prints the rate with those in N, as #1197 words
it (which reading the gate uses is pending the owner). A crash loop that a
suppressed boot detects counts as a fault. Each population carries a second,
pessimistic bound that counts a page life that left before its first tower as
a fault. The report also gives the candidate tail's attempts and engaged rows,
an arm comparison by stage with the crash-rate interval, and the stop signals.
Every rate is a lower bound: the relay has no offline queue and a per-IP
limit, a tab closed or crashed while the engine loads sends nothing until the
`attempt` row ships (and with it, is counted as having left, since nothing
tells a crash from a close), runtime traps are reported only from builds that
carry #874, and the worker host reports only its first tower. The scripts'
header comments carry every rule and every gap.

## Retention and deletion

Events live in the PostHog project (US Cloud, project 524085) for as long as the
project's plan retains event data: one year on the free plan and seven years on
paid plans, per PostHog's events retention page as of 2026-10-20
(<https://posthog.com/docs/data/events-retention>). Retention cannot be
shortened to remove data. Nothing is copied
elsewhere apart from the aggregate reports the scripts print.

Because every event is personless, there is no person to delete and no way to
tie an event to a player who asks. To stop collecting a field, remove it from
the code and from this map in one change; old builds keep sending it until they
update. To remove events already stored, use PostHog's data deletion tools
(<https://posthog.com/docs/privacy/data-storage#data-deletion>) or its support,
filtered by event name; otherwise they age out with the plan's retention.
