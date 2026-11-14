# Party findings: bulldozing lobby tiles in Modern (2026-11-14)

Naftali built a 3-story lobby hall by mistake on top of an office floor (a
separate 7-column hall on floor 75 of his `split-tower 16` save) and could not
bulldoze it: the engine refuses every lobby tile in both modes with "Lobby
tiles are permanent. The 1994 game does not let you remove them."
(`Tower::removal_reason`, `engine-rs/src/tower/placement.rs`). Undo works only
right after the build. He leans toward letting Modern bulldoze lobbies and
asked for a party round first. Classic keeps the 1994 rule.

The Engine Room ran in session mode. Short transcript, then what the room
recommends and what goes to the owner.

## Facts on the table

- A lobby tile is a width-1 structural unit. A tall hall tile carries
  `lobby_stories` and claims the stories it rises through in the structure
  index (`engine-rs/src/tower/tall_lobby.rs`), so nothing else stands there.
- Removal already settles what a lobby leaves behind: when a floor loses its
  last lobby tile, express shafts stop stopping there
  (`Tower::settle_removals`, `engine-rs/src/tower_removal.rs`).
- The removal check asks for a free story at `floor + 1`. For a tall hall that
  story is the hall itself.
- A lobby tile is built at its catalog price times its stories
  (`engine-rs/src/build.rs`); `Kind::resale_refund` is half the one-story
  price.
- Undo's "you could sell this instead" advice hard-codes "a lobby tile never
  sells" (`Sim::sells`, `engine-rs/src/sim_undo_check.rs`).
- Today the bulldozer takes a floor tile out from under a shaft's stop and
  leaves the shaft standing on nothing (checked in a scratch test on `main`:
  five end tiles under a standard elevator's top stop all sold).

## Transcript

🏢 **Kenji:** Classic doesn't move. In 1994 the bulldozer cursor goes red over
a lobby and that's the end of it. You built your sky lobby, you live with it.

🎲 **Samus** *(walk-on from the Web Game Room)*: Modern already sells the
cathedral and opens gaps in the middle of a floor. And a 3-story hall is three
times the money. If I fat-finger one onto my office roof, Modern's answer can't
be "start over."

😤 **Grumbal:** Fine. Then tell me which lobby. Because if it's the ground
lobby, every tenant, worker and shopper comes in through that hall. NO
WARPING, remember? Take the last ground tile and the tower has no front door.
Somebody gets paged at 3am because nobody can get in.

🚢 **Dana** *(walk-on)*: The bug report is a sky hall. Ship sky halls. The
ground lobby keeps today's rule, which nobody has complained about.

🌶️ **Boundary:** Sky lobby, then. Tile with a shaft stopping on it? The
express lands on 75; I bulldoze the tile under its doors. Tile a shaft just
passes through? A tall hall's upper stories, with an elevator running up the
middle?

🦀 **Ruth:** I checked. Floors already have this hole: sell the end tiles under
an elevator's top stop and the shaft just hangs there. Same predicate fixes
both. If any shaft's columns cover the tile on any story the tile fills,
refuse: "Remove the shaft first."

😤 **Grumbal:** Both. Not "lobbies now, floors in a follow-up issue nobody
reads." A floating elevator is a bug in Classic too.

🏢 **Kenji:** I can't swear what the original's bulldozer does with a floor
under a shaft, but I never once saw an elevator hanging in the air. Refusing
is the safe reading.

🏛️ **Cloud Dragonborn:** And notice what that rule buys you. The skip lists a
tall hall writes onto the shafts it rises through (`skip_over_new_hall`): I was
about to ask who undoes those when the hall goes. Nobody has to. A tile with a
shaft through it can't be removed, so no shaft ever has a stale skip from a
removed hall.

🌶️ **Boundary:** The story check. `floor + 1` is the hall's own story for a
3-story hall. It has to look at `floor + stories`, the slab above the hall.

🗂️ **Vera:** The money. It cost three tiles' worth; it sells for half of
that, not half of one tile. And I want the undo round trip: bulldoze a tall
tile, undo, the tile comes back with its height and `lobbyHeights` says so in
the save. No save version change; old saves load as they did.

⏱️ **Tess:** The shaft check is a pass over the transports, 24 elevators and
64 links at most, once per tile the player bulldozes. That's an edit, never a
step or a frame. Fine. The drag bulldoze asks per tile it sweeps; still tens of
calls per gesture.

🦀 **Ruth:** One named rule, `GameMode::removes_lobby_tiles`, read by the
removal check and by undo's "sells" advice, so the two can't drift. No
`mode == Modern` in either place.

📈 **Anika:** Lobby distance. Pull a sky lobby and the rooms above are farther
than the original allows. Do they get evicted?

🏢 **Kenji:** No, and they shouldn't. The distance rule gates new builds. Your
tower just got worse, the evaluation sees it, and that's the punishment.

## What the room recommends

1. **Modern only.** A named mode rule, `GameMode::removes_lobby_tiles`, true in
   Modern. Classic keeps today's refusal and wording.
2. **The ground lobby stays** in both modes, with its own reason: it is the
   tower's front door.
3. **The story above the whole hall** has to be clear: the check reads the
   slab at `floor + stories`, so a tall hall tile with a floor on top of it is
   refused with the existing "Remove the story above first."
4. **No shaft through it.** A floor or lobby tile that a shaft's columns cover,
   on any story the tile fills, is refused in both modes. This also fixes
   floating shafts over sold floor tiles, and it means a removed hall never
   leaves a stale skip on a shaft.
5. **Refund** is half of what the tile cost: the half-price refund times its
   stories.
6. **Undo** reads the same rule for its "you could sell it instead" advice.
7. **Tests:** Modern sells a sky tile, Classic and the ground lobby refuse,
   tall hall refund, story above a tall hall, shaft through a tile (floor and
   lobby), last sky tile resyncs express stops, undo restores a tall tile with
   its height through a save round trip.
8. **Docs:** the help "Bulldoze and undo" and "Floors and lobbies" pages, the
   tall-lobby module doc.

## For the owner

- **The ground lobby in Modern.** The room kept it permanent so the tower
  always has a front door. Shrinking a too-wide ground lobby would need a
  "never the last tile, never a gap" rule; nobody has asked yet.
