# Party findings: twirly stairs and switchback escalators by venues (2026-11-14)

Naftali asked (2026-11-14): "Can we also add twirly stairs and back and forth
escalators when placing by metro station or cinemas and maybe other places."
Tall lobbies (#308) already draw a flight that climbs the hall as a spiral
staircase or a switchback escalator (`src/render/sprites/spiralStair.ts`,
`drawEscalatorSwitchback` in `src/render/sprites/transport.ts`). The question
for the room: which flights get that look elsewhere, in which mode, and does
anything below the renderer change.

The Engine Room ran in session mode with two guests from the Web Game Room
(Samus, game design, and Sally, UX). Short transcript, then what the room
recommends and what goes to the owner.

## Facts on the table

- A flight out of a tall lobby is tall because the lobby is an open hall: the
  engine stretches it (`Tower::walkway_top`) to climb the whole hall, and the
  renderer picks the spiral or switchback from `top - bottom > 1`.
- A cinema, party hall or aquatic center is two stories, the metro three, the
  recycling center two and the wedding hall five (`facilities/table*.rs`).
  None is an open hall a flight stands inside. A flight beside one stands on
  ordinary floors and links two of them, like any other.
- Shafts are static actors keyed by a signature in `towerReconcile.ts`, which
  already walks every room once per sync. Climbers are placed along a flight
  by `climbPath.ts`, once per climber per frame.

## Transcript

🏢 **Kenji:** I'll say it before anyone gets excited. In 1994 every one-story
flight is the same flight. Next to the theater, next to the metro, in the
middle of the condos: straight stairs, straight escalator. The only tall
flights the original has are the two- and three-story stair types out of a tall
lobby, and those are in the `.TDT`. The wiki says nothing about the theater
getting a grand staircase. Classic stays straight.

🎲 **Samus:** And in Modern? Think about what the player feels. The cinema and
the metro are the two places a crowd *arrives*. You built a theater, you ran an
escalator up to it, and it looks exactly like the escalator to the dentist on
floor 9. A spiral stair beside the cinema says "this is an event." It's a
reward for putting the venue somewhere people can walk to.

😤 **Grumbal:** Fine, a reward. Which kind? Because "twirly stairs by the
cinema" has two readings and one of them pages somebody. Reading one: the
flight beside a two-story venue climbs both stories, like the lobby flight.
That's a two-story flight the engine has to allow outside a lobby, a flight
that counts once against the walk limit where today it counts twice, one link
from the 64-pool instead of two, and a `.TDT` export writing stair type 2 next
to a theater, which the original only writes out of a lobby. Save change,
conformance change, Classic argument. For a look.

🏛️ **Cloud Dragonborn:** Reading two is the one I'd ship. The flight stays a
one-story flight in every way the simulation sees: same span, same pool, same
walk count, same save, same export. Only how it is drawn changes, and the look
is a pure function of things the engine already publishes: the flight, the
rooms beside it, and the catalog's story count for each kind. No new engine
query, no new frame field, no binding change.

🦀 **Ruth:** Agreed, nothing for the crate. "All game logic in Rust" is about
who walks where and what it costs. Whether the stair winds is art direction,
like a facility's color.

😤 **Grumbal:** Then here's who gets paged on reading two. Somebody builds a
cinema next to a stair that's been there for a year. The stair has to restyle.
They bulldoze the cinema. It has to go back. Undo it. Redo it. If the
signature doesn't carry the style, you get a spiral beside an empty floor
until the next reload.

⏱️ **Tess:** So the style goes in the shaft signature, and it's computed from
the same sync that walks the rooms. Collect the venues in that loop, a few
dozen at most, then check each flight against that short list. That's per sync,
never per frame. The climber side reads the style once when a climb starts and
keeps it on the climber, so the frame path allocates nothing. This touches the
render tick and the shaft cache, so it's a hot-path diff: the record goes on
the PR.

🌶️ **Boundary:** Then define "by". The flight's columns touch the venue's
left or right wall? A one-tile gap? A flight from F+1 to F+2 beside a cinema on
F and F+1, half beside it? A stack of flights beside the three-story metro?

🎨 **Sally:** "By" means touching. The player reads "next to the cinema" as
sharing its wall, and a one-tile gap is a hallway, not a staircase in the
venue's foyer. Both of the flight's floors have to be inside the venue's
stories, so it's alongside the whole climb. Beside the metro, both flights of
a stack qualify, and each one is its own little spiral landing on its own deck.

🗂️ **Vera:** And because nothing is stored, an old save shows the new look
the moment it loads, a `.TDT` import looks right, and export is untouched. No
version bump, no migration. I'm happy, which is unusual.

🎲 **Samus:** Which venues, then? Cinema, party hall, metro: yes. The aquatic
center is a Modern venue and it's two stories: yes. The recycling center is
two stories too, but nobody gets a grand staircase to the garbage room.

🏢 **Kenji:** The wedding hall crowns the top floor and rises above the last
slab. A flight can't stand beside it on both floors, so it never comes up.

🎨 **Sally:** One worry on the escalator. Out of a lobby, the switchback has a
whole story per run. Inside one story, "back and forth" means two runs of half
a story each, with a steel landing at the turn. At 45 pixels a story that's
tight. I want to see it at game scale before we promise it.

🕹️ **Link Freeman:** It draws: two runs mirrored, a landing at mid-height on
the right, and the climber path turns at the landing like the lobby
switchback. The one-story spiral is the lobby spiral with one turn and a half.
Preview first, then the screenshot scene.

😤 **Grumbal:** And Classic? Samus wants it everywhere. Kenji wants it nowhere
in Classic. I don't care which, as long as the mode check is one named rule
and not a `mode === "modern"` sprinkled in the renderer.

🎲 **Samus:** It's presentation. Classic players see the lobby spiral already.

🏢 **Kenji:** Because the original *has* tall lobby flights. It doesn't have
this. That's the line: Classic shows what 1994 shows.

*(They don't settle it. It goes to Naftali.)*

## What the room recommends

1. **Rendering only.** A one-story stair or escalator beside a venue keeps its
   span, pool slot, walk-limit count, save and `.TDT` export. No engine, save,
   binding or conformance change. Reading one (flights that climb the venue's
   full height) is rejected for this change.
2. **"Beside" is touching.** The flight's columns butt against a venue's left or
   right wall, and both of the flight's floors lie inside the venue's stories.
3. **Venues:** cinema, party hall, metro station and aquatic center. Not the
   recycling center (back of house). The wedding hall never qualifies.
4. **The look:** stairs become a one-story spiral (one and a half turns around
   the pole, landing on the right like the lobby spiral). An escalator becomes
   a one-story switchback: two half-story runs with a steel landing at the
   turn. Climbers follow both paths.
5. **Invalidation:** the style joins the shaft signature in `towerReconcile.ts`,
   so building, bulldozing, undoing or redoing a venue restyles its flights in
   the same sync. Climbers read the style when a climb starts.
6. **Cost:** the venue list is gathered in the room loop the sync already runs;
   flights check that short list per sync, never per frame. Hot-path record on
   the PR.
7. **Docs:** Help "Stairs and escalators" gets a "Beside a venue" section with a
   pinned-container screenshot; the Classic vs Modern page lists it.

## For the owner

- **Classic or not.** Kenji: Classic shows what 1994 shows, so straight flights
  there. Samus: it's presentation, show it in both. Room's lean: Modern only.
- **Reading one** (taller flights beside venues) is a bigger, separate change
  with a save and export story; the room recommends not doing it.
