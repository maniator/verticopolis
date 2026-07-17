# Decision Log: Housekeeping & Cockroach Overhaul

Game: Verticopolis (SimTower-like browser tower-management sim)
Created: 2026-07-17
State: draft (discovery complete via live playtest session; design calls ratified 2026-07-17)

## Origin

Surfaced from a long playtest on a real 91-floor save (`sixseven_12/13`, appVersion
1.53.0, Classic) plus SimTower canon research. The shipped cockroach-infestation
feature (`gdd-cockroach-infestation-2026-07-16.md`) works, but playtesting exposed
that our housekeeping model diverges from the 1994 original and hides its own
failure from the player.

## Findings that motivate this GDD (evidence-graded)

- **CONFIRMED (code):** per-unit throughput is `HK_ROOMS_PER_CREW = 20`/day, an
  abstract capacity counter. Canon is 6 maids x ~19 = ~114/unit. We are ~5-6x weak.
- **CONFIRMED (code):** cleaning is instant on staff arrival; no per-room dwell,
  no visible cleaning work.
- **CONFIRMED (code):** staff network includes escalators
  (`isStaffTransportKind` = service + stairs + escalator); canon is service-or-stairs.
- **CONFIRMED (code):** our shift is 08:00-19:00 (`HK_SHIFT_START/END`); canon is
  noon-5PM with a 4:30 "no new room" cutoff.
- **CONFIRMED (code):** cockroach spread soils `asleep` (occupied) rooms and zeroes
  occupants, evicting sleeping guests; our own prior GDD said "clean/empty", canon
  says roaches spread "regardless if clean or not."
- **CONFIRMED (code):** dispatch iterates rooms in tower order with no `dirtyDays`
  triage, so about-to-infest rooms get no priority.
- **CONFIRMED (code + save):** the stats "enough housekeeping" verdict subtracts
  infested from the workload, so it reads green while a wing rots (save had 22
  crews "enough", 49 infested).
- **CONFIRMED (code):** the Housekeeping overlay paints infested at severity 0.85
  on the same ramp as unreached (1.0), so terminal-infested reads as a coverage gap.
- **CONFIRMED (code):** infested rooms are never cleaned (dispatch targets `dirty`
  only) and keep spreading; nothing tells the player they are terminal.

## Decisions

- 2026-07-17: Rejected a neural-net dispatcher. Reason: breaks determinism
  (golden-master hashes) and legibility; the problem is a solved OR/scheduling
  task better served by deterministic heuristics. (Party-mode consensus.)
- 2026-07-17: Classic/Modern split. Classic = canon-faithful time-simulated maids;
  Modern = deterministic smart dispatch via `GameRules` (same seam as the
  exterminator). No mode branching in the engine body.

## Design calls (ratified 2026-07-17)

Additional canon found this session (SimTower wiki + FAQs):
- **Only INFESTED rooms spread** ("cockroach-infested rooms spread horizontally...
  even if the other rooms are clean"). Merely dirty rooms do NOT spread. Our
  `dirty || infested` spread source is non-canon and caused the "spread with 0
  infested" spam.
- A unit's **6 maids each work a separate floor** (one maid per floor), so wide
  coverage needs multiple units + a service elevator.
- The **cleaning-priority algorithm is undocumented** in canon (handled
  automatically); no canon order to honor.

Ratifications:
1. **Shift window (owner):** Classic = canon noon-5PM + 4:30 "no new room" cutoff;
   Modern = keep the longer 08-19 day as part of its "better management" fantasy.
   Dwell tuned so ~19 rooms/maid emerges on a compact hotel; throughput emerges
   from simulated walk + dwell, not a hard 20/day cap.
2. **Spread (owner: canon for Classic, party for Modern -> one rule both modes):**
   only INFESTED rooms spread (canon), to adjacent hotel rooms regardless of
   clean/dirty, but spread NEVER evicts a live guest (marks the room; it goes
   dirty at checkout as normal). One spread engine, one golden master. Mode
   difference lives in the recovery TOOLS (exterminator, smart dispatch), not the
   spread rule.
3. **Dispatch (owner: dirtiest-first lean; canon for Classic, party for Modern):**
   Classic = simple opportunistic, one maid per floor, no priority engine
   (dirtiest as a light tiebreak). Modern = days-dirty triage WEIGHTED by travel
   cost, weight pinned and tested, so it rescues about-to-infest rooms without
   commuting the whole shift away. Deterministic; via GameRules. Explicitly not a
   neural net.
4. **Staff network:** drop escalators (Classic canon: service elevator or stairs
   only). Applies both modes.
5. **Throughput model:** replace the abstract `HK_ROOMS_PER_CREW=20` counter with
   6 time-simulated maids/unit walking service/stairs at normal pace + a per-room
   cleaning dwell; rooms clean AFTER the dwell, not on arrival.
