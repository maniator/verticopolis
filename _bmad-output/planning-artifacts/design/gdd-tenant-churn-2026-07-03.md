---
title: "GDD — Tenant Churn: the recoverable notice period"
game: Verticopolis (browser SimTower clone)
author: Samus Shepard (Game Designer — gds agent), with Sally (UX) & the PR #109 party
date: 2026-07-03
status: Shipped in PR #109
scope: The `vacating` tenant-lifecycle state — how a dissatisfied office/condo
  is put "on notice", warned, and either recovered or evicted. Formalises a
  mechanic that shipped ahead of its design note; back-filled to restore the
  project's gdd-+arch- pairing.
grounds:
  - _bmad-output/planning-artifacts/design/gdd-legibility-2026-07-01.md (the guardrails §0)
  - _bmad-output/planning-artifacts/design/gdd-core-loop-2026-07-01.md (satisfaction, churn)
  - src/engine/Simulation.ts updateSatisfaction / vacateCause / vacate
  - src/engine/types.ts VacateReason, isTenanted, isPresent
  - src/game/inspector.ts (the on-notice card)
  - PARITY.md (low-satisfaction tenants move out)
---

# GDD — Tenant Churn: the recoverable notice period

> **The pillar of this mechanic:** *hurt them, but inform prior.* A tenant never
> vanishes by surprise. When a lease bottoms out, the player is warned, shown the
> exact cause, given a visible clock and a visible recovery target — and only then,
> if they don't act, does the tenant walk. The loss must always feel earned.

## 0. The rule being modelled

SimTower telegraphs an unhappy tenant (the canon red tenant text) and gives you
time to fix it before they leave. Verticopolis previously did the opposite: a
tenant whose satisfaction hit zero was deleted in a single simulation tick, with
a toast that always blamed "poor access" regardless of the real cause. That was
both a legibility failure (no warning, wrong reason) and a design failure (no
decision for the player to make).

This mechanic restores the telegraph as a real, recoverable **notice period**.

## 1. The lifecycle

A leasable unit (office or condo) moves through:

```
 occupied ──(satisfaction hits 0)──▶ vacating ──(notice window elapses, still unhappy)──▶ empty
     ▲                                   │
     └──────(satisfaction recovers to the rescind bar)──────┘
```

- **occupied** — settled. Pays rent, counts as population, commutes.
- **vacating (on notice)** — the tenant has given notice but *has not left yet*.
  They still pay rent, still count as population, still commute. They carry a
  departure deadline and an attributed cause.
- **empty** — gone; the space is re-listed and can attract a new tenant.

**Recovery is a real reprieve, not a formality.** If the player fixes the cause
and satisfaction climbs back to the rescind bar before the deadline, the tenant
**rescinds** and returns to `occupied`.

## 2. The two tuning knobs (and why they're set where they are)

| Knob | Value | Rationale |
|---|---|---|
| **Notice window** | **2 in-game days** | Long enough to be a genuine reprieve; short enough to matter. **Not** shortened — a shorter window re-introduces per-rush-hour eviction churn (see §4). |
| **Rescind bar** | **0.40 satisfaction** | *Stabilized ≠ fixed.* A bar just above zero would let a player keep a tenant by merely nursing them off the floor. At 0.40 the player must make the unit a genuinely decent place to be. A real fix reaches 0.40 in ~8 served hours (recovery is +0.05/hr), comfortably inside the window. |

**Design intent, decided by the party:** churn is meant to **hurt** the
mediocre (served-but-congested) tower — that middle band is where a management
game lives — but the hurt is always **preceded by information**. Hence 0.40
(teeth) *and* the live inspector countdown (fair warning).

## 3. Attributed cause

When a tenant gives notice, the game names the dominant reason, drawn from the
same satisfaction drains that caused it:

- **no route to the lobby** — the floor isn't reachable (any transport: elevator,
  stairs, escalator).
- **overcrowded vertical transport** — congestion on the elevators / stairs /
  escalators (kept generic so it stays accurate whatever mix the floor relies on).
- **rent set too high** — an office priced above the going rate.

**Office noise is deliberately NOT an eviction cause.** Adjacency to an office
*caps* a hotel/condo's satisfaction at 0.6 — it annoys, it never drains to zero,
so it can never on its own evict. The copy is transport-neutral on purpose: a
floor is "served" by any route to the lobby, and congestion counts all transport
modes, so the strings must not single out elevators.

## 4. Legibility rules (the guardrails this mechanic must honour)

Inherited from `gdd-legibility-2026-07-01.md` §0:

1. **Inform before you hurt.** The on-notice inspector card shows the cause, the
   **live countdown** ("Leaves in ~N hour(s)/day(s)"), and the **recovery target
   vs. current** ("get satisfaction to 40% to keep them (now 30%)"). Both tick
   live as the clock advances. The eviction is never a surprise.
2. **A static at-a-glance mark.** An amber corner ribbon flags an on-notice lease
   in the tower view, so a player can spot the at-risk unit without hunting.
3. **Silence when correct.** Rescinding is **silent** — no toast. A unit that
   flaps around the threshold must never spam an alternating "gave notice / is
   staying" pair. The clearing ribbon and card are the (pull) cue that the fix
   worked.
4. **One alarm, not a flood.** Fresh notices in a tick are **batched** into a
   single toast: a named unit when one gives notice, a per-cause tally when
   several go at once. A tower-wide access failure raises one alarm, not one per
   unit.

## 5. What is intentionally out of scope

- **Hotels do not get a notice period.** There is no lease to give notice on and
  a room already cycles nightly (asleep → dirty → empty); a multi-day timer would
  fight that cycle. A chronically miserable room simply fails to hold its guest
  immediately — but now reports the real cause (review F25 behaviour preserved).
- **Commercial venues** (shops/restaurants) are unchanged: their income already
  requires a served floor, so poor access starves them directly.
- **Condos remain a one-time sale.** A vacated sold condo keeps `everOccupied`
  and is not re-sold — the pre-existing rule is untouched.

## 6. Acceptance criteria

1. An office/condo whose satisfaction hits 0 enters `vacating` (not `empty`) with
   the correct attributed cause.
2. While on notice it still pays rent, counts as population, and commutes.
3. Fixing the cause so satisfaction reaches 0.40 before the deadline returns it
   to `occupied`, **silently**.
4. A unit only nursed to between 0.25 and 0.40 at the deadline **still evicts**.
5. Rescinding emits no toast; a mass move-out emits exactly one batched toast.
6. The inspector shows cause + live countdown + target-vs-current for a vacating
   unit.
7. Hotels still evict instantly; the well-zoned endgame tower does not bleed.
