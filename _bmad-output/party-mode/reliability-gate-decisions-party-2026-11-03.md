---
title: "Party Findings: Reliability gate thresholds, the swap autosave detail, and the rate wording"
event: Roundtable on three open questions the owner delegated (3.0.0 gate, #945)
date: 2026-11-03
room: Mary (Analyst), John (PM, release owner), Winston (Architect), Amelia (Dev), Paige (Technical Writer)
relates_to:
  - "#945 (the 3.0.0 gate table, Reliability row)"
  - "#1631 (swap autosave versus timer)"
  - _bmad-output/planning-artifacts/release-3.0-web-plan-2026-10-20.md
  - docs/analytics-measurement-status.md
  - scripts/engine-reliability.mjs, scripts/persistence-failures.mjs, scripts/reliability-coverage.mjs
---

# Party Findings: Reliability gate decisions

> **Addendum, 2026-11-04 (UTC): decision 1 is superseded.** The owner dropped
> the Reliability row as a release gate ("I don't think we need a post-hoc
> threshold. We don't have that many users yet, and we won't really get that
> many users until this gets popular"). The thresholds below are the roundtable's
> recommendation only and do not gate 3.0.0; #945 records the decision. The
> forced-trap recovery and Rollback rows stay as gates, and PostHog reliability
> reporting stays as post-launch monitoring. Decisions 2 and 3 stand.

> **Snapshot, 2026-11-03, against `main` after #1624, #1650 and #1660.** It does
> not refresh. No figure here is release evidence. The live numbers come from
> `scripts/engine-reliability.mjs` (which prints `scripts/persistence-failures.mjs`
> and `scripts/reliability-coverage.mjs` beneath it) and their tests; the
> status of each measure is `docs/analytics-measurement-status.md`. The only
> traffic figure used is the governed one in `docs/analytics-measurement-status.md`
> (its snapshot section): 104 engine sessions from the governed script's own
> counting code, window 2.66.0's first boot (2026-10-30 06:54 UTC) to 2026-11-03
> 14:00 UTC, about 4.3 days, production only. Live figure: re-run
> `node scripts/engine-reliability.mjs`. Every day count below is plain
> arithmetic on that figure at its window-average rate of about 24 sessions a
> day. It is a projection, not a trend: no governed per-day session count
> exists, so this page does not claim the rate is rising or falling. A per-day
> count would be a new governed measure, which is a proposal for 3.x.

Naftali asked that these three questions be settled by a roundtable instead of
waiting on him. The gate is his release decision: he can accept, change or
override any of it, and an override goes in the #945 exception register in his
own words. What follows is the recommendation he delegated.

## The room

| Voice | Pushed for |
|---|---|
| **Mary**, Analyst and data skeptic | No threshold the data cannot honestly support. A bound, never a bare rate; "Insufficient evidence" before "pass". |
| **John**, PM and release owner | A gate that can close in weeks, not months, at the traffic we actually have. |
| **Winston**, Architect | Thresholds that fall out of the governed scripts as they are, with no new fields and no new measures. |
| **Amelia**, Dev | Rules a script prints and a test pins, so nobody computes the gate by hand. |
| **Paige**, Technical Writer | Dated documents stay honest without being rewritten, and the wording says count and rate separately. |

Ground rules: every number the gate reads comes from the governed scripts,
which already compute the exact one-sided 95% Clopper-Pearson bound (Winston);
the count is a lower bound and the rate is observed and coverage-limited with
unknown bias, its bound optimistic (Mary); no new analytics fields (John).

## 1. Reliability gate thresholds for 3.0.0

**John:** The old standard was 1,000 eligible sessions. At about 24 Rust-only
sessions a day (the window average, projection) that is about 37 more days
from 2026-11-03, so mid-December. The Rust-only
plan replaced the 300 and 1,000 standards, so the row needs new numbers.

**Mary:** Then pick the numbers from the bound table, not from the calendar.
With zero faults the bound is about 3/n: 1.49% at n=200, 0.99% at n=300, 0.60%
at n=500. I want 300, so a clean run means something under 1%.

**John:** 300 is about eight more days of traffic at that rate, before the
first candidate even freezes. 200 is about four, and a 1.5% ceiling is still a real statement for a
game whose failure screen keeps the save.

**Winston:** Separate the two windows the plan already has. The tail is the
frozen candidate: today's rule is at least 14 nights and 100 eligible sessions.
At our traffic its bound can never get below 2.95%, so it cannot carry the
ceiling. It can carry "zero faults on the build we ship". The bound belongs to a
longer window: every Rust-only build from 2.66.0 to the candidate, by build,
with a fixed fault still counted, as rule 5 of 4.1 already says.

**Amelia:** A ceiling on the bound handles zero versus one fault without a
special case. At 1.5%, zero faults pass at n=199, one fault needs n=315, two
need n=418. The script already prints the bound; the gate compares it.

**Winston:** The observed rate is printed beside the bound, never gated alone:
with unknown bias it can be wrong in either direction.

**Mary:** For persistence, only slot loads and imports have denominators, and
the volumes are tiny. I will not gate on a rate that reads "Insufficient
evidence" every week.

**John:** But a broken Load button has to block.

**Amelia:** Then gate on counts with the same repeat rule the engine uses: one
session with a failure is triaged and informational; two sessions with the same
code and detail on the candidate build hold the gate until triage says
environment (full or blocked storage, a refused user file) or the defect is
fixed or excepted. The Saves row's real-browser checks (D1, D2) are where a
reported failure gets reproduced.

**Mary:** I accept 200 and 1.5% on two conditions: below the minimum the row
reads "Insufficient evidence" and does not pass, and the 300 and 1.0% option is
written down for Naftali as the stricter choice.

### DECISION 1: proposed Reliability row for #945

Windows (both read with `scripts/engine-reliability.mjs`, by build):

- **Release window:** Rust-only builds from 2.66.0 through the candidate.
  Persistence measures read from 2.78.4 (`PERSISTENCE_FAILURE_SINCE`); earlier
  builds read Not measurable for them.
- **Candidate tail:** the frozen candidate's deploys, at least 14 nights and at
  least 100 sessions (unchanged from row (c) of the plan).

Blocking (the row does not pass while any holds):

| # | Condition | Threshold |
|---|---|---|
| B1 | Release window sample | At least 200 sessions. Below it the row reads **Insufficient evidence** and does not pass. |
| B2 | Engine-fault bound, release window | Exact one-sided 95% upper bound at most **1.5%** (0 faults needs n of 199 or more, 1 fault 315, 2 faults 418). A fixed fault still counts. |
| B3 | Candidate tail sample | At least 14 nights and 100 sessions; below either it reads **Insufficient evidence**. |
| B4 | Engine-fault fallbacks in the tail | **Zero.** A tail fault is triaged; its fix makes a new candidate and restarts the tail, or the owner excepts it. |
| B5 | Triage | Every engine-fault fallback and every engine or host `$exception`, in either window, triaged to a root cause with a linked issue. |
| B6 | Stop signals, any window | Any writer latch-off; a repeated engine-fault fallback (same reason, same build, two sessions); a repeated engine or host `$exception`; a trapped session counted as stopped by `reliability-coverage.mjs`. |
| B7 | Persistence repeats on the candidate build | Two or more sessions with the same code and detail (`autosave_failed` `timer` or `manual`, `load_failed`, `import_failed` `save` or `tdt`) hold the row until triage clears them as environmental or the defect is fixed or excepted. |

Informational (reported, never pass or fail alone):

- The observed engine-fault rate, always beside its bound and labeled
  coverage-limited, unknown bias.
- The tail's own bound (at 100 sessions with zero faults it is 2.95%).
- Slot-load and import rates with their bounds; they will mostly read
  Insufficient evidence. The autosave rate stays **unavailable**.
- A single persistence failure session (triaged, recorded, not blocking).
- `package-mismatch` and `unverifiable` on their own lines (deploy race, #1046).
- Engaged sessions beside N (never as N), and the incomplete terminal
  telemetry cross-check.

Zero versus one fault: zero faults pass B2 at 200 sessions. One fault passes
only once it is triaged (B5), absent from the tail (B4), not repeated (B6) and
the release window reaches 315 sessions; until then the row reads "Not yet: 1
fault, bound X%". The stricter option for the owner: 300 sessions and a 1.0%
ceiling (one fault then needs 473). Projection at about 24
sessions a day (the window average of the governed 104, not a trend): 200
sessions about 2026-11-07, 315 about 11-12, 473 about 11-19. The 14-night
candidate tail is the longer wait for a fresh candidate.

Proposed #945 row text:

> **Reliability.** Release window (Rust-only builds from 2.66.0 to the
> candidate) of at least 200 sessions, with the exact one-sided 95% upper bound
> on the engine-fault rate at most 1.5%; candidate tail of at least 14 nights and
> 100 sessions with zero engine-fault fallbacks; every fault and engine or host
> `$exception` triaged; no latch-off, no repeated fault or exception, no
> stopped trap; no untriaged repeat of a persistence failure code on the
> candidate. Below either minimum: Insufficient evidence, not a pass. The count
> is a lower bound; the rate is observed and coverage-limited with unknown bias,
> and the bound holds for the observed sample only. Evidence:
> `scripts/engine-reliability.mjs` by build.

## 2. #1631: the swap autosave versus `timer`

**Amelia:** The swap autosave goes through the same `autosave()` drain as the
30-second timer (`autosaveIfLive` in `src/game/appBoot.ts`), and the drain
reports `timer`. Splitting it is one new string in `DETAILS.autosave_failed`
and one call site.

**Winston:** It is a vocabulary extension inside an approved code, not a new
field. But the owner approved fixed details, and the data map lists them as a
closed set. Extending a closed list is the change he said no to.

**Mary:** It would also tell us little. `trackAppActionOnce` latches per action,
so the detail is only the first source that failed. A full disk fails the timer
within 30 seconds, so `swap` would show only when the swap happens to fail first.
And the gate reads sessions with any failure, whatever the detail.

**John:** Then it answers no #945 row, which makes it 3.x under the gate-2
triage rule. **Paige:** Then the doc must say so: row 8 of the measurement
status says the swap is inside `timer` twice and never says the detail is the
first failure.

### DECISION 2: keep it folded into `timer` for 3.0.0, and document it

No new `detail` value. #1631 stays open at P3 as 3.x work; adding `swap` later
needs the owner's approval of the vocabulary change and a data map update in
the same PR.

Edits:

- `docs/analytics-measurement-status.md`, row 8, Limits cell. Replace
  "so the swap autosave cannot be split from it without a new `detail` value
  (#1631) (the latch is per page life, so a reload can send a second event; the
  session count de-duplicates). `timer` includes the tower-swap autosave. A tab
  killed" with "so the swap autosave cannot be split from it without a new
  `detail` value, which is deferred to 3.x (#1631). The latch is per action and
  per page life, so `detail` is the first source that failed, and a reload can
  send a second event; the session count de-duplicates. A tab killed".
- `_bmad-output/implementation-artifacts/backlog.md`, the #1631 row. After
  "Not a 3.0.0 gate." append: "Roundtable 2026-11-03
  (`_bmad-output/party-mode/reliability-gate-decisions-party-2026-11-03.md`):
  kept folded into `timer` for 3.0.0; the detail is the first failure only, so
  `swap` would rarely show. 3.x, and only with the owner's approval of the new
  value."

## 3. The "lower bound" wording in the release-3.0 plan

**Paige:** The plan's own banner says "This document is a dated snapshot and is
not rewritten." The Rust-only correction was handled with a banner, so this
one should be too.

**Mary:** A banner is not enough. Someone greps "lower bound", lands on line
933 and quotes it. The wrong sentence needs a marker where it sits.

**Winston:** Then annotate without rewriting: leave each original sentence
intact and add a dated bracketed note after it, plus one banner line at the
top. That keeps the record of what the plan said and stops the claim being
reused.

### DECISION 3: annotate the plan in place, do not rewrite it

Add a banner and three inline notes to
`_bmad-output/planning-artifacts/release-3.0-web-plan-2026-10-20.md`; keep every
original sentence.

1. **Banner**, a new blockquote directly after the "Superseded in part by
   Rust-only" banner (line 3):

   > **Corrected 2026-11-03: the rate is not a lower bound.** Where this plan
   > calls the reliability rate a lower bound (sections 1.3.4 and 4.1, risk R21,
   > and the "lower-bound caveat" in section 14), read: the fault count is a
   > lower bound; the rate is an observed, coverage-limited rate with unknown
   > bias, since sessions that never report can sit in the numerator or the
   > denominator; the exact 95% bound holds for the observed sample only. See
   > `docs/analytics-measurement-status.md`. The original text is kept.

2. **Section 1.3.4, line 362.** After "is a lower bound, since the relay keeps
   no offline queue (4.1)." add: " [Corrected 2026-11-03: the count is the lower
   bound; the rate is observed and coverage-limited, with unknown bias. See the
   banner.]"

3. **Section 4.1, "What it cannot see", line 933.** After "the rate is a lower
   bound, and the report says so." add: " [Corrected 2026-11-03: the fault count
   is a lower bound; the rate is observed and coverage-limited, with unknown
   bias, and the report says that. See the banner.]"

4. **Risk R21, line 1952.** In the Mitigation cell, after "Stated as a lower
   bound;" add: " [corrected 2026-11-03: the count is stated as a lower bound and
   the rate as coverage-limited with unknown bias];" The risk title ("understates
   real fallbacks") stays as written: it records the risk as seen then, and the
   banner covers it.

Other occurrences checked and left as they are:

| File and line | Claim | Why no edit |
|---|---|---|
| release-3.0-web-plan line 2119 | "lower-bound caveat are defined" (change log) | Covered by the banner; it names a caveat, not the rate. |
| `_bmad-output/implementation-artifacts/review-release-3.0-plan-2026-10-20.md` line 87 | "the rate is stated as a lower bound" | A dated review record of what was resolved then; the plan's banner carries the correction. Optional: the same bracketed note. |
| `docs/analytics-data-map.md` lines 108 and 181 | Counts are lower bounds; rate coverage-limited | Correct. |
| `spec-reliability-instrument.md` lines 186, 279, 313 | Count lower bound, rate coverage-limited; "lower-bound caveats" lists | Correct. |
| `story-analytics-engine-events.md`, `story-analytics-removal-fold.md` | Counts worded as lower bounds | About counts; correct. |
| `scripts/engine-reliability.mjs`, `scripts/persistence-failures.mjs` | "the rate is not" a lower bound | Correct; these are the governed wording. |

## Not decided here

The room did not amend #945, grant an exception, set a release date, approve a
new field or `detail` value, or apply any edit above. Those stay with Naftali.
