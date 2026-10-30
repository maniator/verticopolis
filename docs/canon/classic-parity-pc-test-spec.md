> Durable copy of the project file `release-3.0/classic-parity/pc-test-spec-2026-10-30.md`, copied unchanged on 2026-10-30 so the steps, expected observations and evidence requirements can be reviewed here. The plan for running it is in [classic-parity-pc-run-plan.md](./classic-parity-pc-run-plan.md). Nothing in it has been run yet.

# Classic parity: original-PC test spec (batch 1)

Written 2026-10-30 by the Classic rules thread for the PC thread "Verify .TDT fix in original SimTower". Nothing here has been run. **A run on Naftali's PC needs his go.** Tests are grouped into one session so he approves once; the suite-parking thread's experiments (issue #1524, revised 2026-10-30) are folded in as batch P, with ids PK1 to PK10. Naftali approved the run, including the optional C, F and L scenarios, at 16:16 UTC on 2026-10-30.

Windows SimTower 1.1B is the target. If the PC thread can only reach 1.0, say so in the results: the library records that 1.0 versus 1.1B differences are unknown.

## How to read a scenario

Each scenario has a goal, a setup, steps, what to observe and a pass/fail mapping. "Result A" and "Result B" are the competing answers from the sources; the pass/fail line says which observation selects which. If a run gives neither, record what happened and mark the scenario inconclusive: do not guess. Record every number with the in-game clock time and day.

## Common setup and instruments

- **Base saves.** B3: a 3-star tower, population at least 1,000, two security offices and a housekeeping room, at least $5M, a lobby on floor 1, otherwise plain (offices and a few fast food outlets). B4: B3 grown to 4 stars with at least $2M free. Build every test structure on an empty part of the tower or above it, and save the base before each scenario so it can be repeated. Fast Mode is fine for waiting; read values at normal speed.
- **Instruments in the original.** The Query (magnifying glass) tool on a room or a person; the Elevator Window (waiting-floor numbers in red, car loads, the stop list); the Finance window (the Help file says its figures must be multiplied by 100); the Info Bar messages; the population and star readout; the Theater Window (current movie, income, viewers); the Map window.
- **Evidence to keep.** A screenshot (or photo) of each observation with the clock visible, plus the numbers typed into the results table at the end of this file.
- **Controls.** Change one thing at a time. Where two venues are compared, they must be the same type, in the same state, with the same transport access, read on the same days.

## Batch Q: the five questions marked "test original PC"

### T1: transfers per trip (Q1)

Goal: one transfer or two. The Read Me and manual say once; three GameFAQs guides say twice.

Setup: from B3, with lobbies on floors 1, 15 and 30 (lobbies only go every 15 floors), build three standard shafts: S1 floors 1 to 15, S2 floors 15 to 30, S3 floors 30 to 45. Floors up to 45 built. Put 6 offices on floors 16 to 29 (control, reached with one transfer) and 6 offices on floors 31 to 44 (test, reached with two). Keep security, housekeeping and stairs out of both zones.

Steps: unpause and run 5 game days. Each day read the Info Bar and the office rows at 5 pm.

Observe: tenants and workers in the control zone and the test zone, and any "elevators/stairs too far" or similar message.

Pass/fail: Result A (one transfer): control offices fill, test offices stay vacant or empty out. Result B (two transfers allowed): both zones fill. Inconclusive if the control zone does not fill either.

### T2: where a transfer may happen (Q1)

Goal: whether people change elevators only at a lobby floor (guides say so) or at any floor the shafts share (what ours allows).

Setup: from B3, S1 floors 1 to 10 and S2 floors 10 to 20 side by side so their landings touch on floor 10, which has no lobby. 6 offices on floors 11 to 19 only (reached by one transfer on a non-lobby floor).

Steps and observe: as T1.

Pass/fail: offices fill: transfers work on any shared floor (matches ours). Offices stay vacant: transfers are lobby-floor only (ours is too permissive).

### O1: escalator against elevator (Q2)

Goal: whether the order "escalators, stairs, standard elevator, express" is a real routing preference or only guidance.

Setup: from B3, a fast food outlet on floor 2 with an escalator from the lobby (floors 1 to 2) and a standard elevator that also stops on floors 1 and 2, both landings the same distance from the lobby entrance.

Steps: at the noon rush for three days, count arrivals: Sims boarding the elevator on floor 1 (the red waiting number and car load in the Elevator Window) against Sims on the escalator.

Pass/fail: Result A (escalator always preferred): the elevator carries almost no fast food customers (near-zero boardings) while the escalator is busy. Result B (nearest or fewest-edges): boardings split with distance, or the elevator carries a large share. Repeat once with the elevator landing much nearer the entrance than the escalator to see whether distance overrides the order.

### O2: stairs against standard elevator (Q2)

Same method on an office floor (escalators are not allowed there): offices on floor 2, one flight of stairs linking floors 1 and 2, and a standard elevator with a stop on floors 1 and 2, at equal distance from the offices. Count boardings at the morning rush (8 am). Pass/fail: stairs preferred (near-zero elevator boardings) or not.

### O3: express against standard (Q2)

Setup: from B4, offices on floor 15 with a standard shaft 1 to 15 and an express shaft 1 to 15 (lobby on floor 15). Equal distance from the lobby entrance. Count boardings at the morning rush for three days. Pass/fail: express taken in preference, or the split follows distance or wait.

### E1 to E4: express stops (Q3)

Goal: confirm the Help file rule (every 15th floor whether or not a lobby is built, plus every underground floor) and its edges.

- E1, a 15th floor with no lobby: from B3, lobbies on floors 1 and 30 only, an express shaft 1 to 30, 6 offices on floor 15 beside the shaft (no lobby there, reachable only by that shaft). Pass: workers arrive on floor 15, so the express stops there (Help file correct). Fail: floor 15 stays vacant (lobby-only stops, as ours).
- E2, basements: an express shaft from B6 to floor 1 and 6 fast food outlets on B3 beside the shaft. Also open the Elevator Window and note which stops it lists. Pass: customers reach B3 (stops at every underground floor). Fail: they do not.
- E3, a shaft that ends off a 15th floor: express 1 to 22 and 6 offices on floor 22. Record whether the car stops on 22 (shaft end) or the shaft is refused or short.
- E4, an express shaft that does not start at a lobby: express 5 to 30. Record whether the car stops on 5, on the first lobby floor above, or the build is refused.

For each, also record in the Elevator Window the floor list the game shows for the express shaft and whether any stop can be turned off.

### X1: cinema crowd (Q7)

Goal: 60 against 120 (the wiki infobox says 60, its text, the Room table and one reference say 120), and what the number measures.

Setup: from B4, a cinema on floors 20 and 21 with a new movie, heavy hotel and office population nearby, and plentiful transport. Also read the population readout before and after the cinema is built.

Steps: run 10 game days. At each showtime read the Theater Window "viewers" figure and the day's income, and the population readout one hour before the show, during it, and one hour after.

Observe: the peak viewers in one showing (is it near 60 or near 120?), whether it is a per-showing or per-day figure, whether the upper and lower halves are 60 each, and the population change.

Pass/fail: peak viewers about 60 per showing: Result A (capacity 60). About 120 in one showing: Result B (capacity 120). About 60 per half or 60 per showing and 120 per day: the two numbers measure different things; record both. Population rising by about 120: the census counts 120 (a different unit from attendance).

### M1 to M3: metro (Q8)

Goal: which facilities benefit from the metro, how far it reaches, and whether it acts on demand, visits or income. The Help file and manual say metro riders shop and eat only underground and live and work above ground.

Setup: from B4, funds at least $2M. Save before the metro. The metro cannot be removed, so use the saved base to repeat.

- M1, which facilities: before the metro, place one fast food outlet on B2 and a shop on B3, the same distance from the transport, and one fast food outlet and one shop on floors 2 and 3. Record each venue's daily income at 9 pm (Query tool or Finance window, one venue per category) for 3 matched weekdays. Then build the metro (B8 to B10), repeat for 3 weekdays. Pass/fail: income rises only for the basement venues, or for the above-ground ones too, or for no venue.
- M2, reach: on the same save, place identical fast food outlets on B1, B3, B5 and B7 (one at a time, or in separate runs if income is read from the Finance window) and read daily income for 3 weekdays each, with and without the metro. Pass/fail: record which floors benefit and by how much, and whether the horizontal position of the outlet matters (place two on the same floor at opposite ends).
- M3, mechanism: while the metro is built, read the Map window and the Info Bar for a visitor count, count people arriving at the metro platform at the morning and evening rush, and note whether they walk to venues (visits) or the venue income rises without visible arrivals (income). Record whether population or the star count change.

## Batch R and S: the two separate halves of Q4

### R1: recycling adjacency (Q4, recycling half)

Setup: from B4 with a population above the recycling threshold, a recycling center built on B2 to B3. Try to build a second center (a) touching the first, (b) two floors away not touching, (c) a floor away on the same floors but a gap of one tile sideways.

Observe: whether each placement is allowed, any refusal message, and for an allowed non-adjacent center whether the Info Bar says it is full or idle while the touching one works.

Pass/fail: (b) and (c) refused or inactive: adjacency is enforced (Help file and manual correct). All allowed and working: not enforced.

### R2: the service elevator stop (Q4, recycling half)

Setup: two runs from B4. Run 1: a recycling center with a service elevator that stops on its floors. Run 2: the same tower with the service elevator not reaching those floors. Run each for 7 game days at a population where the center fills.

Observe: the center's fill (Query tool), "recycling full" Info Bar messages, and whether the "recycling demand met" read changes. Also read the star gate if the tower is near 5,000.

Pass/fail: Run 2 shows full or unserved messages and Run 1 does not: the service stop is required (Help file, manual). Both behave the same: not required (kiwizoid's test).

### S1: post-film shopping (Q4, shopping half)

Goal: do visitors shop within five floors of the theater after the film, and what does it do to retail and population.

Setup: from B4 saved before any cinema. Place 4 shops of the same type, two within five floors of where the cinema will be (floors 16 and 18) and two beyond it (floors 28 and 30), equal transport access. Read each shop's sales (Query tool) for 3 matched weekdays. Then build the cinema on floors 20 and 21 with a new movie and read the same four shops for 3 matched weekdays, plus the Theater Window figures.

Observe: the change in sales for the near shops against the far shops, the time of day the change appears (after each showing), and the population readout and star status.

Pass/fail: near shops rise clearly more than far shops after showings: shopping effect confirmed within about five floors. No difference: no post-film shopping effect.

## Batch L, C, F: optional additions (cheap if the session is already running; approved)

- L1, the shared 16 cap (Q5): from a rich save, build cinemas and party halls to a total of 16 in mixed numbers (for example 8 and 8), then try a 17th of each kind. Pass: both are refused (one shared pool). Fail: one kind still builds (separate caps).
- C1 to C5, commercial economics (Q6). These are the experiments already listed in the reference library's unresolved-mechanics file (U03 to U07): C1 fast food income at 9 pm over a week with and without offices (U07); C2 restaurant opening hours and the 11 pm fund change; C3 retail rent period and income (U05); C4 party hall funds at 5 pm and 7 pm on a full day (U06); C5 cinema showtimes (watch the entrance for a day). Record venue capacity (the Query figure) for each facility type while there.
- F1, the maintenance chart (Q9): from B3 note the Finance window's maintenance detail at the end of a quarter, add one facility of one kind (security, then recycling, then medical, then a housekeeping room, then an elevator car, then an express car) and read the change at the next quarter end, remembering the figures must be multiplied by 100. Record per quarter and per month, because the original charges quarterly. Hypotheses from the guides (unverified): standard and service car 10,000 per quarter, express car 20,000, security 20,000, housekeeping 10,000, recycling 50,000, metro 100,000, escalator 5,000, ramp 10,000 (Macintosh FAQ), stairs 0.

## Batch P: suite and office parking (from the suite-parking thread, issue #1524)

Source: `release-3.0/classic-parking/pc-experiments-parking-spec-2026-10-30.md`, the parking audit thread's revised experiments, merged here with ids PK1 to PK10 (the originals were E1 to E10, which clash with the express scenarios E1 to E4 above). Companion record: `classic-parking/classic-parking-audit-2026-10-30.md`. The goal is to find which single condition makes a suite or office fail in the original, and to keep ramp connectivity apart from passenger transport. One change per save, diffed against a control.

**Hypotheses, kept separate.** H1: a stall works only if its ramp column connects up to the ground lobby (the #307 rule). H2: a stall works only if passenger transport (elevator, stairs, escalator) serves its floor. H3: each guest or worker is given a specific stall and fails if it cannot be used. H4: that stall is picked at random. H5: suite demand counts occupied suites, not built suites. H6: missing office parking lowers office evaluation, and at what ratio. H7: evaluation damage persists after the cause is fixed. H1b: the connection runs along the parking floor's tiles, so a gap between stalls does not break it. H8: express elevators stop at every underground floor, and a floor served only by an express counts as served. Today our engine enforces none of these: each ramp seeds its own flood, there is no per-guest stall, and suite demand counts built suites. Parking draws nothing from the RNG, so any randomness found on the PC would be new behavior.

**Factors.** R (ramp column): R1 first ramp under the ground lobby with a stacked ramp on every parking floor; R0 the same column with one middle ramp bulldozed, so lower floors lose their chain (building R0 directly may be refused, so build R1 and bulldoze). S (stall chain): S1 every stall touches a ramp or another working stall; S0 one stall left with a one-tile gap. T (passenger transport to the stall floor): T1 standard elevator with a stop there; T2 express with a stop there; T3 stairs or escalator only; T0 nothing serves the floor. Load: garage sized exactly to the suite count (tight) or double (slack), to separate a count shortage from a route failure.

**Record every run.** (1) On screen: red X on stalls, suite and office evaluation color (Query tool), VIP visit result, star gate, the log lines. (2) A saved `.TDT` to diff: header word at 0x32 (all stalls), the connected-stall count and id list in the parking block (F+274), the stall records in the tail (offset 4,012 from tail start: floor index, ordinal, 4-byte value), unit byte 7 on stalls, hotel stay-state bits per suite, office state byte. (3) Time series: a save at each game hour for the first game day after a change, then once a day for 14 days.

| Id | Experiment | Reading |
|---|---|---|
| PK1 | Control. At least 10 suites, 20 offices, 3 stars or more, garage on B1 and B2 (R1 S1 T1), tight and slack. | No red suites expected. The diff baseline. |
| PK2 | Ramp against transport, 2 by 2: R1 or R0 crossed with T1 or T0, S1, tight load. Four saves. | Failures only for R0 means H1. Only for T0 means H2. Both needed: record the combination. Neither: parking is aggregate in the original too. Check whether the file's connected-stall count drops for R0 and stays for T0. |
| PK3 | Mixed floors: B1 served (T1), B2 not (T0), R1 S1, more suites than B1 holds. Suite colors each evening for 14 days. Repeat from the same save at least 10 times, changing only how many game minutes pass before the first evening. | The same red suites every day points at fixed assignment (H3 without H4). A changing set points at random assignment (H3 and H4). None: H3 false, or guests never sent to B2. |
| PK4 | Recovery (H7): after PK3 shows failures, add the missing stop on B2. Hourly for 3 game days, then daily to day 14. | Red suites turn blue at once, drift back, or stay red. Also record any change in the VIP outcome. |
| PK5 | Express (H8): an express shaft B2 to floor 31. Record the basement floors it stops on by default (the Help file says every underground floor). Then make B2 the only link to the garage floor and repeat the PK2 T2 cell. Also load TOWER7 and read the stop settings of its two express shafts. | Also feeds Q3 (E2). |
| PK6 | Offices: office-only towers of 30, 60 and 120 offices (6 workers each). For each, a garage of 0, a partial size, and the size one-per-four-offices implies, with R1 S1 T1. 14 days of office color and move-in rate. Binary-search the stall count at which office color changes to test the 24-workers-per-space figure. Repeat the 60-office case with T0. | Tests H6 and the unsourced 24 workers per space. |
| PK7 | Occupied against built suites (H5): 20 suites built, rents raised so only 5 or 8 are occupied, stalls set to 6, 12 and 20 in turn. | Red suites, the log and the VIP result show whether demand follows occupied or built. |
| PK8 | Real saves: load TOWER7, MYTOWER and TOWER1 unmodified and record suite and office colors, red X stalls, and for TOWER7 the five parking floors our loader reads as unserved. Save at once and 24 game hours later and diff. For TOWER1 also record the connected-stall count: the file lists 63 stalls, our flood counts 55. | Tells us whether the original serves those floors or our reach model is incomplete. |
| PK9 | Per-stall fields: one ramp, four stalls, one suite, one office floor. Save every game hour across a suite check-in and check-out and across a workday. Diff the tail stall records and unit byte 7. | Learn what the 4-byte value and the 0 or 1 byte are (timer, car id, arrival time, occupant index) before anyone reads randomness into them. |
| PK10 | Stall gaps: TOWER7's own save has a parking row where four stalls sit behind a 1-tile and a 3-tile gap from the ramp, yet the file lists all 125 stalls as connected (ours counts 121). Build a row with no gap, a 1-tile gap and a 3-tile gap, with floor tiles under the gap and without. Record the red X and the connected count in the saved file. | Strict touching (the manual) or tolerates gaps (H1b); whether the connected list is recomputed or can go stale after a bulldoze. |

**Decision rules.** A rule is Classic canon only when an experiment shows it in the original, with the save diff or screenshot kept in the project files. A fan guide, a post or a single unexplained byte is not enough. If PK2 shows both H1 and H2 matter, record the interaction before anything is proposed. Hand back, per run: the save files, the observables above and the matrix cell. The parking audit thread folds results into its record and #1524.

## Suggested order and effort

One session, roughly in this order: E1 to E4 (express), T1 and T2, O1 to O3, X1, S1, R1 and R2, M1 to M3, then the approved L, C, F and P batches (PK1 and PK2 first, since they separate ramp connectivity from transport; PK5 can share a session with E1 to E4). T1 and X1 each need around ten game days and M1 to M2 need matched weekdays, so they run in Fast Mode with readings at normal speed. Expect the full Q batch to take several hours; run E, R1 and O first if time is short because each is quick.

## Results table (fill in)

| Scenario | Version | Date and clock | Observation (numbers) | Evidence file | Pass, fail or inconclusive |
|---|---|---|---|---|---|
