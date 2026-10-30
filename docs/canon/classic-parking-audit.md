# Classic parking and hotel suite audit (Rust engine)

Snapshot of 2026-10-30, revised the same day after the owner's review. This is a dated research record, not live status. The live record is the engine (`engine-rs/src/services.rs`, `engine-rs/src/tower_query.rs`, `engine-rs/src/tower.rs`) and issue #1524. Nothing here changes a rule, and no gameplay change is authorized. The goal is exact Classic fidelity that keeps existing saves working, so every claim below is graded and every proposal waits for an experiment on the original.

Windows SimTower 1.1B is the canonical game. Macintosh claims are labeled and kept apart. Sources are named, not copied: the Windows Help file (HELP), the Maxis manual (MAN), the GameFAQs guides by kiwizoid (KZ) and MentalMan (MM), the SimTower wiki (WIKI), the Relentless Optimizer reference (RO) and the Macintosh FAQ by BStuart (BS, Mac). The project files hold the working copies under `release-3.0/simtower-final-reference-2026-10-30/`. The measurements on real saves use the nine fixtures in `conformance/fixtures/tdt-reddit/`.

## The claim under test

**Source:** u/AskPizza, "Hotel Suites and Parking", r/SimTower, posted 2026-10-30: <https://www.reddit.com/r/SimTower/comments/1xj65d0/hotel_suites_and_parking/>. The thread was supplied by the owner, who read it on Reddit. Reddit blocks the cloud sandbox this audit ran in, so nobody on this side has fetched the page, and what follows is an own-words summary of what the owner reported, not a quotation. The post's exact wording, its screenshots (if any) and any comments beyond the one below are not in this record. Which game the author plays is not stated in what we have: a commenter asked whether it is the original SimTower or Yoot Tower, and no answer was visible. So the post is not yet evidence about Windows 1.1B at all.

The account is split in two on purpose. The first part is what the author says they saw. The second is what they think explains it. The audit treats the first as a lead and the second as a set of hypotheses.

**What the author reports seeing (player-observed, unverified by us):**

- Hotel suites sometimes turn red and stay red while total parking capacity looks adequate.
- The failures look unpredictable and can show up years into a tower's life.
- Their workaround is to put suites near the ground lobby, with a dedicated express elevator that serves every parking floor. The post does not say how well it worked.
- The author's own rough estimate is about one parking space per four offices.

**What the author infers (the author's mechanism, not observed):**

- Each suite guest is given a random space somewhere in the garage.
- That space needs a usable transport route to the guest's suite.
- A guest given an unreachable space can make the suite's evaluation collapse, and repeated arrivals make the failures look random.
- Offices do not suffer the same route-dependent penalty.

None of these inferences has support in our reference set (see P5), and none is marked verified here. The one-space-per-four-offices figure agrees with the 24 workers per space our engine uses if an office holds 6 workers, but it is a second unsourced estimate, so it does not confirm P9.

## Confidence scale

- **Documented**: stated by HELP or MAN.
- **Guide-reported**: stated by one or more fan guides written for the Windows game, not by HELP or MAN.
- **Mac-only**: stated only for the Macintosh game.
- **Community-observed**: reported from play, no source text.
- **Inferred**: deduced by us from saves or code.
- **Unverified**: no evidence either way.

## Separate hypotheses

These stay separate. Evidence for one is not evidence for another, and no implementation work combines them until the original shows how they relate.

| Id | Hypothesis | Today in our engine |
|---|---|---|
| H1 | A stall works only if its ramp column connects up to the ground lobby (#307) | Not enforced: each ramp seeds its own flood |
| H1b | Connection runs along the parking floor, so a small gap between stalls does not break it | Strict touching only |
| H2 | A stall works only if passenger transport serves its floor | Not enforced |
| H3 | Each guest or worker gets a specific stall and fails if it cannot be used | No per-guest stall |
| H4 | That stall is picked at random | No assignment at all |
| H5 | Suite demand counts occupied suites, not built suites | Counts built suites |
| H6 | Missing office parking lowers office evaluation, at some ratio of offices to stalls | Halves move-in only |
| H7 | Evaluation damage persists after the cause is fixed | Not modeled |
| H8 | Express elevators stop at every underground floor | Our loader strips the file's basement express stops |

## What the engine does today

The TypeScript reference in `src/engine/` has the same parking logic, function for function (`suiteParkingShort`, `officeParkingShort`, `functionalParkingSet`, the move-in penalty and the congestion relief). The Rust engine is the one the game runs.

| Question | Rust engine |
|---|---|
| What makes a stall working? | A flood from every operational ramp, sideways along its floor and up or down through ramp tiles (`Tower::functional_parking_set`). Recomputed on each call, not memoized. |
| Does the ramp column have to reach the lobby? | No. Each ramp seeds the flood on its own. Tracked as #307. |
| Does the stall's floor need elevator or stair service? | No. Nothing in the flood or the shortage test reads transport. |
| How is a suite shortage decided? | Working stalls fewer than the suites that are not under construction, burned or gutted (`suite_parking_short`). |
| Is a stall ever assigned to a guest? | No. There is no per-guest or per-suite stall, and guests are not agents that drive anywhere. |
| Is anything about parking random? | No. The parking reads draw nothing from the RNG. |
| What does a suite shortage do? | One info toast and the VIP outcome: a happy VIP leaves with the "circled the block" line and `vip_favorable` stays false, which holds the 4-star gate (`maybe_vip_stay`). It never touches a suite's satisfaction, color or move-in. |
| What does an office shortage do? | Halves the daily office move-in chance (`attempt_move_ins`). Suites reserve spaces first. It never touches an office's satisfaction. |
| Does parking appear in evaluation? | No. `satisfaction_step` has no parking input. The only other reader is a congestion relief of 2 percent per working stall (`presence.rs`). |

## Findings

| # | Finding | Status | Confidence |
|---|---|---|---|
| P1 | Ours has no per-guest stall, so the mechanism the author describes cannot occur. Ours errs optimistic. | Engine fact | High |
| P2 | A ramp-chained garage counts as working with no transport to its floors. | Engine fact; Classic rule unknown (H2) | High (engine), Low (canon) |
| P3 | Suite demand counts built suites. MAN says occupied ones. PC guides say one per suite. | Source conflict (H5) | Medium |
| P4 | WIKI and KZ tie office parking to evaluation. Ours cuts move-in only. | Likely gap (H6) | Medium |
| P5 | Random assignment, a per-space route requirement and lasting evaluation damage are the author's inferences (r/SimTower, 2026-10-30). Nothing in our reference set supports them, and the post does not say which game it is about. | Unverified (H3, H4, H7) | None |
| P5a | Suites turning red with adequate total parking, unpredictably and late in a tower's life, is a player report with no save or screenshot in our hands. | Community-observed, unverified | Low |
| P5b | Suites near the lobby with an express serving every parking floor is the author's workaround. | Community-observed, untested | Low |
| P6 | The original keeps a value per stall in its saves. What it is, is not known. | Unknown | Low |
| P7 | Our ramp flood matches the game's connected-stall list on eight of nine saves; TOWER7 differs by four stalls. | Lead (H1b) | Medium |
| P8 | Our loader removes the basement stops the file's express shafts carry. This alone makes TOWER7, TOWER1 and MYTOWER look like they have unserved parking floors. | Defect in the loader (H8) | High |
| P9 | The 24-workers-per-space figure comes from an internal design note, not from a source. | Source unconfirmed (H6) | Medium |

### P2 and P8: transport to the garage

Guide-reported: KZ's three-star walkthrough says suites take parking spaces, so the elevators must reach down to the parking levels, and that an express shaft must reach B2 or offices on floor 30 and above cannot be reached. MAN says parking needs stairs or elevator access. Neither says what a guest does when a stall's floor has no service.

Probe, Rust engine, Classic, 3 stars, seed 7 (scratch test, not committed): lobby on floor 1, three suites on floor 3, a standard elevator on floors 1 to 4, one ramp on B2 with six stalls. Floor reachability of B2 is false, working stalls 6, no shortage, suites check in on day 0 and the VIP is favorable that evening. The same layout with the elevator on B2 to 4 gives the identical result. Connectivity of the stall floors is invisible to the suite, the VIP and the star gate.

**The unserved parking floors in real saves are a loader artifact.** An earlier version of this audit read TOWER7 (five of nine parking floors without a route), MYTOWER (one) and TOWER1 (eight) as a sign the original might not need service on every parking floor. That reading was wrong. The cause is `Tower::coerce_express_stops` (`engine-rs/src/tower.rs`), which on every load re-skips each non-lobby floor strictly inside an express shaft's span, basements included. The imported JSON still carries the file's own stops. After load, TOWER7's two express shafts stop on no basement floor except their bottom. MAN says an express stops on every floor that can hold a lobby and on all underground floors, and the file agrees: its express floor entries cover every basement floor.

Counterfactual, same scratch test with the file's own express stops restored after load:

| Save | Parking floors unserved as loaded | Unserved with the file's express stops |
|---|---|---|
| MYTOWER | 1 (B7) | 0 |
| TOWER1 | 8 | 0 |
| TOWER2 to TOWER6 | 0 | 0 |
| TOWER7 | 5 (B4 to B8) | 0 |

So all nine real towers keep every parking floor served by passenger transport in the original. That fits KZ, but it does not prove the game requires it: players may simply build it. It does mean TOWER7 is a compatibility case. Any rule that drops stalls on unserved floors would wrongly drop TOWER7's, MYTOWER's and TOWER1's unless the express-stop loader behavior is fixed first. That is row 24 of `classic-shop-audit.md` (express stops), which the Classic rules thread owns, now with a concrete import consequence.

### P3: occupied versus built suites

MAN's suite entry says a suite holds two guests and that occupied rooms need a parking place. KZ, MM and others say one space per suite. BS (Mac) says one or two per room. Ours follows the guides and counts built suites.

TOWER6 is a 5-star save with 115 suites, 81 stalls and only 27 suites asleep at save time (88 dirty): our rule reads that as a shortage and an occupied-only rule does not. TOWER4 (140 suites, all asleep, 333 stalls) and TOWER2 (101 suites, 81 asleep, 281 stalls) pass either way. A star never decreases, so TOWER6's 5 stars do not prove the original was satisfied at the save.

### P4 and P9: offices and the 24 constant

WIKI and KZ both tie office parking to evaluation, and the wiki lists hotels and offices as wanting parking nearby. Ours reduces new move-ins only.

The 24-workers-per-space figure (`PARKING_WORKERS_PER_SPACE`, `src/engine/census.ts`, copied to Rust) was set on 2026-07-06 by the internal parity design note (`gdd-simtower-parity-2026-07-06.md`, section 6.1), which says the original asks for one space per four offices and an office holds 6 workers. The note cites no source, and the final reference set has no row that says "one space per four offices". Treat the constant as unconfirmed until experiment E6 finds the threshold in the original.

### P6: the per-stall data

The original stores something per stall, in two places, and we do not know what it means. We have not inferred any assignment or randomness from it.

- **Tail stall records** (offset 4,012 in the tail, 512 records of 6 bytes): floor index, an ordinal, then a 4-byte value. The value is zero in MYTOWER and TOWER1 and nonzero for some stalls in the other six saves (for example 54 of 125 in TOWER7, 196 of 333 in TOWER4), ranging from 14 to 9,294. It looks like a counter or timer. Nothing links it to a guest.
- **Unit record byte 7** on stall units: 0 in six saves, and 1 on a block of stalls in TOWER2 (25), TOWER3 (85) and TOWER4 (85). The flagged stalls form contiguous runs, and the count does not track suites or workers present.
- **The connected list** (parking block): ids are record indexes into the tail records, so they need not run from 0 to n. TOWER3 and TOWER4 skip ids 128 to 135, which fits eight deleted records.

Experiment E9 diffs these fields over time on a tiny tower to learn what they are.

### P7: the ramp flood against the game's connected list

The parking block of each save holds a connected-stall count and the connected record indexes. Located by file layout (not by pattern), compared with our working-stall count after load:

| Save | Stalls | File connected | Ours working | Note |
|---|---|---|---|---|
| MYTOWER | 174 | 174 | 174 | |
| TOWER1 | 63 | 55 | 55 | see below |
| TOWER2 | 281 | 281 | 281 | |
| TOWER3 | 333 | 333 | 333 | |
| TOWER4 | 333 | 333 | 333 | |
| TOWER5 | 81 | 81 | 81 | |
| TOWER6 | 81 | 81 | 81 | |
| TOWER7 | 125 | 125 | 121 | four stalls differ |
| TOWER8 | 0 | 0 | 0 | |

An earlier version of this audit called TOWER1 "agreement" without saying why 63 stalls give 55. The eight missing spaces are stalls the game itself lists as disconnected: the connected indexes run 0 to 54, and records 55 to 62 are the stalls on file floors 1 to 7 at ordinal 1, plus ordinal 2 on floor 7. Those map to the eight isolated stalls (x 217 and 221, B2 to B8) that our flood also finds dead. So TOWER1 is a match in both count and identity.

TOWER7 is a real difference. On file floor 5 (our B4) the row has stalls at x 130 to 138, then 141 to 149, then the ramp at 150, so there is a 3-tile and a 1-tile gap. The game still counts all four as connected, and ours does not. Either the game's list went stale after the player moved stalls, or its connection test tolerates small gaps (H1b). The manual says each space must connect to an adjacent one, which favors the stale list, but a stale list in a shipped save is a guess. Experiment E10 tests gaps directly. Until then our strict touching rule stays.

## The author's mechanism, in our terms

If the original assigns each guest a stall and routes them stall to suite, a suite could fail when its guest draws a stall on a floor the transport does not serve, even though the stall count is fine. That is the author's inference, restated. The sources do not confirm per-guest assignment, randomness or lasting damage, and the per-stall bytes do not either. Treat the whole chain as unverified.

Two things to keep apart when reading it. The symptom (red suites with enough stalls) could have causes the author did not consider, such as H5 (demand counted differently) or H2 (the garage floor is not served) with no per-guest stall at all. And the workaround (a dedicated express to every parking floor) would help under H2 or H8 as well as under the author's theory, so its working would not distinguish them. E2 and E3 are built to tell these apart.

No gameplay rule changes on the strength of the post. A rule changes only when Windows 1.1B shows it in a PC run with the save or screenshot kept in the project files (PK1 to PK10).

## Tests to write before any rule changes

All are deterministic, run on the Rust engine, use a fixed seed and a Classic tower, and pin today's behavior first so a later change shows as a reviewed diff.

| # | Scenario | Asserts today |
|---|---|---|
| T1 | Garage on B2, elevator B2 to 4, three suites | 6 working stalls, no shortage, VIP favorable |
| T2 | Same, elevator 1 to 4 only (sufficient but disconnected) | same result as T1 |
| T3 | T2, then an elevator is added down to B2 | nothing changes |
| T4 | Two parking floors, one served, suites above the served floor's capacity | no shortage |
| T5 | 24 workers per space short by one, no suites | move-in chance halved, office satisfaction unchanged |
| T6 | Offices and suites together | suites reserve spaces first |
| T7a | Snapshot `Rng::seed()` before and after each parking read: `functional_parking_set`, `parking_demand`, `suite_parking_short`, `office_parking_short`, `nudge_service_shortfalls`, the parking branch of `maybe_vip_stay`, `parking_usage` | state unchanged by every call |
| T7b | Two otherwise identical sims, garage large versus too small, one call to `attempt_move_ins` | RNG state equal after the call (`chance` draws once whatever its odds) |
| T8 | Save and load T2 | parking read identical |
| T9 | Import the nine fixtures | working stalls equal the table above; no suite or office color or star changes for TOWER2 to TOWER6 |
| T10 | Import TOWER7 | pins the four-stall difference as a known gap, and the express basement stops as lost on load, so the express fix shows as a diff |

T7a and T7b isolate the parking code from everything else in the run. A whole-game comparison would also differ for unrelated reasons, so it is not used.

## Experiments on the original (not run)

The full spec is `release-3.0/classic-parking/pc-experiments-parking-spec-2026-10-30.md` in the project files, handed to the Classic rules thread for its combined PC test spec. Each run needs the owner's go and the PC thread. The matrix keeps ramp connectivity apart from passenger transport:

- **E2** crosses ramp column (connected, or broken by bulldozing a middle ramp) with transport to the garage floor (served or not), stalls touching, tight garage. The file's connected count separates H1 from H2, and the suite colors show which one makes a suite fail.
- **E3** puts one served and one unserved parking floor in a tower with more suites than the served floor holds, and watches 14 evenings, repeated from the same save with different start offsets, to see whether failures are a fixed set or vary (H3, H4).
- **E4** adds the missing stop afterwards and watches hourly and daily whether red clears (H7).
- **E5** builds an express over the basements and loads TOWER7 to settle H8.
- **E6** measures office evaluation against stall count for 30, 60 and 120 offices, with and without transport, to test the 24 constant and H6.
- **E7** raises rents so few suites are occupied, with stalls between occupied and built (H5).
- **E8** loads TOWER7, MYTOWER and TOWER1 unmodified and reads their colors.
- **E9** diffs the per-stall fields over game hours (P6).
- **E10** tests stall gaps (H1b, P7).

## Smallest accurate Classic-only change, once the original is known

Each step applies only if an experiment shows the rule. They are separate changes in separate PRs, and none touches Modern.

1. **Express basement stops (H8, P8).** Stop `coerce_express_stops` and `set_express_stops` from dropping underground stops for Classic, to match MAN and the file. This is a loader and rule fix with its own risk (row 24 of `classic-shop-audit.md`) and it must land before step 2 or any rule that reads the service of a floor. Compatibility: changes reachability of basement floors for any imported or saved Classic tower that has an express over its basements, usually toward more service. The conformance lock and the catalog digest may move.
2. **Transport to the garage floor (H2), only if E2 shows it.** Filter the working-stall set by whether the stall's floor is in the served-floor set the tower already memoizes per revision (`is_floor_served`). No per-guest search and no new state. Cost: one hash lookup per stall the flood reaches, at most 512 stalls, and the flood itself is the part worth memoizing per revision if profiling asks for it (hot-path checklist applies). Compatibility: after step 1 the nine real saves lose no stalls. A save with an unserved garage floor would read short on its next load, so the existing suite-parking toast and the stats "working" count must say why, and the change takes the next app version because players can notice it.
3. **Ramp column to the lobby (H1), only if E2 shows it.** This is #307, with its safeguards unchanged: a healing migration that builds the missing ramp so no existing parking dies, one spatial change per load, one honest toast, and no legacy flag in the flood. It does not ride with step 2 unless the experiments show the two are one rule.
4. **Occupied demand (H5) and office evaluation (H6)**, only if E6 and E7 show them. Demand by occupied suites is a count over units the shortage test already walks. An office evaluation term reads the same shortage flag in `satisfaction_step`.
5. **Per-guest stall assignment and randomness (H3, H4, H7)** stay out until the original shows them. If it does, the first model to try is an expected-failure fraction per floor, which avoids a path search per guest and keeps the tick within budget.

Each step needs: a reviewed proposal, deterministic tests for the changed rule and for the nine saves, a before and after cost reading, and `/gds-code-review`.

## Recommended next steps

1. Ask the author, through the owner, which game they play and for a save or screenshot of a red suite with its garage, if they are willing. Nothing is posted from this repo.
2. The Classic rules thread holds E1 to E10 as PK1 to PK10 in its combined PC spec, and the PC thread runs them (the owner approved the run on 2026-10-30).
3. Land T1 to T10 as characterization tests once the evidence is in.
4. Decide step 1 (express basement stops, #1532) on its own merits. It is a loader defect shown by the file's own express stops on three of the nine saves, and it does not depend on the Reddit theory. Keep it out of any speculative parking change.

Nothing here touches the 3.0 release gates.
