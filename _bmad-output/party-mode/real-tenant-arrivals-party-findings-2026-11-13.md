# Party findings: real tenant arrivals (2026-11-13)

Two rooms, run in session mode on the design note
`_bmad-output/planning-artifacts/design/design-real-tenant-arrivals-2026-11-13.md`:
the Engine Room (dev) and the Player Panel (players). Short transcript, then
what changed in the plan.

## Engine Room

🏢 **Kenji:** Finally. In the original, the morning rush *was* the game. You
watched the lobby fill, the queue numbers go red, and you knew which shaft
was failing before the office went bad. Six people on 34 at 7:30 with nobody
on the escalator? That's a screenshot of a different game.

😤 **Grumbal:** Nostalgia noted. Here's who gets paged: you replace the
dispatch estimate for office floors and keep it for everything else. A mixed
floor, offices plus a condo, now gets real calls *and* the estimate. Double
demand, cars parked on 34 all morning.

🦀 **Ruth:** Then the estimate goes per unit, not per floor. `accumulate_waiting`
already walks rooms; a roster kind contributes nothing to it. One demand
source per unit, and a test that sums both sources for a mixed floor.

😤 **Grumbal:** A test that *fails* if a unit is counted twice. Not a test
that prints a number.

⏱️ **Tess:** And the event queue needs a total order. Two workers ending a leg
on the same tick: break the tie by (tick, roster id), never by heap insertion
order. Otherwise the hash moves between a native build and WASM the first
time someone touches the push order.

🦀 **Ruth:** `BinaryHeap<Reverse<(u64, u32)>>`, roster as plain arrays, u32
ids, no `HashMap` lookups per event. A bulldozed unit marks its slots dead
and the queue skips dead entries when they pop, so removal is O(slots).

🌶️ **Boundary:** Then walk the removals. Unit bulldozed with three of its
people in a car. Shaft deleted while someone's riding it. Tenant evicted at
7:58. Bomb search: #2113 freezes everyone but guards, so the roster freezes
too, or the office fills during a lockdown. Mode switch mid-commute. And a
save at 7:45 with half the floor in the lobby queue.

🗂️ **Vera:** That last one is mine. The note says "save the roster, settle the
version in the first PR". Not settled later: the groundwork PR ships the
field and a test that saves at 7:45, loads, steps two game hours and matches
the run that never saved. Old saves get the clock placement once, and a
fixture proves a 3.7.0 save opens.

🏢 **Kenji:** One more for the PC batch. The original's hall queue holds 40
people per direction per floor. What happens to the 41st? I remember crowds
spilling out of the lobby, but I wouldn't bet a rule on my memory.

📈 **Anika:** And measure the economy before PR 3 merges. Staffed offices feed
lunch trips. If offices fill later, fast food lunch traffic moves. Run the
headless towers before and after and report the income delta. If it is past
noise, say so in the PR instead of discovering it in a review.

🕸️ **Theo:** Nothing for me until PR 4, and PR 4 waits for #2116. Fine. Keep the
frame layout untouched in 2 and 3.

😤 **Grumbal:** Last thing. "Classic keeps 8 AM to 6 PM until measured" is a
rule nobody sourced, wearing a canon badge. Label it as today's behavior,
pending batch R.

## Player Panel

🌐 **Priya:** I like it, but if my offices sit half empty because my elevators
are bad, tell me on the room card. "3 of 6 here, 3 on the way" beats
guessing.

♿ **Wren:** Seconded, and in words. Arrivals can't only be people walking on
screen. Reduced motion players still need to know the office is waiting on
the sky lobby transfer.

💻 **Tomasz:** At 15,000 people, does my laptop melt? You said "events, not a
scan". Prove it on the slow machine, not in a sentence.

🤖 **Lucia:** Same on my phone. And if the roster makes the step heavier, I
feel it as battery, not frames.

🎒 **Femi:** My school laptop has a tower from last month. If it opens with
everyone teleported home, fine. If it doesn't open, I'm gone.

🖥️ **Kai:** I want the rush. Hundreds of people in the lobby at 8 AM is the
fun part. Don't cap the drawn crowd at 140 forever.

🏢 **Kenji:** That's #2092's renderer budget, Kai. This plan makes the people
real first. Drawing more of them comes after.

## What changed in the plan

1. Demand: the dispatch estimate goes per unit, so a roster unit never
   contributes to it and a mixed floor is never counted twice. A failing test
   guards it (Grumbal, Ruth).
2. Determinism: events order by (tick, roster id) (Tess).
3. The roster freezes during the bomb search, like the crowd (Boundary, #2113).
4. Removal cases each get a test: bulldoze, transport deleted mid-ride,
   eviction mid-commute, mode switch (Boundary).
5. The groundwork PR ships the saved roster with a save-at-7:45 round-trip
   test and an old-save fixture (Vera).
6. PC batch R adds the hall queue overflow question (Kenji).
7. PR 3 reports a headless economy before-and-after (Anika).
8. The room card says how many are here and how many are on the way, in
   words (Priya, Wren). Small UI in PR 3.
9. The 8 AM to 6 PM window is labeled as today's behavior pending batch R,
   not as canon (Grumbal).
10. PR 3 measures step time at 5,000 and 15,000 population on the low-end
    profile and states the number (Tomasz, Lucia).
