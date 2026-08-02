---
title: "Game Design: Ground Floor Is Lobby-Only (Floor Tool Auto-Converts)"
game: Verticopolis (browser SimTower clone)
author: Game Design (gds agent), with the owner ruling of 2026-07-29
date: 2026-07-29
status: Spec, approved for implementation
scope: Make floor 1 (the ground concourse) lobby-only, matching the 1994
  original. The Floor tool used on floor 1 lays a lobby instead of a bare floor
  tile (auto-convert), so the ground floor always ends up lobby-only with
  forgiving UX rather than a hard refusal. Parity fix; no new facility kinds, no
  save-format change, no change to sky-lobby handling.
grounds:
  - src/engine/tower/placement.ts (canPlace / place; the ground-floor exemption at 105-109 and the sky-lobby rule at 110-112)
  - src/engine/tower/transport.ts (removalReason; lobby permanence at 117-126)
  - src/engine/facilitiesData.ts (floor cost 500, lobby cost 5000, both width 1)
  - src/engine/Tower.test.ts (76, 93 assert the old "floor on floor 1 is allowed" behavior; must flip)
  - docs/canon/tdt-format.md (388-408; the running 1994 game never writes bare floor on a lobby story, Wine-harness confirmed 2026-07-19)
  - _bmad-output/specs/spec-starter-lobby-mode-split (founding is lobby-first)
---

# Game Design: Ground Floor Is Lobby-Only

## 0. The one-paragraph pitch

In the 1994 original, the ground floor is the lobby, and nothing else goes
there: "the lobby is the only thing that can be built on level 1." Our engine
quietly breaks that. A player can select the Floor tool and lay a plain
structural floor tile along the ground line, leaving a bare, non-lobby ground
floor that the retail game would never produce. This change makes floor 1
lobby-only. Rather than refuse the Floor tool there, we auto-convert: using the
Floor tool on floor 1 lays a lobby. The player still gets a ground floor from
the tool they reached for; it is just the correct one.

## 1. Why this is a parity fix

Two independent sources agree that floor 1 is lobby-only in the original:

- The retail game's own rule, as documented by the community: the lobby is the
  only thing buildable on level 1 (sky lobbies are the same, optionally, on
  15, 30, 45, 60, 75, 90).
- Our own canon, confirmed against the live 1994 binary through the Wine
  harness on 2026-07-19 (docs/canon/tdt-format.md): every lobby story the game
  writes carries a lobby record, never a bare floor record. The running game
  does not produce bare floor on a lobby story.

Our engine already enforces exactly this on the sky-lobby stories
(placement.ts:110-112 refuses a plain floor once a lobby is committed there),
but it deliberately exempts the ground floor (placement.ts:105-109), and the
tests pin that exemption (Tower.test.ts:76, :93). The ground floor is
unconditionally a lobby in the original, so it should be the strictest case,
not the exempt one.

## 2. The design pillar this serves

**Pixel-faithful to 1994.** Classic mode makes a fidelity promise, and a
buildable bare ground floor is a visible, structural break in it: the ground
concourse is the first thing a player sees and the anchor every lobby-distance
and reachability rule keys off. Getting floor 1 wrong is not cosmetic.

## 3. What the player experiences

### The core behavior

Selecting the Floor tool and placing on floor 1 lays a **lobby** on each
targeted tile, not a bare floor. The result is identical to having used the
Lobby tool there. This holds for a single tile and for a multi-tile drag along
the ground line.

Everywhere else, the Floor tool is unchanged: floors 2 and up still get plain
floor tiles, the basement still gets plain floor, and the sky-lobby stories keep
their current behavior (see Non-goals).

### Cost

A lobby costs $5,000 per tile; a plain floor costs $500 per tile. Auto-convert
charges the **lobby** price, because a lobby is what gets built. The player is
paying for a lobby and receiving a lobby.

### Affordability: partial-fill, exactly like the Lobby tool (reconciled 2026-07-30)

The party's first framing was "all-or-nothing." The `/gds-code-review` pass
showed that conflicts with canon and with our own Lobby tool: in SimTower and in
our engine, a structural drag **partial-fills**, building as many tiles as the
player can afford. Since the whole design premise is that the Floor tool on floor
1 "behaves exactly like the Lobby tool there," it inherits that partial-fill.
So a ground drag lays lobby tiles until the money runs out, no special-cased
all-or-nothing. A single tile the player cannot afford still builds nothing (the
degenerate case). The owner reconciled to partial-fill on 2026-07-30.

The safety, then, comes from the guard being **honest before the click** (below),
not from refusing the whole run.

### The surprise-spend guard: honest preview before the click (party + review)

A lobby is **permanent** and costs ten times a floor tile, and the Floor tool
paints an 8-tile brush and drag run (`brushTiles`/`dragRunTiles` in
src/ui/placement.ts). The `/gds-code-review` pass caught that a single-tile
affordability check would show an all-green ghost over a run the player can only
partly afford, then partial-build permanent lobby. The guard, as built:

- **The ghost renders a lobby** on floor 1 (the coerced kind), so the player sees
  it is placing a lobby before the click.
- **The ghost reflects WHOLE-brush affordability:** it turns invalid (red) when
  the player cannot afford the full strip of lobby tiles it would lay, computed
  across the brush, not one tile. No all-green over-promise. (This tightened the
  plain Floor/Lobby brush above ground too.)
- **The Floor tool's info card carries the price up front:** "On the ground floor
  (level 1) this lays a lobby, $5,000 per tile." So the player knows the rule and
  the price whenever the Floor tool is selected, before hovering the ground line.
- A live per-hover relabel of the palette swatch was considered and left out: the
  palette/tool-info are tool-scoped, not hover-scoped, and the lobby ghost plus
  the info-card note already carry the signal. Tracked as optional polish.

### Feedback is still mandatory (and accessible)

In addition to the preview, when the Floor tool auto-converts on floor 1 the
game confirms in plain language through the **existing aria-live toast region**
(not a visual-only cue), for example: "Floor 1 is a lobby. Laid a lobby here."
The confirmation fires whenever the conversion actually changed what the tool
would otherwise have done, so the player learns the rule the first time.

A modal confirmation was considered and **rejected for v1**: a dialog on every
floor-1 paint would punish the founding click (the beginner case in section 3),
which is exactly when players are here. If playtests still show surprise on
large drags, a threshold confirm on big permanent spends is the tracked
follow-up, not a v1 requirement.

### Founding still works, and cannot strand the player

Founding is already lobby-first: an empty tower's first placement must be the
ground lobby. Auto-convert composes cleanly with that. A brand-new player who
reaches for the Floor tool and clicks the empty ground line now opens their
tower with a lobby instead of being blocked, so the tool a beginner is most
likely to try first still does the right thing.

## 4. Edge cases and interactions

- **In-place floor-to-lobby upgrade (existing):** the Lobby tool may still be
  placed over plain floor tiles and upgrade them, unchanged. Auto-convert is the
  new path from the Floor tool; it does not remove the Lobby tool path.
- **Bulldoze:** unchanged. The auto-converted lobby is a lobby, so it is
  permanent like any lobby. This is why the preview and feedback (above) are
  required.
- **Convert-then-validate ordering (party, 2026-07-29):** founding requires the
  first placement to be a lobby. The floor→lobby coercion must happen BEFORE the
  founding/placement validation runs, or the beginner's Floor-tool click on the
  empty ground line is rejected as "not a lobby" and we reintroduce the exact
  stranding this fix removes. Convert first, validate second.
- **Floor tool on a tile that is already a lobby (floor 1):** no-op. No second
  charge, no error; the tile is already what the tool would make it.
- **Drag straddling an existing lobby run (floor 1):** only the empty tiles
  convert and are charged; existing lobby tiles are skipped (no double charge).
- **Affordability across a drag:** partial-fill, like the Lobby tool (see the
  reconciled affordability section). The drag lays lobby tiles until the money
  runs out. The pre-click ghost turns red when the full strip is unaffordable, so
  the partial-fill is warned, not sprung.
- **Multi-tile drag across mixed rows:** only the floor-1 tiles convert to
  lobby; a drag that also covers other floors follows each floor's own rule.
  (In practice the Floor tool operates one floor at a time, so this is a
  clarification, not a new mechanic.)

## 5. Out of scope (Non-goals)

- **Sky-lobby stories (15, 30, 45, 60, 75, 90) are untouched.** They are
  *conditionally* lobby-only: a player may build rooms there until a lobby is
  committed, after which plain floor is already refused (placement.ts:110-112).
  Floor 1 is *unconditionally* lobby-only; only floor 1 auto-converts. Do not
  extend auto-convert to sky lobbies. **This asymmetry is intentional (party,
  2026-07-29):** floor 1 auto-converts while a claimed sky lobby hard-refuses,
  because floor 1 is unconditionally a lobby (nothing else may ever go there) but
  a sky-lobby story may legitimately hold rooms or bare floor until the player
  commits a lobby, so silently converting there would destroy a valid choice.
  Document this at the code seam so it is not "fixed" into false consistency.
- **No save-format change.** Serialization and TDT import/export are untouched.
- **No migration of existing saves.** A pre-existing bare floor tile on floor 1
  in an old save is left as-is; the rule governs new placement only. (The
  running game never produced such tiles, and TDT export already normalizes a
  lobby story to a lobby, so this is a legacy-load-only situation with no
  economic or reachability effect worth a migration.)
- **No change to lobby cost, the 375-tile lot, or sky-lobby cadence.**

## 6. Success signal

A player who selects the Floor tool and clicks the ground line gets a lobby, at
the lobby price, with a confirmation that names the price. The pre-click ghost
shows a lobby and turns red when the strip is unaffordable, and the Floor tool's
info card states the ground-floor lobby price up front. Through the player build
path (`sim.build`/`sim.canBuild`) the Floor tool no longer lays a plain floor on
floor 1: the ground floor is lobby-only in every new tower, exactly as in 1994.
(The low-level `Tower` primitive stays permissive by design, so save-load and
internal callers are untouched.)

## 7. Assumptions and dependencies

- [ASSUMPTION] The Floor tool operates on one floor at a time, so "a drag on
  floor 1" is always a run of ground-line tiles. If the tool can paint a
  rectangle spanning several floors, the per-tile rule still holds (each floor-1
  tile converts) but the affordability message should scope to the floor-1
  portion.
- Depends on the existing lobby placement path (place() in placement.ts) and
  the money/charge path used by normal placement, so auto-convert reuses the
  real lobby cost and permanence rather than re-implementing them.

## 8. Development and test notes

- **One seam (party hill, 2026-07-29):** the floor→lobby coercion for floor 1
  must live in a single place so `canPlace`, `place`, the preview ghost, the cost
  readout, and the founding gate all agree. If the coercion is duplicated it will
  drift. Mirror how `capReason` and the sky-lobby rule are already centralized in
  placement.ts. The coercion runs BEFORE placement/founding validation (see the
  convert-then-validate edge case).
- The preview/cost path (src/ui/placement.ts, `dragRunTiles` and the shared
  ghost/cost readout) must read the same coerced kind, so the ground line shows a
  lobby ghost and lobby price while dragging.
- Flip the stale assertions: Tower.test.ts:76 and :93 must change from "plain
  floor allowed on floor 1" to "the Floor tool on floor 1 yields a lobby."
- Add coverage: single-tile convert; multi-tile drag convert; affordability
  refusal (nothing built or charged, reason names the total); the aria-live
  confirmation fires; the founding case (Floor tool on an empty ground line opens
  the tower with a lobby); floor-tool on an already-lobby floor-1 tile is a no-op
  (no double charge); a drag straddling an existing lobby run charges only the
  empty tiles; and a legacy save with a bare floor-1 tile still loads. Confirm
  sky-lobby behavior is unchanged (regression guard).
- Player-facing, so it takes a **minor** version bump. Reviewed under
  /gds-code-review (gameplay). House prose rules apply to all new copy.

## 9. Amendment (2026-07-30): sky lobbies, after driving the 1994 game

The owner asked whether "a lobby can be built on top of floor" on the SKY-lobby
stories (15/30/45/60/75/90), and to verify against the real 1994 game. Findings
from the Wine harness this session: the retail palette groups Floor and Lobby
under one structural button (press-and-hold reveals "Flr"/"Lb"), and the Floor
tool "creates blank floor spaces" while sky lobbies are "optionally" on the 15th
stories (community docs). The direct build-rule test (Floor drag on story 15)
could not be automated (the headless harness routes tool selection but not build
clicks), so that one observation stays open.

A four-agent party (independent, repo-reading: Game Designer, Game Architect,
QA/Adversary, Canon/Parity) ruled on two separable proposals:

- **REJECTED: extend the Floor-tool auto-convert to sky-lobby stories.** Floor 1
  is UNCONDITIONALLY a lobby (rooms are impossible there); a sky story is only
  CONDITIONALLY lobby-only and is commonly a plain office floor. Coercing the
  Floor tool there would remove a legitimate build (bare floor / office prep) and
  force a permanent, 10x-price, room-blocking, express-rerouting sky lobby behind
  the player's back. **The Non-goal in section 5 ("do not extend auto-convert to
  sky lobbies; the asymmetry is intentional") STANDS** and is now party-ratified
  a second time. `groundFloorStructureKind` remains floor-1-only.
- **RATIFIED: the Lobby tool upgrades bare floor in place on a sky story.** This
  is the owner's actual ask ("a lobby on top of floor"), and it matches the
  ground concourse and the 1994 overlay. The change is one predicate:
  `placement.ts` refuses a sky lobby only when the floor carries a ROOM
  (`floorHasRoom`, whole-floor) rather than any non-lobby content; bare floor is
  upgraded in place by the existing 116-126 path. No coercion, so build/preview/
  cost/import are untouched; a new O(1) `roomTiles` counter mirrors
  `nonLobbyTiles`. Save-load unaffected (no migration; a legacy mixed
  lobby+floor sky story even becomes finishable). Engine-local and fully
  headless-testable, so no live-game gate is required for this narrow change.

Version 2.9.0. The open live build-rule observation (does the retail Floor tool
convert or refuse on an unclaimed story 15?) is not needed for the ratified fix
and is left as a note, not a blocker.
