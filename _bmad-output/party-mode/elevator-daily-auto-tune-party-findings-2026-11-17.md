# Party findings: daily Auto-tune for elevator schedules (2026-11-17)

Room: Engine Room (Ruth, Cloud Dragonborn, Winston, Link Freeman, Vera, Tess,
Anika, Kenji, Theo, Grumbal, Boundary), with Sally (UX) and John (PM) as
walk-ons for the dialog questions. Mode: session.

## The ask

Naftali (2026-11-17, 14:50Z): "Shouldn't it auto tune though?" The coordinator
proposed a per-shaft "Auto" checkbox, Modern only, that re-tunes the schedule
every game morning from measured traffic, hand-set schedules untouched,
Classic unchanged. Naftali said yes, and asked that it be planned with the
BMAD and GDS skills.

Today Auto-tune is a one-time fill of the Modern schedule dialog
(`engine-rs/src/schedule_authoring.rs`, `src/ui/uiElevatorSchedule.ts`). A
schedule tuned once goes stale as the tower grows, which is how Naftali's
left shafts starved. PR #2415 (open) fixes the measurement that made a cut
hour never win its cars back (`in_service_frac`) and tunes a shaft by its
twins' load (`twin_load`). This feature stacks on #2415.

## The round

🏗️ **Winston:** Where does the flag live? I see three homes: the transport,
the schedule, or a side table. The schedule already crosses the port as fixed
slots, rides the save as JSON, and is what the dialog's OK writes in one undo
step. Put it there.

🦀 **Ruth:** Agreed, `Schedule.auto_tune: bool`. One slot appended to the
`scheduleShaft` slots, so `SCHEDULE_LEN` goes 61 to 62 and the view layout
version moves. One command, one undo step, no new export. And `is_empty()` must
know about it, or a shaft with Auto on and no rows yet gets its schedule
coerced to `None` and the checkbox vanishes on the next read.

🌶️ **Boundary:** That is exactly the state a new shaft is in: Auto on, nothing
measured. Pin it with a test.

🕹️ **Link Freeman:** When does it run? `on_hour` already does the morning
venue roll-over. Offices arrive from 07:00 (`ARRIVE_FROM`). I want it in the
05:00 pass: after the night is sampled, before anyone queues.

🏢 **Kenji:** The original never retuned anything for you. That is fine,
Classic stays the 1994 grid. But in Modern, think about what a player sees: a
car count that changes at five in the morning is invisible; a car that
vanishes at 08:30 mid-rush is a bug report.

⏱️ **Tess:** 05:00 every game day, in transport order, inside `on_hour`, no rng,
`jsmath::round`. It reads only the rings and the tower. Determinism holds. I
want the save-at-04:59, load, run-past-05:00 test, byte-identical to the
uninterrupted run, and the conformance hashes unchanged with Auto off.

📈 **Anika:** Now the part nobody wants to hear. A daily loop on the
proposal's rule is a feedback system. With #2415, the ring stores load per car
in service, `e`, and the tune sets `c = round(e * fleet)`. Riders `R` spread
over `c` cars read as `R / c`, and the ring is an EMA with weight 0.3. The map
`e' = 0.3 * R / (fleet * e) + 0.7 * e` has slope `-0.3 + 0.7 = 0.4` at its fixed
point, so it converges, it does not ring. Rounding can still flip an hour by
one car when the fixed point sits on a half. Pre-register: on a steady fixture
over 21 days, no hour changes more than once in the last 7.

😤 **Grumbal:** And when that test fails you add a deadband constant that
nobody can source. Write the test first. If it fails, then we talk.

🎨 **Sally (walk-on):** The dialog. Checking Auto should do something you can
see, right now, not at five tomorrow. Checking it fills the grid with the
proposal (the same rows the Auto-tune button gives) and locks the rows, with
one line under it: "Auto re-tunes the car counts every morning at 5 AM from
measured traffic. Uncheck Auto to set them by hand." Presets grey out while
it is on. The Auto-tune button stays for hand-set schedules as the one-time
fill it is today, and hides while Auto is on, since it would do nothing.

📋 **John (walk-on):** What does Auto own? If it moves the staging too, a
player who staged cars at the sky lobby by hand loses that every morning.

🏢 **Kenji:** Car counts only. Staging, door time and waiting-car response stay
the player's. The first fill seeds staging only when the player has none,
exactly as the button does now. The morning pass never touches homes.

🌶️ **Boundary:** Cold data. Auto on, neither day warm: nothing changes, the rows
stay as they are, the dialog says "Auto starts once this shaft has measured a
day of traffic." One day warm: that day is tuned, the other keeps its row
(the proposal already does that). Cars sold: `refit` clamps as usual, the next
morning tunes to the new fleet. Cars sold to zero: `coerce` drops the schedule,
Auto goes with it, which is right, there is nothing to tune. Held-back hours:
Auto owns the rows, so the morning pass clears `heldBack` for the rows it
writes.

🗂️ **Vera:** Saves. `autoTune: true` is written only when on, read only as
`true`, so every old save loads with Auto off and loads byte-identical. The
other direction is the trap: a 4.10 build reading a new save drops the key,
keeps the last-tuned rows and stops tuning without a word. The save contract
says a save is stamped with the oldest version that reads it whole. heldBack
set that precedent at version 10. A save with any shaft on Auto is stamped 12;
one without stays where it is today.

😤 **Grumbal:** So a player on a stale PWA gets "made by a newer version"
instead of a tower that plays fine minus a checkbox. That is worse.

🗂️ **Vera:** The PWA updates on the next launch, and "reads it whole" is the
rule every other format change followed. Bend it once and the next one bends
it for something that matters.

🏛️ **Cloud Dragonborn:** Vera wins on consistency. Stamp 12 only when Auto is
on, so nobody else's saves change version.

🦀 **Ruth:** Undo has a sharper edge than the save. `Transport::config_eq`
compares the whole schedule, so a 05:00 re-tune makes every older undo step on
that shaft refuse ("the tower moved on"). Compare schedules with the
Auto-owned rows masked when both sides have Auto on. The morning pass is not a
gesture and opens no journal.

🕸️ **Theo:** The UI side: `ElevatorSchedule.autoTune?: boolean` in
`engineTypes`, one slot in `scheduleSlots.ts`, the d.ts note, and the dialog
reads the flag from `shaftSchedule`. Analytics: one `app_action`,
`elevator_auto_tune`, detail `on` or `off`, fired when OK changes the flag,
plus a dashboard tile. No event for the morning pass, it is not a player act.

⏱️ **Tess:** Hot path. The pass runs once per game day, per elevator with Auto
on. #2415's `twin_load` walks all transports per shaft, so E squared stop
checks once a day: at the 48-shaft cap that is about 2,300 subset checks a game
day, against per-tick work of tens of thousands of units. Nothing per tick,
nothing per frame. The HP record goes on the PR all the same.

🌶️ **Boundary:** A Bulletin line each morning?

😤 **Grumbal:** Forty-eight lines a day. No.

🏢 **Kenji:** No news. The schedule dialog is where you look.

📋 **John:** One open question that is Naftali's, not ours: should a NEW Modern
elevator start with Auto on? Old saves load with it off regardless.

📈 **Anika:** Off keeps every current tower's behavior and the conformance
hashes still. On would change what a fresh Modern game plays like.

🏢 **Kenji:** Off. A player who wants it ticks one box.

😤 **Grumbal:** Off until the convergence test has run on real towers.

## Verdict

1. **Flag:** `Schedule.auto_tune` (`autoTune` in the save and the TS type),
   one slot appended to the `scheduleShaft` slots (`SCHEDULE_LEN` 61 to 62,
   view layout version bump). `is_empty()` counts it.
2. **When:** the 05:00 hourly pass every game day, Modern only
   (`schedule_assist`), every elevator kind the Auto-tune button serves, in
   transport order, no rng.
3. **What it owns:** the weekday and weekend active-car rows only, from the
   same proposal the button uses (with #2415's twin load). A cold day keeps its
   row. Staging, door time and waiting response stay the player's. The morning
   pass clears `heldBack`.
4. **Dialog:** an "Auto" checkbox beside Auto-tune (Modern). Checking it fills
   the rows from the proposal at once and locks the rows and presets; the
   Auto-tune button hides while it is on. Unchecking keeps the current rows,
   now hand-owned. Cold data shows a waiting line.
5. **Save:** `autoTune: true` only when on; old saves load with Auto off,
   byte-identical. A save with any Auto shaft is stamped version 12
   (`SAVE_VERSION` 12, crate minor), others keep their version.
6. **Undo:** `config_eq` masks Auto-owned rows when both sides are on; the
   morning pass opens no journal. Toggling is part of the one schedule edit.
7. **Stability:** pre-registered Rust test: steady fixture, 21 days, no hour
   changes more than once in the last 7. No deadband unless that test fails.
8. **Determinism:** save at 04:59, load, run past 05:00, byte-identical to the
   uninterrupted run. Conformance hashes unchanged with Auto off.
9. **No news line.** Analytics: `app_action` `elevator_auto_tune` on/off when
   OK changes the flag, plus a dashboard tile.
10. **Classic:** no checkbox, no pass. TDT untouched (Modern has no TDT).
11. **Owner decision:** whether new Modern elevators start with Auto on. Room
    recommended off. **Naftali chose on (2026-11-17, 14:58Z):** every Modern
    elevator built from this version on starts with Auto on; old saves load
    with it off. Modern conformance hashes move in this PR as a result.

## Amendment during the build (2026-11-17)

🗂️ **Vera** and ⏱️ **Tess** caught it on the first determinism test: the
hourly load rings were never saved ("the save never carries it",
`telemetry.rs`), because nothing the game played read them. With Auto,
gameplay reads them, so a reload would re-tune differently than the game that
saved. And a ring warm by its day's count can still hold hours nobody
measured (the hours before a reload, a new shaft's first night), which a tune
reads as idle and cuts to one car, morning rush included.

12. **Save the rings with Auto:** a save with a shaft on Auto carries
    `elevatorLoad`, the hourly rings of every measured elevator (twins
    included), each day's 24 loads and its measured hours. Left out of the
    state view (the hash shows it through what it decides) and the `.TDT`
    path. A save with no shaft on Auto is unchanged.
13. **Unmeasured hours keep their count:** the pass writes the proposal only
    for hours the shaft's own ring has measured; any other hour keeps the
    count it runs now.

## Second amendment (2026-11-17)

The metro thread's first cut of PR #2415 read an hour whose running cars ran
full as one more car's share. Run every morning, that reading and the plain
proposal took turns, and a numeric probe of the 0.3 telemetry blend showed
an hour swinging by one car every day or two for most loads. The
pre-registered stability test (item 9) passed only because its tower never
ran a car full. #2415's second round replaced the reading with `cars_for`:
every proposal is the fewest cars that carry the hour's load below 0.9 of
each, so a tuned row has room and tuning it again proposes the same row.

14. **No day-to-day swing:** the morning pass needs no rule of its own. A
    regression drives 30 mornings of the blend for every load from none to
    the whole fleet, each day measuring no more than the running cars carry,
    and checks each settles on one count whose cars have room
    (`a_cut_hour_never_swings_back_and_forth`).
