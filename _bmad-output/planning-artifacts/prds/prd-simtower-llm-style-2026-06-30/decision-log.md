# Decision Log — Verticopolis PRD

Chronological record of decisions, scope calls, and version transitions for the
PRD at `prd.md`. Newest entries at the bottom.

---

## 2026-06-30 — Session 1 (Create intent, Express mode)

- **State:** Draft v0.1 created.
- **Intent:** Create. Brownfield — a working clone (`Verticopolis`) already
  exists; the PRD is being written *after* implementation to formalize the
  requirements against the canonical source.
- **Source of truth:** SimTower (1994, Maxis / OPeNBooK). Every requirement
  traces to an original-game mechanic. Grounding inputs: `PARITY.md`,
  `README.md`, `src/engine/econConfig.ts`, `src/engine/facilities.ts`.
- **Mode:** Express — the source of truth and existing implementation are
  unambiguous, so the full PRD was drafted in one pass rather than facilitated
  section-by-section. Inferences tagged `[ASSUMPTION]` inline and indexed.
- **Decision — clone-faithful, not a redesign.** The PRD specifies *parity with
  the 1994 original*, not a reimagining. New ideas are out of scope; the goal is
  a faithful, browser-native homage. Recorded as the central scope guardrail.
- **Decision — document the deliberate divergences as first-class requirements,
  not bugs.** Cathedral → Wedding Hall (religion-agnostic) and canon-non-removable
  structures kept removable (QoL) are the two intentional divergences that remain.
  Specified in §4 and §5.
  - **Update 2026-06-30 (FAQ-parity follow-up):** the earlier scaled-down TOWER
    target (12,000 → later 8,000) was **reverted to the canonical 15,000** (5★ =
    10,000) by widening the buildable lot to 340 tiles, which makes the original
    numbers genuinely reachable (measured ~15,066 occupants). Population scale is
    no longer a divergence. The individually-routed crowd now also honours the
    original's ≤2-ride trip rule.
- **Decision — platform scope is desktop-first browser with a modernized mobile
  layout.** Matches README/PARITY claims. No native app.
- **Decision — numbers come from the live engine config**, treated as the tuned
  realization of the original's balance (`ECON`, `FACILITIES`, `STAR_THRESHOLDS`,
  `GRID`, `TRANSPORT_CAPACITY`, `MAX_CARS`). Where the original's exact value is
  known to differ, both are stated.
- **Open items carried forward:** see §8 Open Questions in `prd.md`.

## 2026-06-30 — Finalize pass

- **Input reconciliation (subagent):** every concrete number in `prd.md`
  cross-checked against `econConfig.ts`, `facilities.ts`, `PARITY.md`,
  `README.md`. **All numbers correct.** No source mechanic omitted.
- **Discipline validation (subagent against `prd-validation-checklist.md`):**
  findings applied —
  1. Added **§4.10 Deliberate Divergences** (FR-66…69) and repointed broken
     "see §5" cross-refs (§0, FR-34, FR-46) to it / Addendum §A.
  2. Reworded implementation-leaking FRs to capabilities, moving algorithm/
     library/binding names (SCAN, BFS, WebAudio, localStorage, build command) to
     Addendum §B: FR-26, FR-30, FR-34, FR-40, FR-54, FR-58, FR-61, FR-63.
  3. Glossary: added **Two-layer grid** and **Aggregate congestion model**.
  4. Fixed FR-6 ground-lobby vs sky-lobby contradiction.
  5. Removed contradictory `[v2]` tag on the permanent "no original assets"
     non-goal (§5).
  6. Operationalized the "faithful feel" success metric into a veteran playtest
     rubric (§7); indexed its new `[ASSUMPTION]`.
- **Reconciler flags applied:** basement count corrected to **10 levels
  (B1…B10)** in §3, FR-1 (the "9 below" wording inherited from PARITY.md was
  off-by-one); FR-17 corrected so **Parking** is no longer claimed to charge
  monthly maintenance (no key in `serviceMaintenanceMonthly`).
- **Numbering verified:** FR-1…FR-69 contiguous and unique; UJ-1…UJ-7.
- **State:** Draft v0.1 → ready for review. Downstream next step per BMAD:
  `gds-check-implementation-readiness` (this is brownfield — the build already
  exists, so readiness is largely a parity/coverage confirmation).
- **Note (resolved):** test counts were stale — README said "33", PARITY.md
  said "82"; the suite actually runs **84 passing tests** (`npx vitest run`).
  Corrected README.md, PARITY.md, and the PRD/addendum to 84.

## 2026-06-30 — PR #33 review resolution (Codex)

Two P2 findings from the Codex automated review, both confirmed accurate against
the shipped code and fixed:

- **FR-6 (lobby gate):** the PRD claimed lobbies are required "for rating/win
  purposes," but `Simulation.evaluateStar()` / `checkVip()` gate only on
  population + Security/Medical/Wedding Hall/Metro — there is no lobby check.
  Rescoped FR-6 (and the Glossary "Lobby" entry) to a **structural/transit
  convention**, with an explicit note that it is not a rating/win gate.
- **FR-25 (express endpoints):** `Tower.setExpressStops()` always keeps a shaft's
  bottom and top as stops even when they are not lobbies (test
  `simulation.test.ts:286` covers floor 1→8). Updated FR-25 to state express
  skips intermediate non-lobby floors **except its shaft endpoints**. Open
  Question 3 marked resolved; the obsolete FR-25 `[ASSUMPTION]` removed from §9.

- **Decision — rename the product to Verticopolis (2026-07-01).** The working
  title "Tower Tycoon" was renamed to **Verticopolis** across the repo, package,
  README and manifest (PR #64). Living specs (this PRD, addendum, design docs) are
  updated to the new name; dated point-in-time review/party snapshots are preserved
  verbatim with a provenance note. Installer-managed `_bmad` config is not
  hand-edited — the durable override lives in `_bmad/custom/config.toml`.

## 2026-07-02 — Session 2 (Update intent, headless) — v0.1 → v0.2

Reconciled the PRD with the work merged on `main` since it was written
(PRs #75–#94). A `.memlog.md` was initialized for this workspace (bootstrapped
from this log) and carries the per-change audit trail from here on.

- **FR-3a (new) — structural support invariant** (PRs #86/#87): floors above the
  ground story require full support from the story below, in both directions
  (placement *and* bulldoze). Noted as narrowing — not reversing — the earlier
  "canon-non-removable structures kept removable (QoL)" divergence.
- **FR-14 / FR-14a — housekeeping is physical** (PRs #89/#93): rooms stay dirty
  (distinct art) until a housekeeper travels to them over the staff network;
  ~20 rooms/crew/day capacity with explicit at-capacity / can't-reach advisories.
- **FR-25a (new) — staff-only service elevators** (PRs #89/#93, per canon):
  tenants never ride them; service elevators + stairs + escalators form the
  staff network, service elevators preferred on route ties.
- **FR-26 / FR-27 — crowd-driven dispatch + car status cues** (PRs #90/#78):
  real waiting people are hall calls, riders' destinations are per-car cab
  calls; staff shafts answer only real staff calls. Cars show direction
  lanterns and a FULL indicator.
- **FR-22 / FR-22a — stairs & escalators UX** (PR #93): one-tap fixed two-floor
  flights (span cap enforced on every path incl. resize), single-flight
  rendering, stacking into aligned columns for continuous runs.
- **FR-24 — car economics** (PR #81): adding a car costs money and checks
  affordability; removing one pays a partial resale refund.
- **FR-25 — express serves sky lobbies regardless of build order** (PR #85).
- **FR-55 — occupancy-driven decorative pedestrians; shaft floor labels only at
  actual stops** (PRs #80/#76).
- **Addendum:** §A gained a staff-network parity row; §B documents crowd
  hall/cab calls and staff routing; §D gained mobile-GPU robustness notes
  (texture-band tiling, WebGL context-loss recovery, frame guard, physics
  disabled — PRs #75/#79/#82/#84/#88). Fixed a stale "200 tiles" in the §A
  table (lot is 340).
- **Counts:** test suite reference updated 84 → 282 (28 files).
- **State:** Draft v0.2; frontmatter `updated: 2026-07-02`.
