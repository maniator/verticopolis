---
title: "Party Findings — Tenant Churn (the `vacating` notice period)"
event: Game-design / UX round-table on PR #109
date: 2026-07-03
room: Samus Shepard (Game Designer), Cloud Dragonborn (Game Architect), Sally (UX Designer), Paige (Technical Writer)
relates_to:
  - PR #109 (maniator/simtower-llm-style) — the vacating mechanic
  - _bmad-output/planning-artifacts/design/gdd-tenant-churn-2026-07-03.md
  - _bmad-output/planning-artifacts/design/arch-tenant-churn-2026-07-03.md
---

# Party Findings — Tenant Churn

A round-table convened to settle two open judgment calls left by the PR #109
deep review, and to surface anything else the mechanic implied. This is the
durable record: what was decided, what shipped, and what is deliberately left as
follow-up work.

## The room

| | Voice | Pushed for |
|---|---|---|
| 🎮 | **Samus Shepard** — Game Designer | Teeth. Churn must *cost* the mid-tier player, or the mechanic is decorative. |
| 🏗️ | **Cloud Dragonborn** — Game Architect | No unverified constant; no reopening the toast-spam commit; invariants written down. |
| 🎨 | **Sally** — UX Designer | Inform before you hurt. The eviction must never be a surprise. |
| 📚 | **Paige** — Technical Writer | The argument itself is proof the design note has to exist. |

## The two decisions (shipped on PR #109)

### 1. Is the grace window too forgiving? — **Decision: hurt them, but inform prior.**
- **Rescind bar 0.25 → 0.40.** A tenant merely *stabilized* off the floor (but
  never made genuinely decent) still evicts — "stabilized ≠ fixed". A real fix
  still reaches 0.40 in ~8 served hours, well inside the window.
- **Notice window kept at 2 in-game days.** Cloud vetoed shortening it: a shorter
  window reopens the per-rush-hour eviction spam that a prior commit spent effort
  killing.
- **"Inform prior"** is the price of the harsher bar: the inspector shows a live
  countdown (framed as an honest upper bound, "Leaves in under N hours") plus the
  recovery target vs. current satisfaction ("get to 40% to keep them, now 30%").
  Sally's legibility fix is what bought Samus's buy-in on the teeth.

### 2. Should the missing design note be back-filled? — **Decision: yes, required.**
- Every sibling feature under `design/` ships a `gdd-`/`arch-` pair; this one had
  none. Back-filled both, with the **load-bearing invariants at the top of the
  arch doc** (Cloud's ask) so a future tuner gets the red flag before touching a
  constant.

## Full recommendation ledger (from the deep review + party)

| # | Recommendation | Status |
|---|---|---|
| 1 | Stop the toast-spam / limbo loop (silent rescind, batched notices) | ✅ Shipped (#109) |
| 2 | Show countdown + recovery target in the inspector | ✅ Shipped (#109) |
| 3 | Fix or drop the unreachable `noise` cause | ✅ Dropped (#109) |
| 4 | Tune the window vs. recovery for real pressure | ✅ 0.40 retune (#109) |
| 5 | Transport-neutral, escalator-inclusive cause copy | ✅ Shipped (#109) |
| 6 | Back-fill the `gdd-`/`arch-` design pair | ✅ Shipped (#109) |
| 7 | Reconsider counting `vacating` toward the **star** population | ✅ Resolved — keep (investigated) |
| 8 | Let office **noise** actually evict (re-add the `noise` cause) | 🔲 Open — deferred mechanic |
| 9 | Confirm the amber ribbon doesn't churn demo **screenshots** | ✅ Resolved — no risk (investigated) |
| 10 | **Playtest** the churn feel (teeth, not tedium) | 🔲 Open — needs a human |

*Post-party investigation (2026-07-03) closed F-7 and F-9; see their sections.*

## Open follow-up backlog (the "other findings")

### F-7 — Should a tenant *on notice* still prop a star gate? — ✅ RESOLVED: keep
`isPresent` counts `vacating`, so a unit actively leaving still credits the star
rating. The worry was that a tower could sit *propped* at a star threshold on
tenants who are perpetually "leaving."

**Investigation (`Simulation.evaluateStar`):** the star ladder is **monotonic —
it only ever raises** (`if (target > this.star) this.star = target`); a tower
*never demotes*, for any reason, including normal population loss. So counting a
`vacating` unit can only marginally affect the *instant* a tower first crosses a
threshold — it can **never** cause a star to be lost, and the "propped up"
scenario doesn't exist (once earned, the star is latched regardless of who
leaves).

**Decision: keep as-is (option a).** A `vacating` tenant is physically present
and paying rent at the evaluation instant, so counting it is consistent with
population/rent; excluding it would add a special case (rating ≠ population) for
no real benefit, and would make crossing a star feel inconsistent ("I have the
population but two units are mid-notice, so the star won't tick"). The arch-doc
invariant #4 already records that `vacating` counts; the monotonic-star fact is
why that's safe. *(A future design could still choose (b) if star **demotion**
is ever introduced — at which point this becomes a live question again.)*

### F-8 — Make office noise a slow drain, not just a cap (deferred mechanic)
Today office-noise only *caps* an adjacent hotel/condo at 0.6; it can annoy but
never evict, which is why `noise` was dropped as a vacate cause. Office-noise is a
canonically important SimTower complaint, so a future pass could let the cap
*decay* below the rescind bar over sustained exposure — at which point `noise`
returns as a real, attributable eviction cause. Out of scope for #109 (it's a new
mechanic, not a fix). — Sally & Cloud.

### F-9 — Screenshot stability of the on-notice ribbon — ✅ RESOLVED: no risk
`gdd-legibility` principle #5 says nothing new should recompute on the tick loop
for the demo screenshots.

**Investigation (`scripts/screenshots.mjs`):** the showcase tower is built
**fully served** (elevators reach every floor: 1→15→30→40, express, stairs) with
every unit force-set `occupied`/`asleep` at `satisfaction: 1` (`Tower` default).
The capture runs at `speed = 2` for windows of ~0.3–1.5 s. For the ribbon to
appear, a unit's satisfaction must bleed **1.0 → 0**, which needs ~20+ sustained
*unserved/congested* game-hours — impossible in a served tower, and orders of
magnitude beyond a sub-2-second capture. The existing `phase2` test already
proves a served tower ticked for **8 game-days** produces **zero** `vacating`
units. The ribbon is also drawn purely from `state` (no per-tick animation).

**Conclusion: the ribbon can never appear in the demo screenshots; stability is
preserved. No change needed.** (If a future demo deliberately captures an
*unhealthy* tower, gate the ribbon out of that specific capture.)

### F-10 — Playtest the 0.40 feel
The entire point of the retune is to make a *mediocre* (served-but-congested)
tower lose tenants. That's a feel claim only a human playtest can confirm: is it
teeth, or is it tedium? Recommended before the next balance pass touches
`VACATE_RESCIND` / `VACATE_NOTICE_MINUTES`. — Samus.

## Running bit, for the record

> "The doc is the fix for the thing we were all afraid of." — the room, converging.
