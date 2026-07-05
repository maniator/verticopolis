# Architecture note — Condo stickiness ("an owner, not a lessee")

**Date:** 2026-07-05
**Status:** implemented (draft PR)
**Supersedes tuning in:** `arch-tenant-churn-2026-07-03.md` (office/condo churn), FAQ item **D25**

## Load-bearing invariant

> **A sold condo is an owner, not a lessee.** Office-noise and congestion still
> erode its satisfaction — so it reddens on the satisfaction overlay and reads as
> a worse place to live — but a condo owner is **sticky**: only *sustained,
> unaddressed* office adjacency (≈ a week of continuous exposure) ever wears an
> owner down to a notice, and a *transient* noisy neighbor the player removes in
> time is fully absorbed with no churn. Losing floor access still bottoms a condo
> out immediately (cause: `access`). **The one-time-sale economy is unchanged.**

## Why

The 1994 original's condos were "sticky" — residents were not stress-modeled the
way office workers were. Our engine applied the office-noise erosion to condos at
the **hotel rate** (`NOISE_EROSION = 0.07`, net ≈ −0.02/hr), so a condo next to
an office churned in ≈3 days with no economic downside (condos pay no recurring
rent and sold condos are overhead-exempt), which read to players as a pointless
thrash / "infinite move-in" glitch. This note makes condos behave like owners
while **keeping** the canon "office neighbor is too noisy" annoyance (FAQ M1/D25)
rather than deleting it.

## Mechanism (single-point change)

- New module constant `CONDO_NOISE_EROSION = 0.054` (vs hotel `NOISE_EROSION =
  0.07`). Net drift for a served, uncongested, office-adjacent condo is ≈
  −0.004/hr against the +0.05/hr served recovery → ≈150 game-hours (~6 days) from
  the annoyance cap (0.6) to a notice, then the existing 2-day notice window.
- In `updateSatisfaction`, the shared noise block picks the erosion rate by kind:
  condos use the gentle rate, hotels keep the steep one. Everything else (the
  annoyance cap, congestion, access, the notice/rescind machinery) is untouched,
  so condos still redden and still evict on lost access — only the *noise fuse*
  lengthened.

## Consequences / what deliberately did NOT change

- **Offices** are unaffected — they still churn from noise/rent/congestion.
- **Money** is untouched — one-time sale, `everOccupied` gate, overhead exemption.
- **The `access` walkout** is unchanged: break the tower under an owner (orphan
  the floor) and they still leave promptly.
- **Not implemented:** a hard "condos can never churn from noise at all" rule
  (would reverse D25 outright) and any resale/value economy. Both were considered
  in the design party (2026-07-05) and left as open forks for the owner to call.

## Tests

- `faqComplete.test.ts` **D25 / D25b** retimed to the ~week fuse (semantics
  unchanged: a *permanent* noisy office still evicts, removing it still rescinds).
- **D25c** (new): a *transient* neighbor annoys (satisfaction drops well below
  full) but never puts the owner on notice, and the owner recovers fully once the
  office is removed.
