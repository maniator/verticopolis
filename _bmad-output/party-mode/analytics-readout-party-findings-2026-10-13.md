# Analytics reporting posture: party findings (2026-10-13)

Room: Cross-Cutting Plan Review. John (PM), Winston (architect), Cloud
Dragonborn (game architect), Sally (UX), Samus Shepard (game designer), Vex
(security), Noor (privacy), Anika (data scientist), Amelia (dev), Link Freeman
(game dev), Grumbal (adversary), Boundary (edge cases). Session mode.

No issue: this started as a chat request for last week's numbers and turned
into a review when the readout it produced was found to be wrong.

## What happened

A "Verticopolis Weekly Readout" artifact was published on 2026-09-03 covering
Aug 27 to Sep 2, 2026. Revisited on 2026-10-13, three of its claims were wrong.

| Claim as published | Reality | Cause |
| --- | --- | --- |
| 211 sessions, median 86s | 132 sessions, median 42s | Counted `session_end` rows |
| `game_started` below `first_build` is a "sensor fault" needing a fix | Not a fault. It counts tower foundings, never sessions | Read a founding counter as a session counter |
| Offers to build a PostHog dashboard | One has existed since 2026-07-22 | Did not check for prior art |

## The root cause is not carelessness

Every one of those was already solved in this repository, correctly, before the
readout was written. Four layers of prior art, all bypassed:

| Layer | Where | What it says |
| --- | --- | --- |
| Doc comment | `src/analyticsCore.ts` lines 62-108 | 46 lines on the re-fire, the 3.6x row inflation, the `sessionStorage` reload survival, and the 15% loss from a naive `max`. Ends with an imperative: count sessions as distinct ids, sum per-page-life peaks |
| Saved view | `session_lengths` | Its own description warns that counting rows overcounts and an event-level percentile is weighted by length |
| Saved insights | `UXs3D6zF`, `KBgeYtN8`, `CROip3xq` | Each names the exact error. `CROip3xq` even spans both event names across the 2026-09-14 rename |
| Dashboard | Verticopolis: Gameplay Analytics | Carries all of it, filtered to production |

Amelia's point carried the room: documentation **was** the fix, it was
implemented well, and it did not hold. Prose is advisory. The query ran anyway.

## Decisions

| Question | Call |
| --- | --- |
| The published artifact | Correct in place, do not retire. The narrative said something the dashboard cannot ("fewer players, each building much harder") and that part was computed correctly |
| One-off readouts generally | Keep them, under one rule: narrative free, arithmetic governed |
| `booted_only` cohort | Do not build it |
| Durable fix | Register the canonical measures in the PostHog data catalog, which was empty |

## Why `booted_only` was rejected

Noor cleared it on privacy: behavioral, derived from events already held, no new
collection, no new identifier. The objection came from Boundary instead, and it
is the sharpest thing the room produced.

The bucket holds a crawler that fetched the page. It also holds a player who
read the help page and closed the tab, one whose WebGL context failed, one who
took a phone call, and one who simply bounced. Naming it bot detection means
somebody reads "8% bots" off a chart in six weeks and decides something with it.

That is structurally the same defect as `game_started`: a defensible measure
with a name that invites one specific wrong reading. The project renamed its way
out of that defect on 2026-09-14 and was about to ship it again.

Anika's test finished it: name the decision that changes at 4% versus 16%. John
answered "nothing", and the metric died there. If it is wanted later it comes
back as a bounce measure, with an honest name and a stated decision attached.

## Bot filtering stays off, and the reasoning is worth keeping

PostHog classifies **100% of Verticopolis events** as
`Automation / no_user_agent`. That is not a bot invasion. The game sends no user
agent at all, by design, so the detector has nothing to classify and defaults
every event into that bucket. Enabling the built-in bot filter would silently
exclude the entire player base.

## The rule

Added to `CLAUDE.md` non-negotiables:

> Analytics numbers come from a governed definition, never from SQL written for
> the occasion. A readout may narrate, interpret, argue and recommend. Every
> figure in anything published comes from an approved catalog metric, a saved
> view, or a saved insight.

Plus: a published snapshot carries its window and a pointer to the live
dashboard above the figures, not in a footer. Sally's point, and she is right
that a date a reader meets after believing the number is too late.

## What was done

- Artifact corrected and republished, with the three errors named on the page
  rather than quietly overwritten.
- Three metrics proposed in the PostHog data catalog, pending owner approval:
  `sessions_ended`, `session_length_median_seconds`, `first_tower_funnel`. The
  funnel links to insight `CROip3xq`, so it inherits the rename-safe definition
  and tracks drift against it.
- `CLAUDE.md` rules above.

## Open

- The three catalog metrics are `proposed`. They are not canonical until
  approved, and an unapproved catalog is, in Grumbal's words, a seatbelt in the
  glovebox.
- Nobody has checked whether other published artifacts carry the same
  re-derived-metric problem. This was the only one anybody looked at.
