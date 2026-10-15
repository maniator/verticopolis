# Decision Log - Verticopolis Visual Parity

## 2026-08-09 - GDD created

**Why a new GDD rather than an amendment.** Six GDDs exist under
`planning-artifacts/gdds/`. Four mention art or render in passing
(venue-people-routing, crowd-din-ambience, housekeeping-overhaul,
modern-rental-living) but none owns render or art-direction canon. This change
spans world geometry, palette, room art and seams across every room kind, so it
gets its own document and claims that ownership in frontmatter.

**Scope call.** Recorded as render canon only. No mechanic, economy or simulation
change, so the traceability chain into gameplay pillars is deliberately untouched;
the pillars in this document are visual pillars scoped to art direction.

## Decisions

| # | Decision | Rationale |
| --- | --- | --- |
| 1 | Grid becomes `TILE = 10`, `FLOOR = 45` (4.5:1) | Matches the measured original exactly at 1.25x its resolution; a small move from 11/44 |
| 2 | Rejected `TILE = 8, FLOOR = 36` | Exact parity but discards art resolution already paid for |
| 3 | Rejected `TILE = 16, FLOOR = 72` | Exact 2x, but 45 x 72 = 3,240 px breaks the ~2,048 px texture cap and would force the band count down to 28 |
| 4 | `scale.ts` rationale is wrong and gets rewritten | It claims 4:1 makes the car "read square, as in the 1994 original"; the original's 4-tile car measures 32 x 36, taller than wide |
| 5 | Module seam is a consequence, not a feature | Ours cannot draw a readable seam because daylight interiors hold no tone below luminance 97 against the original's 18; the palette fix is the root fix |
| 6 | Seam lives in the base sprite, never the occupancy layer | Otherwise empty rooms lose their edges, a bug that only appears when the player is already in trouble |
| 7 | No dithering | A color-depth workaround for hardware we do not have; at our resolution it shimmers under camera pan |
| 8 | Target is the original's discipline, not its palette | Resolves the fork raised during review; our art is 1.25x resolution with its own identity |
| 9 | Detail must survive downsampling as tone | Texture that becomes noise at half zoom fails, because that is the zoom the game is played at |
| 10 | Epics are strictly sequential | Each step changes what the next is drawn against |
| 11 | Room designs go to the owner for approval before implementation | Owner's explicit direction, 2026-08-09; this GDD sets the rules the designs answer to, not the designs |

## Measurements of record

Taken 2026-08-09 from a retail SimTower render under the project's Wine harness
(`TOWER13.TDT`) against the same save imported into Verticopolis at matched scale
and fast-forwarded to WD2 12:04 so both samples are daylight.

- Original geometry: floor pitch 36 px (nine consecutive gaps), shaft 31-32 px = 4
  tiles x 8 px, ratio 4.5:1.
- Original interiors: 43 colors, luminance 103.5 avg / 18 p10 / 116 p50 / 180 p90,
  saturation 0.272.
- Verticopolis interiors: 99 colors, luminance 166.5 avg / 97 p10 / 167 p50 / 224
  p90, saturation 0.358.
- Original density: edge 0.233, dither 0.039, flat run 4.29 px.
- Verticopolis density: edge 0.138, dither 0.019, flat run 7.27 px.

**Note for designers.** The art direction drifted without anyone noticing because
nothing measured it. The invariants table in the GDD exists so this cannot recur
silently.

**Correction on the record.** During review, a room-type mismatch between the two
games (condos in the original where ours showed offices, at the same floors) was
raised as a possible import defect. It was not. The original's office art is
furnished with chairs, plants and framed pictures, which read as living-room
furniture at a glance. Both games agree on 616 offices and 447 condos. No import bug.

## 2026-08-09 - How the pixel sets get regenerated during the art epics

Learned the expensive way on PR #811. Any change to rendering invalidates TWO
committed pixel sets, and they refresh through different flows: `docs/screenshots`
through the `commit-on-approval` job (owner approves), and
`e2e/visual.spec.ts-snapshots` through `update-visual-baselines.yml` (the
`[update-baselines]` marker on the head commit). Both bots push with
`GITHUB_TOKEN`, which never triggers workflows, so each bot commit lands as PR
head with checks that never started. That is three round trips per art change,
two of them needing the owner.

**Decision: regeneration is a RELEASE step of an art branch, not a per-commit
step.** Concretely, for Epics 2 through 4:

- Art commits land with the visual checks RED. That is correct, not a failure:
  the art changed, so the baselines should not match.
- Do not regenerate mid-flight. Nobody draws one sprite and waits for a bot.
- Regenerate BOTH sets once, immediately before requesting review, with the
  `[update-baselines]` marker riding the last REAL commit. Never an empty commit
  to nudge CI; ask the owner to approve the run instead (see the standing note in
  the owner's memory).
- The branch is not reviewable while red. A reviewer cannot tell an intended
  pixel change from a regression, so review starts after regeneration.
- Treat the resulting pixel diff as EVIDENCE, not noise. When six sprite
  references are re-authored, that gallery diff is the only place a human sees
  what actually changed.

Corollary from the same PR: verify with `CI=true` before pushing. Vitest rejects
an orphaned snapshot only under CI, so a local run passed while CI failed the
whole unit suite on six obsolete snapshots.

## 2026-08-13 - Room occupant rows after the tile change (#813, PR #831)

Recorded here on 2026-10-15, when the PR was refreshed onto main; the ruling
itself was made on 2026-08-13 and lived only in the backlog row
`rooms-underdraw-occupants` until now.

**The defect.** Room furniture rows kept their authored pixel pitches when the
tile moved from 11 to 10, so rows counted off the screen width lost a slot and
the people at those slots went undrawn.

**Decision: capacity is counted from the room's width in tiles at the authored
11px tile, and a row steps at its authored pitch in screen pixels, compressing
only when its run cannot hold it.** No item is resized or recolored. The first
cut scaled the pitch with the tile instead; that spent the gap the art was
drawn with, and the nightclub's dancers (6px figures at a 6px pitch) came out a
pixel through each other.

**Approval-gate judgment (party ruling, owner delegated the call): the overlap
is a defect, not a taste call.** The same alternating pitch is treated as a
defect on #812's monitor wall, and the overlap is worst at full occupancy, when
the player is looking. So the club's dancer row now runs from a pixel left of
the lit strip to just clear of the DJ booth, while its count still comes off the
strip. That is the one placement change in this fix: a packed club spills off
the lit floor onto floor that was empty, which reads correctly. Every other
row keeps its place in its room.

## Open items

- Whether Epic 3's density work covers every room kind at once, or leads with the
  kinds that dominate a tall tower's screen area.
- Palette figures come from a single tower at one zoom on one machine; a second
  tower should confirm them before Epic 2 changes tone values.
