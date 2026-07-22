# Test impact: what the prep PR decouples and what the behavior PR moves

The centered 40-tile starter lobby is an implicit fixture in the test suite.
The prep PR removes that dependence BEFORE the behavior PR changes founding, so
the Classic golden-master re-pin lands alone and reviewable.

## Prep PR (internal-only, no version bump)

- `src/tests/integration/goldenMaster.integration.test.ts`: `BUILD_SCRIPT`
  builds at tiles 168-205 "inside the starter lobby (~167..206)" and its
  comment says newGame seeds a 40-tile ground lobby. The fixture switches to
  an ENSURE helper (assert the 40-tile centered lobby present, or build it),
  following the `src/tests/fixtures/towerFixtures.ts` rule that every fixture
  asserts its own construction. While the seed still exists, ensure is a pure
  assertion, so the prep PR moves NEITHER pinned hash: the unchanged hashes
  are the proof the refactor is behavior-free. In the behavior PR, Classic's
  ensure actually builds the lobby, so only the Classic hash re-pins, exactly
  the isolation the two-PR split exists to buy.
- Integration tests that assume the seed exists (grep for towers built on a
  fresh `newGame` without laying a lobby, e.g. suites that build at
  ~tiles 167-206 on floor 1 or step onto the seeded lobby): each lays its own
  lobby through the shared fixture helpers.
- `src/render` scenery tests read the seed only through `apronRange(units)`;
  they keep working either way but the prep PR re-checks the assertions that
  say "the starter lobby's apron hides at least one plant."
- e2e and screenshot fixtures found towers through boot flows that will keep
  the seed until the behavior PR; the prep PR leaves them alone.

## Behavior PR (minor bump, /gds-code-review)

- `rules.starterLobby` lands in the GameRules strategy; `newGame` consumes it.
- Classic golden master re-pins with intent (zero-seed founding changes the
  fixture's serialized world); the Modern hash must be byte-identical, and the
  PR text calls out that unchanged value as the seam proof.
- Onboarding gains the Classic lobby-placement card as the first step; the
  existing steps' copy is audited against an empty lot (today's step 1 text
  assumes "your lobby" exists).
- The e2e visual fixtures and gallery scenes that boot fresh Classic towers
  re-mint through the standard `[update-baselines]` and drift-approval flows.
- Help comparison line + drift-guard phrase land together (CAP-6).
