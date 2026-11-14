# Party findings: click a person to see their trip (2026-11-14)

Naftali asked when he can click a walking person and see where they came from
and where they are going. Issue #2092 tracks it ("Show real residents you can
click"); nothing was built. The Engine Room ran in session mode, short.

## Facts on the table

- The engine keeps every routed person in `Crowd::people`
  (`engine-rs/src/crowd/mod.rs`), kept in id order: people are only pushed
  with a rising `next_id` and dropped with `retain`.
- The view frame carries eight numbers per person (id, seed, state, x, fy,
  floor, staff, wait) and, since #2149, only the people in the camera's
  window. Nothing about a trip's ends or purpose leaves the engine.
- What a person knows about their trip depends on who spawned them:
  - meal trips and venue visits know the room they left (`origin_unit_id`)
    and the venue (`meal_venue_id`);
  - school runs and sales calls know the home or office they left;
  - housekeepers know their crew room (`crew_id`), the room they clean
    (`clean_unit_id`) and their shift step (`StaffTrip`);
  - the plain commutes (`Opt::Trip`, metro arrivals and departures) know only
    a floor picked from a list (leased offices, staffed offices, homes, open
    venues) and a random tile on it.
- The crowd is not saved, and the conformance crowd channel
  (`Crowd::view`) prints `Person::to_json`, so a field added there moves the
  conformance lock. An engine-internal field (like `from_metro`) does not.
- The card surface exists: `unitCard` and `shaftCard` are numeric records the
  layout names (`wasm_port_panels.rs`); the web reads them on demand.

## Transcript

🏢 **Kenji:** Before anyone says "Classic gets it because SimTower had it":
I can't swear the 1994 magnifier read people. Don't claim canon. Ask the
other question: does a read-only card change a single rule? No. Then Classic
can have it without lying about 1994.

🎲 **Samus:** Good, because the whole point is "why is this guy standing at
elevator 3 for two hours." That's a Classic player's question too.

🦀 **Ruth:** Engine side is small if we don't get greedy. One query,
`personCard(id)`, read on demand when the card is open, like `unitCard`. No
frame growth: the frame stays eight numbers a person. Binary search by id,
since the list is in id order.

😤 **Grumbal:** And the "why"? You can't reverse-engineer purpose from a
route. Morning, lobby to floor 12: is that a worker or a visitor? Stamp it
when the person is made. Every spawn site already knows why it spawned them.

🌶️ **Boundary:** Stamping costs nothing at run time and draws no random
numbers, so the sim stays identical. But keep it out of `to_json`, or the
conformance lock moves for a label.

🦀 **Ruth:** Agreed: engine-internal, like `from_metro`. Purpose plus the two
ends, each a place: a room, a floor, a lobby, a metro station.

🌶️ **Boundary:** Plain commuters. "Going to work at an office on floor 12."
Fine. But the tile they walk to might be a shop. If you name the room under
their destination tile you'll tell a player an office worker works at the
burger place.

🎲 **Samus:** Then only name the room when its kind fits the purpose.
Otherwise just the floor. Honest beats specific.

🚢 **Dana:** And when the real-tenant work gives every worker a desk, those
trips stamp a real room and the card gets specific with no UI change.

🏢 **Kenji:** The UI. Hover over a two-pixel man who walks away? No. Click or
tap, with the Inspect tool, and the card stays with him.

🌶️ **Boundary:** What does a click on a person standing in front of a room
pick? The person, if the pointer is on the figure. A rider inside a car is
hidden in the cab: the tap goes to the elevator. Fine for v1.

😤 **Grumbal:** And when he leaves the building? NO WARPING means he walks
out through the lobby. The card says he left and closes. It doesn't freeze on
a ghost.

🌶️ **Boundary:** He scrolls out of the people window and the frame drops
him. The card must not care: it asks the engine by id, not the frame.

🎲 **Samus:** Naming people later, in Modern. Keep the title a slot. Today
it's the role ("Office worker", "Housekeeper"); later it can be a name.

🚢 **Dana:** Ship it in one PR: engine query, the card, the help page. Minor
bump for the game and the crate.

## What the room recommends

1. **Both modes.** The card is read-only and changes no rule. No claim that
   the 1994 game had it.
2. **On demand.** `personCard(id)` on the engine port, read while the card is
   open. The view frame does not grow. Lookup by binary search on id.
3. **Purpose and ends are stamped at spawn,** engine-internal: no random
   draws, not in `to_json`, not saved (the crowd is not saved), so saves,
   conformance and the sim stay identical.
4. **Honest ends.** A room is named only when the spawn knew it, or when the
   room at a plain commuter's destination tile fits the trip's purpose;
   otherwise the card names the floor.
5. **Click or tap with Inspect.** A person's figure wins over the room behind
   it. Riders inside a car are not pickable (tap the car). No hover card for
   people.
6. **The card stays with the person,** with a ring around them, and
   refreshes while open. It closes on ✕ or on picking something else. When
   the person leaves the tower the card says so and the ring goes. Naftali
   asked for a camera follow during the round: a **Follow** button keeps the
   camera on them until the player pans or presses it again.
7. **Room for names later.** The title is the person's role today; a Modern
   name can take that slot (not now).

## Not in this PR

- Naming people (Modern, later).
- Picking a rider inside a car.
- Stress beyond wait time: the engine keeps none per person today.
