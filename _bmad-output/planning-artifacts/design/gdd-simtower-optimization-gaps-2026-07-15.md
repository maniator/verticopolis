# SimTower Optimization-Thread Gap Analysis and Roadmap (2026-07-15)

Status: roadmap / gap analysis. This is a planning artifact, not a build spec. It
reads an in-depth r/SimTower optimal-tower-design thread against the current
Verticopolis engine, sorts every mechanic into already-tracked, net-new, or
will-not-build, and records the Classic-parity vs Modern split and a priority
order. Each net-new item has a backlog row and a GitHub issue; each ships later
as its own spec plus PR with the correct review skill.

## Why this exists

A player shared a long, careful optimization thread (a min-maxer filling all 110
stories at maximum width while keeping every facility evaluation high). It is a
useful outside audit of what a devoted SimTower player leans on: deep per-elevator
tuning, cross-venue patronage, housekeeping and service-elevator math, the star
gates, distance penalties, and a suspected hidden "commercial abandonment" cap.

We ran a four-lens roundtable (game design, systems/economy design, engineering,
and UX/UI) against a full inventory of the current engine. The lenses converged
on one reading:

> Verticopolis has faithfully built the demand side of SimTower (all 20 room
> types, the star gates, events, housekeeping, the canon calendar) and skipped
> most of the traffic-shaping counterplay side. The deep systems it does have are
> largely invisible in the UI. That counterplay, and its legibility, is where the
> thread's whole skill ceiling lives.

The classic loop is: you build to attract population, population creates traffic,
traffic congestion destroys satisfaction, and you fight congestion by shaping how
people move and where they eat and shop. We have the first three quarters of that
loop. The missing quarter is the set of levers the player pulls to win the
congestion fight, plus the feedback that makes those levers legible.

## Current state (what is already faithful)

Confirmed present and canon-faithful in `src/engine/`:

- All 20 room and service types, multi-story facilities, basements B1 to B10.
- Transport pooling exactly per canon: one shared 24-shaft elevator pool
  (standard, service, express), a separate 64-link stairs/escalator pool, 8 cars
  per shaft, canon spans. Five transport types with canon car capacities.
- Star gates: population thresholds plus security at 3 stars; medical, recycling
  demand met, two-plus suites, and a favorable VIP review at 4 stars; metro at 5
  stars; Wedding Hall plus 15,000 population for TOWER.
- Events: fire spread with security/medical containment, bomb threat, thief, VIP
  inspection, buried treasure, seasonal Santa cameo, blockbuster cinema bookings.
- Housekeeping with checkout-to-dirty, staff-network routing, and cockroach
  spread. Parking demand including a space per hotel suite for the VIP.
- Individually routed commuters over a BFS transport graph with a two-ride limit,
  a congestion model, and satisfaction erosion (W1 transport-far, W2 noise, W3
  commercial lobby-distance income penalty).
- The canon 3-day-week calendar, the 1994 "breathing clock" pacing, four daily
  meal windows with real per-person round trips, weekday/weekend presence.
- TDT import and export of real 1994 saves, verified round-trip on native saves.
- A three-mode heat overlay (congestion / occupancy / satisfaction), rich
  per-facility diagnostics, an income breakdown, elevator utilization stats, a
  retail patronage verdict block, and a milestones checklist.

## The gap classification

### A. Already tracked or shipped (reference only, no new issue)

| Thread mechanic | Where it lives |
| --- | --- |
| Deep per-elevator scheduling (Waiting Car Response, Standard Floor Departure, per-shift car schedules, home/waiting floors) | `elevator-scheduling` #305 (owner tiebreak 2026-07-08: FULL PARITY, epic, spec-first). The single biggest system in the thread, already owned. |
| Hotel guests joining lunch trips | `per-person-meal-round-trips` #304 (partial; hotel-gate remainder) |
| Elevator shaft load-balancing across equivalent shafts | `elevator-dispatch-balancing` #303 |
| Commercial lobby-distance income penalty (W3) and its legibility | present as W3; refinements in `w3-basement-depth` #329, `w3-push-signal` #330 |
| Live traffic HUD chip (names the worst floor) | present; tap-to-hotspot follow-up is `traffic-chip-tap-to-hotspot` #372 |
| Editor "access too far" (3-plus rides) state | `editor-access-too-far-state` #370 |
| Discrete Classic rent ladder vs continuous Modern | `pricing-split` #299 |
| Condo household morning departures; named tenants | `gdd-condo-household-departures-2026-07-08`; `named-tenants` #381 |
| Modern star-falling; hotel infested/sticky states; hotel "Twin" naming; stairs willingness canon; a11y shaft congestion overlay | #374, #376, #380, #384, #373 |

### B. Net-new (backlog row plus GitHub issue)

Weighted across all four areas the player asked us to consider (traffic and
elevators, commercial economy, tenant life, UI legibility).

| Story | Area | Issue | Type / Prio | Summary |
| --- | --- | --- | --- | --- |
| `commercial-demand-pools` | Commercial | #393 | feature-request, P2 (epic, spec-first) | Replace the tower-wide `trafficAppeal` scalar with a per-origin demand budget split across reachable venues. Restores diminishing returns, cross-venue lift, and makes the "abandonment limit" emergent. Economy core, needs a golden calibration test. |
| `graduated-lobby-distance-eval` | Tenant life / Traffic | #394 | feature-request, P2 | Extend the office-only W1 far penalty into a graduated far / very-far satisfaction drain keyed on floors from the nearest (sky)lobby, for office/condo/hotel, caps-not-kills, with a `lobbyFar` vacate cause. Motivates sky lobbies. |
| `leave-tower-unmet-demand` | Tenant life / Commercial | #395 | feature-request, P2 (depends on #393) | A soft satisfaction drain when a tenant's reachable local-venue coverage falls below a floor, routed into the existing vacate path. Couples venue mix to population to star gates. Operates on the census, not the drawn crowd. |
| `contiguous-skylobby-transfer` | Traffic | #396 | feature-request, P3 (Classic-gated) | Make express/standard transfers explicitly require a contiguous sky lobby, vs today's implicit shared-stop adjacency. Routing-admissibility change, gated via `gameRules.ts`. |
| `condo-demographic-routines` | Tenant life | #397 | feature-request, P3 (Modern) | Add school-run and office sales-call outbound trips, faked statistically as spawn-mix and timing biases. Builds on the condo-departures GDD. Texture and rhythm. |
| `weekend-patronage-curve` | Commercial | #398 | feature-request, P3 (small) | Add explicit weekday/weekend multipliers to the commercial money loop so the canon 3-day calendar is economically legible. |
| `star-blockers-checklist` | UI | #399 | feature-request, P2 | A "what is blocking my next star" checklist from the existing `star.ts` gate booleans. Data already computed; near-zero cost; fixes the silent stall. |
| `inspector-eval-reason` | UI | #400 | feature-request, P3 | Surface the dominant `vacateCause` in the inspector before a tenant is on notice, as one plain-language "Main gripe" line. |
| `housekeeping-coverage-overlay` | UI | #401 | feature-request, P3 | A fourth heat-overlay mode tinting dirty rooms and floors outside service-elevator reach, reusing the heatmap pipeline. |

### C. Deliberately will-not-build (rationale recorded, no issue)

- **Housekeeping "6 floors good, 7 breaks pathfinding" quirk.** That is an exploit
  of a 1994 pathfinding defect, not a designed mechanic. Reproducing it faithfully
  would mean shipping a bug and calling it canon. Keep the clean staff-network
  routing we already have.
- **Raw per-car micro-scheduling as the primary UI.** Setting a response value and
  a departure count on every car across every 15-story block is tedium as content.
  The fun is the outcome (cars pre-positioned for the rush), not the setup ritual.
  This is the UI treatment for `elevator-scheduling` #305: Modern uses intent
  presets (Rush, Balanced, Feeder) plus an optional per-shaft auto-tune from
  measured load; the raw grid lives behind an Advanced toggle for Classic fidelity.
- **A strict opaque per-venue patronage counter clone.** The thread's author
  suspects the original has a hidden cap or bug here. Model the observable behavior
  transparently (that is exactly what `commercial-demand-pools` does), rather than
  cloning the opacity into an engine that is deliberately aggregated.

## Classic-parity vs Modern split

The rule of thumb from the systems lens: magnitudes match 1994 exactly in Classic;
curve shape, cap behavior, and assistance are where Modern is allowed to smooth,
extend, and help. The interlocking structure (demand splits, unmet demand leading
to leaving and a star stall, graduated distance) is identical in both modes,
because otherwise Classic is not actually reproducing the classic game.

| System | Classic (fidelity) | Modern (opt-in layer) |
| --- | --- | --- |
| Per-venue demand pools (#393) | Dedicated 1994 targets and the split denominator | Same shape, retuned magnitudes for larger towers |
| Lobby-distance penalty (#394) | Graduated on the canon mid-block bands, caps not kills | Smoother continuous curve, distance shown in the inspector |
| Leave-if-no-venue (#395) | Firmer population consequence | Soft drain into the existing grace-period vacate |
| Contiguous sky-lobby transfer (#396) | Enforced | May keep the current forgiving implicit routing |
| Weekend patronage (#398) | Exact 1994 numbers | Tunable multipliers |
| Elevator scheduling (#305) | Full per-shift grid, manual, original semantics | Intent presets plus per-shaft auto-tune |
| Star blockers (#399) and eval reason (#400) | Show the information (even 1994 had eval maps) | Add advice: cheapest missing gate, suggested fix |

Guiding principle from the UX lens: Classic withholds advice, never information.
Both modes tell the player the true state; only Modern tells them what to do about
it.

## Priority order

1. `commercial-demand-pools` (#393). Highest systemic leverage: it single-handedly
   restores diminishing returns, distribution pressure, and cross-venue patronage,
   and makes the abandonment limit emergent. It turns the game back from a money
   sim into a placement puzzle, which is SimTower's core identity.
2. `star-blockers-checklist` (#399) and `inspector-eval-reason` (#400). Cheap UI
   wins that make the existing deep systems legible and unblock stalled players.
   The data is already computed.
3. `graduated-lobby-distance-eval` (#394). Independently valuable and motivates the
   sky lobby, the central spatial decision. The distance primitive already exists.
4. `leave-tower-unmet-demand` (#395). Closes #393 into population and the star
   gates. Reuses the existing vacate machinery.
5. `elevator-scheduling` (#305) with Modern intent presets. The flagship traffic
   system and the thread's core skill. Epic, already owned, wants its own gdd/arch
   before any build, and pays off the dormant TDT per-car home-floor data.
6. Then, opportunistically: `contiguous-skylobby-transfer` (#396),
   `weekend-patronage-curve` (#398), `condo-demographic-routines` (#397),
   `housekeeping-coverage-overlay` (#401).

## Engineering notes (from the dev lens)

- Four of the six behavioral gaps (#394, #398, #396, and the abandonment behavior
  folded into #393 plus #395) ship in the current architecture with no move away
  from the statistical population model. Start there.
- Per-sim demographic routines (#397) must be faked statistically via spawn-mix and
  timing biases. A real per-sim agent model would require identity plus
  serialization, a multi-epic rewrite with save-format and performance
  consequences, and no SimTower player ever observed persistent individual
  identity across saves, so it is not a real parity gap. Quarantine real agents
  behind their own epic if ever wanted.
- `commercial-demand-pools` (#393) reuses existing fields (`patronageToday`,
  `customersIn`, `retailSpendPerCustomer`) and the reachability computation; the
  risk is the income-model swap, pinned by a golden reference-tower test that
  conserves total income at the calibration point.
- Balance guardrails: the "leave the tower" consequence must read from the census,
  never the roughly 140-person drawn crowd (that cap saturates on big towers). Any
  new distance drain folds into the single per-tick erosion step so W1, W2, and the
  new lobby-distance term do not triple-erode. New economy terms draw from the
  seeded RNG at the existing call site to keep headless and browser runs in sync.
- Classic vs Modern divergences ride the `GameRules` seam (a method plus two
  implementations, like `noiseErosionScale()`), never an inline mode check.
- Canon care: #393 touches economy math and #305 touches transport plus the TDT
  save round-trip, both `/gds-code-review` per CLAUDE.md. Nothing here changes the
  24-shaft / 64-link pools, the 8-cars cap, or spans, which stay in
  `facilities.ts` and `Tower.capReason`.

## Sources

- r/SimTower optimal tower design discussion (the thread that prompted this pass),
  including its two referenced links: an older r/SimTower thread and the
  relentlessoptimizer.com SimTower reference (2021).
- Cross-checked against the current engine and the existing planning artifacts:
  `PARITY.md`, `gdd-simtower-parity-2026-07-06`, `gdd-economy-depth-2026-07-01`,
  `gdd-condo-household-departures-2026-07-08`,
  `gdd-classic-modern-pricing-roadmap-2026-07-08`, `gdd-tower-wide-meal-cadence-2026-07-09`,
  `gdd-legibility-2026-07-01`, and the engineering backlog.
