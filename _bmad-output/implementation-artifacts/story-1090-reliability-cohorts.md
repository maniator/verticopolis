# Story #1090: eligible evidence, the engaged cohort and the all-attempts denominator

Status: in review. Issue #1090 (part of #945's Reliability row). Plan:
`_bmad-output/planning-artifacts/release-3.0-web-plan-2026-10-20.md` section
4.1 (OD-2). Owner direction 2026-10-20 (Naftali), section 5: the engagement
threshold and the anti-bias rule. Field names: A4 spec (#1197).

## Why

The governed definition (`scripts/engine-reliability.mjs`, #1088) counts every
session it is asked to count. The owner's rules need three populations kept
apart, so a failure before engagement can never become missing data and a
zero-second page load can never become a clean success:

1. **All attempts (safety denominator).** Every session that asked for a WASM
   host in a page life the size gate did not move to TypeScript (or in which
   the engine later ran: engaged or faulted), overrides included, grouped by the arm of its first page life that carries one. A
   settled page life counts only if it ran the engine (a settle that already
   fell back on `package-mismatch` did not; the overall rate counts those on
   its own line), and an override to an uncounted WASM host is in no
   population. The
   fault rate is over these sessions. Every `wasm`-arm session with a page
   life that the player's opt-out (a setting or the URL choosing TypeScript)
   or a safety suppression (`safety_suppressed`, or `selected_by: safety`)
   moved to TypeScript is counted in the WASM arm's row, whether or not it
   also ran the engine. One that never ran the engine is outside the rate's
   N, since counting it would make the rate look cleaner than the engine is.
   This departs from #1197's wording, which keeps them in the denominator, so
   the report also prints the rate with them in N; which reading the gate
   uses is pending the owner. A suppressed page
   life that carries an engine-fault reason (the boot that detected a crash
   loop, A4's `unclean-exit`) is a fault, never a move off. Sessions only on
   an uncounted WASM host are counted on their own line. Every engine fault counts here,
   whether or not the player engaged; a page life with an `attempt` row and no
   `settle` row is counted as having left before its first tower (it may be a
   crash during the load; nothing tells the two apart), and every population
   carries a second, pessimistic bound that counts it as a fault.
   **Eligible attempts** is the cohort below without the engagement
   condition, so a fault that stopped the player engaging, which the cohort
   cannot hold, still shows beside it.
2. **Engaged eligible cohort (the 1,000-session gate's unit: the owner's
   direction of 2026-10-21).** The same direction counts the stage 1 and 2
   floors in engaged sessions at their own stage; this cohort admits stage 3
   only, so it is not that count, and no report row computes it yet (#1268).
   A session with at least one
   eligible page life that engaged on the engine. Eligible page life: the
   production host (`wasm`), a commit the gate review names as eligible
   (`--eligible-shas`: S4, S9 and the slice-10 facade in the build, and no
   mirror host reachable under `wasm`; the flag's help says so), stage 3,
   `assigned_arm` wasm, `selected_by` cohort (not a setting, URL or safety
   choice), not safety-suppressed, not size-gated, settled with the engine
   running. Engaged: an `engaged` row whose `engine` is a WASM engine. A fault
   in any of the session's eligible page lives counts, before engagement too.
   The cohort's rate and bound are conditional on engagement, so it is read
   beside the attempts rows, which keep every failure before engagement. A
   session with an override page life (a
   setting or the URL chose either engine, an opt-out included, in any page
   life) is in no eligible population: overridden sessions never qualify. Its
   faults stay in all attempts, and the report counts the sessions left out
   and how many of them carried a fault the row would hold.
3. **Candidate tail.** The eligible attempts and the engaged cohort
   restricted to page lives on the commits the candidate review names
   (`--tail-shas`), so a failure before engagement on the candidate shows.

Also: early telemetry by build, arm and stage; the cohort by build; per stage
and assigned arm, sessions with a settled page life (until both arms send the
`attempt` row; size-gated ones left out in both arms), engagement share, engine-fault sessions and
`$exception` sessions, with the 95% interval of the crash-rate difference
(Newcombe hybrid score); sessions whose arm or stage changed, reported apart
(a session with a size-gated page life is left out whole, since `$exception`
rows carry no page life); stop signals (a repeated engine-fault reason on one
build in two sessions and a latch-off, both read from every recognized page
life, and a crash-rate difference whose interval lies above zero at a
stage). A build in an engaged by-build table holds a session only where it
engaged or faulted there; in an attempts by-build table it holds every session
that attempted on it, engaged or not, as the attempts row's N does, so a
clean attempt that never engaged is a clean attempt there.
New A4 values are validated against the spec's lists; a page life carrying
another value is counted on its own line, in no population.

Requirements this places on other work:

- The `attempt` row must carry every field the `settle` row carries
  (`engine_requested`, `build`, `version`, `sha`, `page_life` and A4's
  fields), since the definition reads each page life's earliest value.
- From slice 10, the old mirror host must not report `engine_requested: wasm`
  (A4's draft: a distinct value such as `wasm-mirror`), or the gate review must
  name only commits where it cannot run. Otherwise a mirror session on an
  eligible commit would count as facade evidence.
- When A4 ships, its change binds `STAGES`, `ASSIGNED_ARMS`, `SELECTIONS` and
  the new reason `unclean-exit` to the source, as the existing lists are.
- Both arms send the `attempt` and `engaged` rows at the same points, so the
  arm comparison can read early exits and engagement in both. Until then it
  reads settled page lives only.
- Neither row is dropped by the 10-row cap on later `engine_status` rows.
- Both arms set `size_gated` on a page life whose tower the gate declines or
  would decline, so the comparison leaves gated sessions out of both arms
  alike; the report prints how many it left out per stage and arm.
- On a suppressed row, only the boot that detects a crash loop carries a
  fault reason (`unclean-exit`); every other suppressed boot sends reason
  `none` and no fallback. When A4 binds `unclean-exit`, narrow
  `suppressedFault` to it.
- The client lane (A4 thread) builds the emitters behind a flag that stays off
  until the owner approves the fields; this story keeps the definition.

## Fields read (none are sent by any build today)

| Field | From | Absent reads as |
| --- | --- | --- |
| `stage` | A4 | `none` (never eligible) |
| `assigned_arm` | A4 | `none` |
| `selected_by` | A4 | `default` |
| `safety_suppressed` | A4 | false |
| `size_gated` | A4 | false |
| `trigger: attempt` | proposed here, needs the owner's analytics approval | page lives with no attempt row are counted from their settle row; early exits before settle stay invisible |
| `trigger: engaged`, `engaged_by` | proposed here, needs the owner's analytics approval | not engaged: the engaged cohort is empty |

Until those ship, the report says at the top, above every figure, how many
page lives carry the fields and are on a build that sends each row, that
nothing is eligible without named commits, and that the engaged cohort is
empty by construction. A row caveat stays while any page life is on a build
that never sent the row (a page life that left early or never engaged sends
none by design, so a build counts once any of its page lives sent it). No
figure is claimed.

The proposed rows: `attempt`, once per page life when boot has chosen the
engine and before the package loads; `engaged`, once per page life, the first
time the running engine accepts a player-initiated gameplay command
(`engaged_by: command`: build, transport, demolish or sell, rent, cars,
schedule, no-rate, an emergency answer, the exterminator), or 30 s of
cumulative foreground time with the splash and blocking dialogs closed, the
game unpaused and the game clock advancing in each counted second
(`engaged_by: play`). Codes only, no new identifier.

## Out of scope

- Client code: A4 ships its fields; the two proposed rows ship after approval.
- Classifying `$exception` as engine or host code, and a repeated-`$exception`
  stop signal: production stacks are minified and rows carry no build commit.
  Stays open on #1090.
- Editing #945's text: the owner's direction of 2026-10-21 makes its "1,000
  engine sessions" 1,000 engaged eligible sessions, and the plan thread
  reconciles #945 with #1104. The 1,000 and its bound are unchanged.

## Acceptance

- Each rule above pinned in `src/engine-reliability-cohorts.test.ts` and
  `src/engine-reliability-cohorts-report.test.ts`: overrides
  in the all-attempts denominator and never eligible, and a session with an
  override page life in either order in no eligible population; an opt-out
  counted in the WASM arm when the session also ran the engine; the tail's
  attempts row; the pessimistic bound; a pre-engagement fault in
  the denominator and outside the cohort; a fault before engagement in an
  engaged session counted; engagement after a fallback (`engine: ts-fallback`)
  not engaged; no eligible commits means an empty cohort; tail subset; arm of
  the first page life; arm-change count; attempt without settle as an early
  exit; stop signals; crash-rate interval.
- The query reads only shipped fields plus the planned ones above.
- Report: snapshot window and both caveats above every figure; both
  denominators, early-exit fractions, arm comparison, eligible and tail bounds,
  blind spots.
- `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` green;
  `/bmad-code-review` run and its patch findings fixed.
