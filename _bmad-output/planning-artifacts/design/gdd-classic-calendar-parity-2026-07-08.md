---
title: "Game Design: Classic Calendar Parity (the canon 12-day year)"
game: Verticopolis (browser SimTower clone)
author: Samus Aran (Game Design, gds agent), with the canon-calendar party
date: 2026-07-08
status: Spec, approved for implementation (owner picked the full-canon scope)
scope: Make Classic run the real 1994 SimTower calendar (12-day year, 3-day
  quarter = 3-day week, weekend every third day) for both the date display AND
  the economic rhythm, without breaking the economy. Give Modern a startup
  toggle between the canon short calendar and today's real-world calendar.
grounds:
  - docs/canon/tdt-format.md §3 (the canon calendar, validated against the game)
  - src/engine/Clock.ts (today's 7-day / 90-day / 360-day derivations)
  - src/engine/Simulation.ts onDay() (rent + maintenance cadence)
  - src/engine/EconomySystem.ts collectRent / payMaintenance
  - arch-classic-calendar-parity-2026-07-08.md (the engine design)
---

# Game Design: Classic Calendar Parity

## 0. The one-paragraph pitch

The real 1994 SimTower runs a compressed calendar: a **year is 12 days**, a
**quarter is 3 days**, a **week is also 3 days** (2 weekdays + 1 weekend), and
the day counter rolls at 11,987 (999 years). Our Classic mode today runs a
real-world 7-day week, 90-day quarter and 360-day year, so its Finance-window
date disagrees with the retail game (our "Year 1" where the game shows "Year
107" for the same save) and its rhythm (how often weekends spike demand, how
often rent lands) is not the 1994 pulse. This change makes **Classic faithful to
the canon calendar** and gives **Modern a choice** between that short calendar
and the friendlier real-world one.

## 1. Why this is a parity feature, not a cosmetic one

The canon calendar is proven, not guessed. Decoding `currentDay` from real saves
and reading the game's own Finance window and load screen:

| Save | `currentDay` | Canon date (this design) | Retail game showed |
|---|---|---|---|
| MYTOWER | 55 | Year 5, Quarter 3 | "Year 5, Quarter 3" |
| TOWER5 | 1280 | Year 107 | "107th Year" |
| TOWER6 | 1289 | Year 108 | "107th/108th Year" |

Our current 7-day/360-day derivation reads day 1280 as "Year 4". So the date
label is objectively wrong against the game we clone.

But the calendar is not only a label. In the retail game the **weekend arrives
every third day** and **office rent is collected every quarter = every 3 days**.
That cadence is the felt pulse of the tower: how often hotels fill on the
weekend, how often retail gets its weekend rush, how often the rent lump lands.
A canon date printed over a 360-day economy would be the real lie: the header
would say "quarterly" while rent actually arrived a season late. Parity means the
**rhythm** matches, not just the words.

It also matters for the TDT round-trip we just shipped. If a real 1994 save is
imported at day 1280 and played on, its next rent collection should land when the
retail game would have collected it. A 360-day economy would collect at times the
real game never would, so a play -> export -> reload loop would drift.

## 2. What the player experiences

### Classic (canon)

- **Date reads like 1994.** The Finance window and date stamp show the canon
  short calendar: `<slot>/<Q>Q/<ord> Year`, with a 3-day week (2 weekday slots +
  1 weekend slot), 4 quarters, 12-day year.
- **Weekends come every third day.** The existing weekday/weekend behavior
  (hotel fill, retail rush, quieter offices) now cycles on the canon 3-day beat
  instead of a 7-day one.
- **Rent is a smaller, more frequent lump.** Office rent collects every quarter,
  which under canon is every 3 days. The amount per collection is scaled down so
  a tower's income **per in-game day is unchanged** from today. You are not
  richer or poorer per day; the money simply arrives in the authentic 1994
  cadence (frequent small lumps) rather than one big 90-day lump. See §3.
- **Maintenance follows the same calendar** instead of the old 30-day "month"
  that is longer than a canon year.

### Modern (choice at New Tower)

- A **startup toggle** on the New Tower flow: **Short (canon)** vs **Real-world**.
- **Real-world is the default** and is exactly today's behavior (7-day week,
  90-day quarter, 360-day year, today's rent/maintenance amounts). A Modern
  player who never touches the toggle sees zero change.
- **Short (canon)** gives a Modern player the compressed 1994 calendar if they
  want the faster pulse.
- The choice is saved with the tower, so it is stable across reloads.

## 3. The economy rebalance (the crux): plain-language contract

The design invariant the player feels is: **money earned per in-game day does not
change when the calendar changes.** Only the *cadence and lump size* of rent and
maintenance change.

- Today: office rent collects once per 90-day quarter, amount `rentOf(u)` per
  office. Daily rent income is therefore `rentOf(u) / 90`.
- Canon: the quarter is 3 days. To keep the same daily income, each collection
  pays `rentOf(u) × 3 / 90 = rentOf(u) / 30`. Thirty times as often, one
  thirtieth the size. Net per day: identical.
- Maintenance is treated the same way against its own period.

We deliberately do **not** use the literal 1994 rent numbers, for two reasons:
(1) the canon rent table is locked in the retail game's un-OCR'd German manual, so
we do not actually have those numbers; (2) our amounts are already re-tuned for
our balance. Income-invariant rescaling is the only path that is both faithful to
the calendar and implementable without numbers we do not have, and it keeps a
tower playing exactly as hard as it does today.

> This is a re-timing of existing money flows, not a new economic system. No new
> sinks, sources, fees, or prices. The condo "patient flight risk" and
> "stars can fall" Modern ideas stay separate features.

## 4. Explicitly out of scope

- **No canon-amount rent table.** Blocked on OCR of the German manual; if we ever
  mine it, adopting real amounts is a separate, later decision.
- **No new economy semantics** (see §3 note).
- **The day counter is not rescaled.** A "day" is still 1440 minutes in every
  mode; only the derived week/quarter/year change. Day-delta timers (VIP visits
  scheduled `day + 3` / `day + 5`) are unaffected by design.
- **No migration of the day count for old saves.** An in-flight Classic save
  keeps its exact history; only the date *label* it shows changes (see the arch
  doc for why that is safe and cannot double-charge rent).

## 5. Acceptance (player-facing)

1. A Classic tower's Finance window date matches the retail game's date for the
   same `currentDay` (spot-checked against MYTOWER / TOWER5 / TOWER6 above).
2. In Classic, a weekend arrives every third day and the existing weekend demand
   behavior fires on that beat.
3. A Classic tower that is financially healthy today is still financially healthy
   after the change: income per in-game day is within noise of today's, verified
   by the parity/endgame balance tests.
4. Rent collects every canon quarter (3 days) in Classic, as a lump about one
   thirtieth of today's, with the "Quarterly office rent collected" toast.
5. New Tower in Modern offers Short vs Real-world; Real-world reproduces today's
   dates, cadence, and amounts exactly; the choice survives save/reload.
6. Importing a real 1994 save and continuing collects the next rent at the canon
   time, and re-exporting keeps the date consistent.

## 6. Validation against the real game (must pass before merge)

Three checks run on the committed Wine harness (`tools/simtower/`):

1. **Weekend phase.** Confirm which day-of-week index the retail game treats as
   the weekend for a known `currentDay`, so our 1-of-3 weekend lands on the same
   day the game does (not merely 1-in-3 at the wrong phase).
2. **Maintenance cadence.** Confirm the retail game's recurring-cost cadence
   against its Finance window, to justify putting Classic maintenance on the
   quarterly (3-day) beat rather than some other period.
3. **Date round-trip.** `currentDay` <-> displayed date is exact for several
   saves (largely already proven in the table in §1).
