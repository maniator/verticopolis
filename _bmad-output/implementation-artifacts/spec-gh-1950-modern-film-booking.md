---
title: 'Modern theaters book films one at a time (#1950, part 1)'
type: 'feature'
created: '2026-11-11'
status: 'in-review'
baseline_commit: '19a5b74'
context: []
---

<frozen-after-approval reason="human-owned intent - do not modify unless human renegotiates">

## Intent

**Problem:** A Modern theater pays a $150,000 or $300,000 booking every month whatever its film does, so a sold-out feature clears about $42,000 a month and the only lever is a coin-flip policy (#1950).

**Approach:** Modern uses the per-film booking Classic got in #1953, with its own three tiers (Revival $60,000, Feature $120,000, Blockbuster $300,000), a longer film run (28 days at full draw, 14 fading, then spent), an income multiplier per tier and stage, and auto-rebook that books the chosen tier again the morning a film is spent. Design approved by the owner on 2026-11-11 (https://claude.ai/artifact/HmG64YhXSa7TZ1qN5RU8SZ).

## Boundaries & Constraints

**Always:** Classic behaves exactly as on main (prices, 6/3-day run, full-house blockbusters, 2.2 income, messages). The engine owns every price, label, run length and multiplier, and the catalog publishes what the UI shows. Old Modern saves load: a theater the save lists as a blockbuster keeps a blockbuster film, and a missing or "auto" policy rebooks a Feature. The rollover counts a spent film's last night before a rebooked film starts.

**Ask First:** anything that changes Classic behavior or the save version.

**Never:** ticket prices or a second screen (PRs 2 and 3); calendar scaling of film prices (a film is bought per day of showing, and day income does not scale with the calendar, so scaling would make the canon calendar ten times cheaper per day).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Book a tier | Modern, open theater, enough money | Price charged, film day 0, tier set, blockbuster slot only for a Blockbuster | N/A |
| Classic blockbuster tier | Classic, `changeFilm(id, blockbuster)` | Refused | `unavailable` |
| Not enough money | price above money | Refused, nothing charged | `funds` with the cost |
| Auto-rebook | Modern, policy tier set, film reaches day 42 | Rollover counts the old film, then the tier is charged and a fresh film starts | Unaffordable: no charge, a warning the first spent morning only |
| Auto-rebook off | policy `off` | Film keeps showing at a quarter of its peak income | N/A |
| New theater opens | Modern | Opens with a free Feature at day 0 | N/A |

</frozen-after-approval>

## Code Map

- `engine-rs/src/economy/films.rs` -- `FilmTier`, `change_film`, new `rebook_spent_films`, `fills_blockbuster_slot`, Modern income multiplier
- `engine-rs/src/rules.rs` -- `film_changes()` split into `film_offers()`, `film_run()`, `rebooks_spent_films()`, `blockbuster_tier()`
- `engine-rs/src/economy/visitors.rs` -- run-aware `film_draw`/`showing_draw`
- `engine-rs/src/economy/upkeep.rs` -- drop the monthly booking and `start_booked_films`; rollover uses the mode's run and slot rule
- `engine-rs/src/economy/traffic.rs` -- Modern income multiplier by tier and stage
- `engine-rs/src/sim_loop.rs` -- `rebook_spent_films` after the rollover; opening slot rule
- `engine-rs/src/tower/types.rs`, `load/reader.rs`, `load/coerce.rs`, `load/assemble.rs` -- `filmBlockbuster` save field and old-save migration
- `engine-rs/src/wasm_port*.rs`, `wasm/exports_port.rs`, `panels/unit_detail.rs`, `events.rs` -- tier codes, `filmTier` card slot, new policies
- `engine-rs/src/catalog*` -- `films` offers and `filmAutoRebook` replace the monthly booking fields
- `src/dualrun/engine.d.ts`, `src/simport/*`, `src/catalog/*`, `src/ui/templates/editor.ts`, `src/game/editorActions.ts`, `helpContent.ts` -- TS plumbing and the card

## Tasks & Acceptance

**Execution:**
- [x] engine rules, film code, upkeep, traffic, sim_loop, save fields -- as mapped -- the model
- [x] port, binding, catalog -- tier codes, card slot, offers -- what the UI reads
- [x] TS card and actions -- book buttons from the catalog, auto-rebook cycle in Modern -- the player's controls
- [x] Rust tests for every matrix row; TS unit tests with spies; integration test rewrite -- proof
- [x] change note (`app: minor`, `crate: minor`), READMEs, help text, `npm run engine:compat`

**Acceptance Criteria:**
- Given a Classic tower, when any day runs, then every Classic film test on main still passes unchanged.
- Given a Modern tower, when a maintenance period passes, then no film booking is charged.
- Given the catalog for each mode, then it lists that mode's film offers with prices, and Classic offers no blockbuster.

## Design Notes

Modern income multiplier = tier peak (Revival 0.6, Feature 1.0, Blockbuster 2.2) x stage (full 1.0, fading 0.6, spent 0.25). Classic keeps 2.2 for a theater in the blockbuster list. Policies stay strings: `auto` and `feature` rebook a Feature, plus `blockbuster`, new `revival` and `off`.

## Verification

**Commands:**
- `cargo test --manifest-path engine-rs/Cargo.toml` -- expected: pass
- `npm run typecheck && npm run lint && npm test && npm run build` -- expected: pass
