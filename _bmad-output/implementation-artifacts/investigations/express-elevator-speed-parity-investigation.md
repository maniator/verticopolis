# Investigation: Express-elevator speed parity gap

## Hand-off Brief
Every elevator kind in Verticopolis moves at one shared speed (`CAR_FLOORS_PER_MINUTE = 0.8`),
so the express is not faster per floor, only skip-stop and higher-capacity. The 1994 original
describes the express as the *fastest* elevator (a property distinct from its capacity and
lobby-only stops), so this is a genuine, previously unrecorded parity gap. Fixing it is a
localized per-kind speed lookup in `ElevatorDispatch`, with one coupling to watch: the rider
patience budget (`RIDE_SECONDS_PER_FLOOR`) is derived from the same constant.

## Case Info
- Slug: `express-elevator-speed-parity`
- Opened: 2026-07-23
- Type: Exploration + parity-gap (symptom = "express should be faster; it isn't")
- Status: Concluded (root cause Confirmed; exact target speed value is an open design input)

## Problem Statement
Owner intuition: the express elevator should move faster than the standard one, matching the
1994 original. Current behavior under test: it does not. Goal: confirm, map every code path that
depends on the shared speed constant, and produce an evidence-graded finding to feed a spec and
per-kind-speed implementation.

## Evidence Inventory
- **Source code** — Available. `src/engine/ElevatorDispatch.ts`, `src/engine/crowd/person.ts`,
  `src/engine/crowd/motion.ts`, `src/engine/facilityCaps.ts`.
- **Prior parity spec** — Available. `_bmad-output/implementation-artifacts/spec-express-elevator-parity.md`
  (fixed width, lobby-only stops, glass shaft; speed not covered).
- **1994 canon (external)** — Partial. SimTower Fandom wiki, GameFAQs (kiwizoid), GameSurge all
  state the express "travels the fastest," but none give a numeric speed ratio. The original
  **manual** (owner has a copy) is the missing authoritative source for a hard number.

## Confirmed Findings
- **C1. One speed constant for all elevator kinds.** `CAR_FLOORS_PER_MINUTE = 0.8`
  (`src/engine/ElevatorDispatch.ts:17`) is the only car speed. The dispatch move loop applies it
  with no per-kind branch: `const v = carDt * CAR_FLOORS_PER_MINUTE` (`ElevatorDispatch.ts:185`)
  and the park-return step `const step = dt * CAR_FLOORS_PER_MINUTE` (`ElevatorDispatch.ts:162`).
  So a standard, service, and express car cover 0.8 floors/game-minute identically.
- **C2. Express already differs on capacity and span, not speed.** `transportCarCapacity` returns
  express 42 vs standard 21 (`src/engine/facilityCaps.ts:9-15`); `maxSpanFor` gives express the
  whole tower vs standard 30 (`facilityCaps.ts:70-74`). These per-kind lookups are the exact
  pattern a per-kind speed should mirror. No speed table exists.
- **C3. Patience budget is derived from the speed constant.**
  `RIDE_SECONDS_PER_FLOOR = CROWD_SECONDS_PER_MINUTE / CAR_FLOORS_PER_MINUTE`
  (`src/engine/crowd/person.ts:280`), consumed once at `src/engine/crowd/motion.ts:61`:
  `patience = (staff ? STAFF_GIVE_UP : GIVE_UP) + tripFloors(p) * RIDE_SECONDS_PER_FLOOR`.
  The budget scales with the trip's floor count so a long legitimate haul is not culled mid-ride.
- **C4. The prior parity spec omitted speed.** `spec-express-elevator-parity.md` enumerates three
  owner-reported breaks (6-tile width, lobby-only stops, see-through glass). Speed is absent.

## Deduced Conclusions
- **D1 (from C1 + external canon).** The remake diverges from the 1994 original on express speed:
  the original treats "fastest" as a first-class express property; the remake does not model it.
- **D2 (from C3).** If the express is made faster but `RIDE_SECONDS_PER_FLOOR` stays anchored to
  the standard (slowest) speed, express riders simply finish inside a budget sized for the slower
  case, so no rider gives up early. Anchoring patience to the standard speed is the safe direction;
  anchoring it to a per-shaft speed would be more complex (a trip can chain shafts) with the only
  risk being *tighter* budgets, so it is not worth it for this change.
- **D3 (from C2).** The implementation is low-risk and localized: add a per-kind speed lookup
  beside `transportCarCapacity`, and read it by `t.kind` in the two dispatch sites (C1). Keep
  `CAR_FLOORS_PER_MINUTE` as the standard/baseline so C3's patience anchor is unchanged.

## Hypothesized Paths
- **H1. Exact speed ratio.** Status: Open. The sources confirm "faster" but not "by how much."
  Confirm/refute via the original manual (owner's copy) or frame-by-frame retail measurement. Until
  then the spec carries a provisional **1.5x standard** as the single tunable knob, to be replaced
  by a manual-sourced figure if one exists (e.g. a literal "twice as fast" would set 2.0x).

## Source Code Trace
- Speed origin: `src/engine/ElevatorDispatch.ts:17` (`CAR_FLOORS_PER_MINUTE`).
- Movement application: `ElevatorDispatch.ts:162` (park-return), `ElevatorDispatch.ts:185` (serving move).
- Patience coupling: `src/engine/crowd/person.ts:280` -> `src/engine/crowd/motion.ts:61`.
- Per-kind pattern to mirror: `src/engine/facilityCaps.ts:9-27` (`TRANSPORT_CAPACITY` / `transportCarCapacity`).

## Conclusion
Confidence: **High** on the root cause (C1 Confirmed, deterministic). **Open** only on the target
speed *value* (H1), a design input, not a code unknown.

## Fix Direction
Per-kind car speed. Add a `TRANSPORT_FLOORS_PER_MINUTE` table + `carFloorsPerMinute(kind)` in
`facilityCaps.ts` (standard/service 0.8, express faster), and read it by `t.kind` at the two
dispatch move sites. Keep `CAR_FLOORS_PER_MINUTE` as the standard baseline so the patience anchor
(`RIDE_SECONDS_PER_FLOOR`) does not shift. Full spec: `spec-express-elevator-speed-parity.md`.
Next: `gds-code-review` after implementation (gameplay/engine change).

## Status: Concluded (pending the manual's speed figure to finalize H1)

## Follow-up: 2026-07-23 (primary source obtained — premise REFUTED)

The owner supplied the original 1994 SimTower manual (English archive.org OCR + the
complete Italian manual off the game disc, cross-checked). This is the authoritative
primary source, above the fan wikis.

- **H1 (exact speed ratio): REFUTED as to "express is faster."** The manual never states
  a higher travel velocity for the express and gives no speed number for any elevator.
  It attributes the express's benefit entirely to SKIP-STOP, non-stop travel between
  15-floor sets via sky lobbies:
  - (p.47) "The Express Elevator can be used to expedite ... travelers who need to go a
    15-floor or more distance in a hurry."
  - (p.34) "You can't adjust the floors of Express elevators, since they move only between
    sets of 15 stories without stopping."
  - Italian (p.47 equiv): "L'Express Elevator e utile per far viaggiare passeggeri che
    hanno bisogno di coprire una distanza di 15 o piu piani in tutta fretta ... dato che il
    loro tragitto non copre meno di 15 piani per volta, escludendo i sotterranei."
  - Point-blank owner summary from the manual: **"Express is faster: not stated."** The
    speed benefit is skipping floors, never a higher speed or any speed number.

- **C5 (new, Confirmed). The remake ALREADY models the manual's express advantage.** Skip-
  stop (lobby/sky-lobby-only stops, non-stop between 15-floor sets) is exactly what
  `spec-express-elevator-parity.md` implemented and what `expressStops.ts` enforces. So on
  the manual's own terms there is **no speed parity gap**: uniform per-floor speed + skip-
  stop is faithful to the 1994 design.

- **C6 (new, context). The fan wikis over-read "faster trips" as "faster car."** The Fandom
  wiki / GameFAQs "travels the fastest" is not corroborated by the manual and most likely
  compresses the manual's "in a hurry via non-stop 15-floor skips" into a raw-speed claim.
  Secondary sources lose to the primary here.

- **Aside (not this case). The manual's per-car capacities (Standard 17, Service 17, Express
  36) differ from the remake's canon (21/10/42), which is deliberately sourced from the TDT
  save format, tdt-format.md §8, not the manual. So the project already treats the TDT format
  as the numeric canon over the manual prose. For SPEED there is neither a TDT field nor a
  manual number nor a manual "faster" claim, so there is no authoritative basis for a speed
  difference at all.**

### Revised Conclusion
Confidence: **High.** The primary source refutes "the 1994 express is faster per floor." The
remake's uniform car speed plus skip-stop is faithful. A Classic-canon "express speed parity"
fix is therefore **not warranted** and would DIVERGE from the manual, not match it.

### Revised Fix Direction
- **As a parity fix: do nothing.** Do not ship per-kind express speed as Classic canon.
- **If a faster express is still wanted, it is a MODERN-mode gameplay choice** ("what the
  original couldn't do"), explicitly non-canon, gated so Classic is unaffected, and specced
  as a feature rather than a parity fix. Owner's call.

## Status: Concluded — premise refuted by the manual; no Classic parity change warranted.
