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
| `trigger` | `settle`, `fallback`, `writer-latch`, `summary` | Why this row was sent |
| `engine_requested` | `ts`, `wasm`, `wasm-frame`, `wasm-worker` | The engine the page life asked for (`?engine=` or `vc.engine`; `ts` when neither is set). A wasm-only build always sends `wasm`, whatever the URL says. |
| `engine` | `ts`, `wasm`, `wasm-frame`, `wasm-worker`, `ts-fallback`, `none` | What runs when the row is sent. `ts-fallback` is a switchable build back on TypeScript; `none` is a wasm-only build that stopped. After a fallback it stays `ts-fallback` for the rest of the page life, even when the host takes a later tower again (re-adoption reporting comes with #874). |
| `build` | `switchable`, `wasm-only` | The bundle kind (`src/build/engineBundle.ts`) |
| `fallback_reason` | `none`, `boot-timeout`, `boot-error`, `package-mismatch`, `attach-refused`, `trap-command`, `trap-tick`, `trap-undo`, `other` | The latest fallback's reason. `package-mismatch` is a package this shell cannot use (missing exports, a link error, a catalog of another version or one this build cannot draw, or, in a wasm-only build, no save writer), which is the deploy race (#1046), and sits outside the rate. `attach-refused` is a tower the host would not take, including an engine that could not hand over its catalog. `other` is, for now, a boot step outside the engine that failed after the worker host started. The three `trap-*` codes are reserved for #874 and not sent yet. |
| `fallback_stage` | `none`, `load`, `start`, `adopt`, `undo` | Where the latest fallback happened: loading the package, the first tower (or a boot step just after it, for `other`), a later tower (a load or new game) or an undo restore |
| `fallbacks` | integer | The running count for this page life. A reader takes its highest value per `page_life`, never the row count. |
| `writer_latched` | boolean | The engine save writer turned itself off this page life (also `writerLatched` on `window.__vcEngineBoot`) |
| `page_life` | random id | Minted in memory at the page life's first row and never stored, so a reload gets a new one. It only groups rows from one page life; it cannot link a page life to anything else. |
| `version` | the build's version | Which release sent the row |
| `sha` | the build's short commit (`__APP_SHA__`) | Which exact build, so two deploys of one version stay apart |

**Planned, not collected yet.** The A4 cohort work adds `arm` (the cohort arm)
and `size_gated` (a tower too large for the engine), and #874 (step A3) adds
`divergence_reports`, a count. The governed definition already reads `arm` and `size_gated`, and an
absent value reads as `none` and `false`. Each lands in this table, with its
reason, in the change that sends it.

**How it is counted.** Only through `scripts/engine-reliability.mjs`: a window
holds the page lives whose `settle` row falls in it; sessions are distinct
`distinct_id`s in production, as in the `session_lengths` view; a page life
carrying a value the game never sends is left out and counted on its own line;
N counts the sessions with a counted page life that ran the engine (one whose
settle row already fell back on `package-mismatch` alone did not); a session is
a fault when any of those page lives fell back for a reason other than
`package-mismatch`, which is reported on its own line; `override` and
`unassigned` arms are left out unless asked for; the bound is the exact
one-sided 95% Clopper-Pearson bound, by build and by arm as well. The rate is a
lower bound: the relay has no offline queue and a per-IP limit, a tab closed
while the engine loads never sends its row, and runtime traps are not reported
before #874. The script's header comment carries every rule and every gap.

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
