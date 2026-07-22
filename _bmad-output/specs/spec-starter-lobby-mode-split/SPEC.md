---
id: SPEC-starter-lobby-mode-split
companions: ["test-impact.md"]
sources: []
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete, preservation-validated contract for what to build, test, and validate. Source documents listed in frontmatter are for traceability only.

# Starter-lobby mode split: Classic canon-zero, Modern keeps the seed

## Why

A fidelity debt to settle and a design question to close. The 1994 original starts a new tower with ZERO built tiles: the player places their own first lobby anywhere on the ground line. Our `Simulation.newGame` has always seeded a 40-tile lobby centered on the 375-tile lot, silent training wheels that quietly contradict the "pixel-faithful to 1994" pitch Classic makes. The owner surfaced this while asking whether new towers should start at the LEFT lot edge beside the new arrival plaza; the party (2026-07-21, owner signed off) unanimously rejected the left-edge start and ratified a mode split instead: Classic founds the way 1994 did, Modern keeps the seed as a documented nicety. The ruling of record lives in the party memlog (`_bmad-output/party-mode/memories/installed/.memlog.md`).

## Capabilities

- **CAP-1**
  - **intent:** A new Classic tower founds canon-zero: no seeded lobby, and the player places the first lobby anywhere on the ground line exactly as in the 1994 game.
  - **success:** A fresh Classic `newGame` has zero units; building the first lobby at any ground-line tile succeeds under the same rules as today.
- **CAP-2**
  - **intent:** A new Modern tower keeps the centered 40-tile seeded lobby, documented as a Modern quality-of-life nicety (same family as build-refusal hints).
  - **success:** Modern founding output is unchanged from today, byte-for-byte in the serialized state.
- **CAP-3**
  - **intent:** All divergence flows through one seam: `rules.starterLobby` on the mode rule-set (GameRules, resolved once at founding), returning the seed placement or null.
  - **success:** No call site outside the rule-set tests the mode string for founding behavior; the seam is unit-covered for both modes.
- **CAP-4**
  - **intent:** Classic's zero start ships with an onboarding beat in the same PR: a lobby-placement card points a fresh Classic tower at the Lobby tool before any other card.
  - **success:** A first-time Classic player on an empty lot sees the lobby card first; after the lobby exists the flow proceeds as today. Verified fact: no such card exists now, and Onboarding.ts's first step assumes the pre-seeded lobby, so the step list needs the new opener and an empty-lot audit of the existing copy.
- **CAP-5**
  - **intent:** The first-boot camera opens on the lot center in both modes.
  - **success:** A fresh Classic tower opens centered on the empty lot, never on a corner; Modern's opening view is unchanged.
- **CAP-6**
  - **intent:** Help's Classic vs Modern comparison names the split as a feature: Classic starts you the way 1994 did, an empty lot and your first decision; Modern starts with a ready lobby.
  - **success:** The comparison renders the new line and the help drift-guard test carries the matching phrase.

## Constraints

- PREP PR FIRST, its own internal-only PR (no version bump): decouple the golden-master fixtures and every integration test that assumes the centered seed, per `test-impact.md`, so the later Classic re-pin is never tangled with a fixture refactor (two re-pins in one diff hide bugs).
- Golden masters move exactly as predicted in the behavior PR: the Classic hash re-pins with an intent comment; the Modern hash must NOT move, and its unchanged value is the proof the seam gates cleanly (demographic-routines precedent).
- Save compatibility holds: only `newGame` changes. Existing saves keep their towers; serialization and TDT import are untouched.
- The behavior PR takes a minor version bump (player-facing); both PRs review under `/gds-code-review` (founding behavior is gameplay).
- All new copy follows the house prose rules: American English, no em-dashes, no marketing vocabulary.

## Non-goals

- Left-edge start for new towers: rejected unanimously (it flattens tower-shape variety, fights the bidirectional camera and build promise, and couples cosmetic scenery to sim geometry).
- Any change to lobby placement rules, costs, or the 375-tile lot canon.
- Any scenery-to-gameplay coupling: the arrival plaza stays pure render.
- Mode-splitting anything beyond the starter seed.

## Success signal

A new Classic tower boots to an empty lot with the lobby onboarding card showing and founds its first lobby wherever the player chooses; a new Modern tower boots exactly as today; all mode divergence flows through `rules.starterLobby`; and the two golden masters move exactly as predicted (Classic re-pinned with intent, Modern byte-identical).

## Assumptions

- The Classic zero start needs no save-format change: a zero-unit serialized tower already round-trips (empty `units` array is a legal state).

## Open questions

- None. The party ruling plus the Onboarding.ts audit closed the input's one conditional ("if it isn't there already": it is not).
