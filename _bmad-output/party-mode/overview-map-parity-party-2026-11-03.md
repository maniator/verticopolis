# Party: Map window parity with the original for 3.0 (#343, 2026-11-03)

> **Snapshot, 2026-11-03.** Run on Opus at the owner's request. It supersedes the morning's heatmap-picker party (`overview-map-heatmap-picker-party-2026-11-03.md`) wherever the two differ. The live contract is `_bmad-output/specs/spec-overview-map/SPEC.md`, which S5 updates.

Room: John (PM), Samus Shepard (game designer), Sally (UX), Amelia (dev), Tess (performance QA), Grumbal (adversary), Boundary (edge cases).

On the table, from Naftali: "I feel like we should try to be at parity for 3.0." Earlier he also said: "the map overlay option should only be on the minimap, no? Not in the sidebar."

The coordinator's frame: aim for parity in 3.0 with the original's map views, Eval (#1618), Pricing (#1619) and Hotel (#1617), plus a decision on where the picker lives. Each slice is its own PR after S4 and S5. Anything not merged by the RC freeze defers to 3.1.0, and no gate is weakened.

What exists:
- **Hotel:** `UnitView.state` already carries `dirty` and `infested`.
- **Eval:** the original colors each room by its rating. The engine offers only `floorHeatmap('satisfaction')`, which is per floor. Per-room ratings need an export.
- **Pricing:** there is no per-room rent perception read. It needs an export.
- **The retail window:** a row of four buttons (Edit, Eval, Pricing, Hotel) above a 200 by 288 body. Each tab draws its own legend over the top of the map.

---

**John:** Parity is the owner's call now, and the scope is three tabs and a home for the picker. Let's agree the shape first, then the order.

**Grumbal:** One line first. Decision 8 says nothing half-built reaches players. If Hotel ships in December and Pricing slips, players get a tab row with a hole in it.

**Amelia:** Then the tabs get their own flag. S5 still takes `?map` off and ships the Edit view as planned, so v1 is safe whatever happens to the tabs. The tab row is built behind a second preview flag until all of its tabs are in, and one slice flips it.

**Tess:** And if the freeze lands with Pricing unmerged, the whole tab set goes to 3.1.0 together. v1 ships either way.

**Grumbal:** Fine. That's the only version where "try to be at parity" can't cost us the map itself.

**Samus:** Order by risk. Hotel has the data today, so it goes first, with the tab row it lives in. Then a Rust slice that exports per-room ratings for Eval and per-room rent level for Pricing together: one crate bump, one CHANGELOG section, one `engine:compat` run. Then both views on top.

**Amelia:** One export, read as a batch like `rentBatch`. It needs a dirty key, since ratings move without a revision change. The map repaints those tabs on a throttle, once per game hour, the way #1617 already says for Hotel.

**Tess:** Once per game hour, and no frame repaints them in between. And the batch is read only while a non-Edit tab is open. A closed map or the Edit tab reads nothing new.

**Sally:** Now the picker. Naftali wants it on the minimap, and the original agrees with him. Once Eval and Hotel exist, the sidebar's Satisfaction and Housekeeping modes ask the same question twice.

**Boundary:** Congestion and Occupancy have no original tab. They're ours.

**Samus:** Then they become Modern-only tabs on the map: Traffic and Occupancy, after the four originals. Classic shows exactly the original four.

**Grumbal:** You're about to delete a shipped feature. Today the heatmap tints the main view where people build. Move everything to the minimap and that tint is gone.

**Sally:** It's what the owner asked for: one place for views, and it's the map. The main view gets simpler. A returning player finds the same metrics one window over, colored in the same place they look for the tower's shape.

**Grumbal:** Then the CHANGELOG says it out loud, and the owner hears it plainly before the slice merges. I'm not letting a removal ride in on a parity story.

**John:** Agreed. That's the one call we flag back to him.

**Boundary:** The phone card is 150 px wide, and four 44 px tabs don't fit in a row. Six certainly don't.

**Sally:** Make it a 2 by 2 grid on the phone for Classic and a 3 by 2 grid for Modern, each cell at least 44 px tall. Desktop keeps the original's single row. The legend sits over the top of the body, as in the original, and the card already covers the main view's top-left, so the old legend clash goes away with the main-view tint.

**Amelia:** `overviewMapWindow.ts` is at 499 lines. The tab row is a new file (`overviewMapTabs.ts`) wired by one line, and each view is a style-table entry plus a painter mode, so the window file does not grow.

**Samus:** One more parity item: whether a view tab pauses the game in the original. Check it on the PC reference when Naftali is at the PC. It doesn't block, and the default is no pause.

## Outcome

1. **v1 is unchanged and ships first.** S5 removes `?map` and ships the Edit view: the rename, Help, the gallery, the paired perf pass (the owner later chose to merge S5 first and run it on the PC before the RC, #1726) and the S4 follow-ups. The view tabs never hold v1 back.
2. **The view tabs ship together or not at all.** They are built behind a second preview flag, `?mapviews`, and one slice flips it. If any tab misses the RC freeze, the whole set moves to 3.1.0.
3. **Slices**, each a single PR:
   - **S6:** the tab row (Edit, Eval, Pricing, Hotel) and the Hotel view (#1617), using existing data.
   - **S7:** a Rust export with per-room rating and per-room rent level in one batch read. Crate bump, CHANGELOG, `engine:compat`, the conformance lock and the binding declaration.
   - **S8:** the Eval (#1618) and Pricing (#1619) views. Classic uses the retail palette, Modern a richer one, with a non-color cue on each.
   - **S9:** the Modern-only Traffic and Occupancy tabs; the sidebar picker and the main-view tint are retired; the `?mapviews` flag comes off; Help, gallery, CHANGELOG and a minor bump.
4. **The picker moves to the map.** It becomes the map's tab row, which is the owner's ask and the original's layout. **This removes the main-view tint, a feature players have today, so it is flagged back to the owner before S9 merges.** If he wants the tint kept, the sidebar keeps a Traffic and Occupancy tint and only the duplicated modes move.
   - **Owner answer (2026-11-03):** "Tint/colors on the minimap makes more sense to me honestly." The original tints only the MAP window (the retail captures show the main view unchanged in every tab), so the colors and the chooser go on the minimap only and the main-view tint retires in S9. Asked whether he wanted a main-view tint toggle kept, he said "Nah that's fine", so S9 retires the main-view tint with no toggle.
5. **Phone:** the card shows the tabs as a grid, 2 by 2 for Classic and 3 by 2 for Modern, with every target at least 44 px. Desktop keeps the original's single row.
6. **Cost:** the new views repaint on a throttle (once per game hour) and read the batch only while a non-Edit tab is open. Each slice carries the hot-path record.
7. **Pause behavior:** whether a tab pauses the game in the original is checked on the PC reference when the owner is at the PC. It does not block, and the default is no pause.
