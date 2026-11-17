# 4.x scope audit: roundtable party (2026-11-17)

Requested by Naftali (2026-11-17 23:09Z, "Do an audit with a proper roundtable party"). BMAD party mode, Cross-Cutting Plan Review room (session mode), run against `main` at `9bdb246` (release 4.13.0 merged).

**Owner rules the room applied (2026-11-17, Naftali's own words via the project chat):**

- All new features hold and move to 5.0. Bug fixes and every speedup or perf PR stay in 4.x (#2444 and #2445 are approved once their review GO lands).
- "Anything that fixes docs, or stuff like that should stay in 4.x" (23:10Z).
- Close issues whose work already shipped or no longer applies, with the evidence (23:10Z, on #1336).

**Scope read:** 5 open PRs; the 75 open issues in milestone 4.x plus #2435 in Triage; the docket in `4x-priorities.md`; and a sweep of the 31 issues in 5.x, 22 in 6.x and 36 in Backlog for misfiled fixes and finished work. PR cross-references were pulled for all 187 open issues, and every close candidate was checked against the code on `main`.

**In the room:** 📋 John (product), 🏗️ Winston (architecture), 🏛️ Cloud Dragonborn (game architecture), 🎨 Sally (UX), 🎲 Samus Shepard (game design), 💻 Amelia (engineering), 🕹️ Link Freeman (game dev), 📈 Anika (data), 🛡️ Noor (privacy), 😤 Grumbal (adversary), 🌶️ Boundary (edge cases). Vex sat in for the save and import items.

---

## The roundtable

📋 **John:** Ground rules from Naftali, one sentence each: new features go to 5.0, fixes and speedups stay, docs stay. Our job is sorting, not reopening the rule. And he wants dead issues closed. He pointed at #1336 himself.

😤 **Grumbal:** Then start with #1336, because it's the one that proves the last two triage parties were too polite. "Retire the TypeScript save codec." The TypeScript engine is gone (#1956). The TypeScript `.TDT` codec is gone. What's left in `src/storage/`?

💻 **Amelia:** Two files. `towerFileCodec.ts` rewraps a stored `VCZ1:` value into `.vctower` text. It never decodes the tower; its header comment says a decode-and-re-encode would burn Founder status. The new save model (#2411) ships on it: `towerDocument.ts`, `keepOutgoing.ts`, `unreadableStash.ts` and `fileSpaceMigrate.ts` all call `toTowerFile`. The other file, `vctowerContainer.ts`, is a Node-side fflate reader. Only tests, goldens and the perf harness import it.

😤 **Grumbal:** So the "codec" the issue wanted gone is gone, and what's left is a byte rewrapper the save model needs and a test helper. Nobody is going to port a byte rewrap to Rust for fun. Close it.

🌶️ **Boundary:** One check before it goes: does anything shipped still deserialize a tower in TypeScript? `towerFileCodec` does `JSON.parse` only to sniff that the payload looks like a tower before rewrapping. That is a shape check, not the codec the issue meant. Fine by me.

📋 **John:** #1336 closes as completed. Next dead one?

🎨 **Sally:** #372. "Tap the traffic chip to fly the camera to the hotspot floor." That's my own IOU from July, and #2437 shipped it today: tapping "Backed up" zooms to the floor, flashes it and outlines the shafts. It's sitting in 5.x like it never happened.

😤 **Grumbal:** Close it. And while we're subtracting: three issues ask us to extend a guard test. #1161 wants `engineCompat.guard.test.ts` to pin the Rust `pub` API and JSON shapes. #1247 wants `fileSize.guard.test.ts` to scan `.mjs`. #1323's first item wants `engineRsPaths.guard.test.ts` to match workflow lines exactly. Naftali said on the 14th, "stop adding those." A guard that scans more files is a new meta-test with an old file name.

🏗️ **Winston:** I'll defend #1161's intent for ten seconds: an API change without a crate bump is a real risk. But the owner closed that hole a different way this evening. Every PR that touches engine code must carry a crate tier, and reviewers check it. That's a human gate on exactly the thing #1161 wanted a scanner for.

😤 **Grumbal:** Ten seconds well spent. Close #1161 not planned.

💻 **Amelia:** #1247 without the guard half is "split one 628-line script." No player, no reviewer, no CI run is waiting on that. Close it not planned too. #1323 keeps items 2 and 3, which are real library test gaps. Drop item 1 and leave it in Backlog.

📋 **John:** Agreed. Now the misfiled ones. Anika, you had a list.

📈 **Anika:** Three in 5.x that Naftali's rules pull back into 4.x. #2210 is a defect: undo refuses a lobby gesture it should allow. This afternoon's close-or-punt party moved it to 5.x because "bugs never go to Backlog." Under tonight's rule, bugs stay in 4.x. #970 is audio *docs* drift: README and project-context say things that aren't true. #1203 is the hot-path review rules page. Docs and process, both of them.

🎲 **Samus:** #1203 needs Naftali to make six rule calls. Putting it in 4.x doesn't make him answer faster.

📈 **Anika:** It doesn't need to be fast. It needs to be in the milestone his rule says. A docs issue in 5.x is a docs issue nobody picks up for a month.

📋 **John:** 4.x, with a note that it waits on owner rulings. And the perf direction?

🏛️ **Cloud Dragonborn:** Two speedups are parked in 6.x as if they were features. #654: the move-in gate rebuilds the satisfaction context per candidate, up to a 48-step forward sim each, every hour. #911: an eviction wave rebuilds the context per bought-back condo. Both still hold in Rust (rechecked on 2026-11-04 and today). The perf audit is already in the move-in pass with #2445 and named an "eviction probe" next. These belong in 4.x perf, handed to that thread.

🕹️ **Link Freeman:** And #569 is in 4.x but can't be done in 4.x. "Confirm the 1994 reader accepts lobbyHeight 0." That's a run of the original game. The PC run is parked. It goes in "classic parity - needs pc" with the other 22.

📋 **John:** Fine. Now the sort itself. Features to 5.0. I'll read them; shout if one is really a fix.

📋 **John:** #646 rows of rooms (PR #2442), sky bridge looks (PR #2434), #714 express stops, #2212 parking capacity, #2010 import a `.TDT` into Modern, #635 a founding badge for imports, #382 rebuild in place, #313 the venue inspector detail, #324 the finance window, #919 read models for other frontends, #826 floor beams, #681 separate Studio and Apartment decor.

🎨 **Sally:** #826 and #681 are new art. They wait on Naftali's own pick anyway, per his design sign-off rule. 5.0 is the honest place.

🏗️ **Winston:** #919 is new engine API, a crate minor with no player change. Feature.

🎲 **Samus:** I'll fight for #1713. "Inspector eval reason line for every unit, 1994 style." The original shows why a unit is unhappy. That's a Classic fidelity gap, and the owner's standing call is that Classic gaps live in the current milestone.

😤 **Grumbal:** It's a new line of UI on every inspector, with new engine reads behind it. If that's a fix, so is the finance window. Fidelity isn't a magic word that turns a feature into a bug.

🎲 **Samus:** Then split the pair. #549 is the fix half: Modern-only "fix" advice leaks into Classic today ("Add cars or shafts." is baked into the Rust gripe text with no mode gate). Classic says something the 1994 game never said. That's wrong output, today.

📋 **John:** I'll take that split. #549 stays in 4.x as a fix. #1713 goes to 5.0.

📈 **Anika:** Two more model changes that dress like fixes. #436 re-keys the lobby-distance pressure on reach and transfer depth: a satisfaction model redesign, and it moves balance. #2298 re-keys commute stress per floor stretch, and its done-when changes what saves carry. Both are 5.0, and #2298 should ride the lot-shape save bump rather than cause its own.

🛡️ **Noor:** #612 is a new analytics event (a speed engagement bit). Nothing is broken without it, and a new event deserves its own data-map line when someone actually needs the number. 5.0.

📋 **John:** And #356 is a parked idea that only comes back on measured starvation. 5.0. Everything else in 4.x is a fix, a test, docs or tooling, or perf. Amelia, split the perf list.

💻 **Amelia:** 4.x perf: #1984 express stop bitset (in progress, no gameplay change), #2060 door-list sort, #1261 shaft overlap per pointer move, #1143 bare-step hotspots, #1158 hot-path audit, #1285 facade item 4, #908 worker host measure-or-delete, #845 high-refresh motion check, #1260 `.TDT` export reparse, #1443 stamp-key parse, #1612 cheap census export, #1655 off-thread export, #1745 recycling card read, #1802 undo without a full swap, #2086 `.TDT` merge on forged files, plus #654 and #911 coming over. Every one ships under "nothing slower", measured.

🌶️ **Boundary:** Note on #2086: forged-file merge cost is also a denial-of-service shape for a hostile `.TDT`. Perf label, but treat it as a hardening fix in review.

📋 **John:** Open PRs, quickly. #2446 manual sync: docs, 4.x. #2445 move-in copy: perf, 4.x, merges after its GO and after 4.13.0 is live. #2444 Auto line-at-stops with day-long tests: that's the follow-up to tonight's prod hotfix, a fix, 4.x. #2442 and #2434: 5.0, drafts with auto-merge off.

---

## The shaft question

📋 **John:** The docket thread found that the game lets you place a room where an elevator shaft runs through the floor, with a single click. Bug or feature?

💻 **Amelia:** Facts first. `room_placement_reason` checks rooms against rooms and structure; it never looks at transports. `validate_transport` checks a shaft against other shafts and floor slabs; it never looks at rooms. And it's on purpose: there's a rule test, `a_shaft_resizes_over_rooms_and_is_placed_over_them`, ported from the TypeScript engine, that asserts both directions succeed.

🕹️ **Link Freeman:** Ported. Nobody chose it in Rust, they kept what the TypeScript engine did.

🏛️ **Cloud Dragonborn:** And our own `.TDT` code disagrees with it. `tdt/transports.rs`, the shaft synthesizer, leaves a shaft out rather than put it over a room, with the comment "a shaft over a room would be an invalid tower." `tdt/parse/fallback.rs` does the same. The format work concluded the 1994 game does not hold a room under an elevator shaft. So a Classic tower built with an overlap today exports a file our own importer would call invalid.

🎲 **Samus:** The wiki line I trust here: "Steps and elevators cannot overlap each other, but they overlap most rooms." That sentence is about stairs. Stairs and escalators sit over rooms in the original (escalators even need commercial floors under them, MAN p.55). Nothing says elevators do.

🎨 **Sally:** And as a player: a room under a shaft is half hidden. You can't read its state, you mis-click the shaft when you mean the office. That's a usability bug in Modern even if nobody cared about canon.

😤 **Grumbal:** Here's how it pages someone at 3am. You "fix" placement, and a player's existing tower, the one with forty offices behind shafts, fails to load or silently drops rooms. Naftali's rules: no lost saves, nobody vanishes.

🌶️ **Boundary:** So the fix is placement only. New placements are refused; whatever is already in a save loads exactly as it does today, with no loader change, no save version change and no change to the conformance replay of old towers. Edge cases to pin: a shaft *resize* or *extend* through a room column (the same test today asserts it succeeds), undo or redo that would re-place a room under a shaft, and the row drag in #2442, which already promises to "stop cleanly at shafts."

🏗️ **Winston:** It's a rule in `Tower` placement, both directions, behind the catalog's refusal reason so the web shows the engine's message. Engine change, so a `crate: patch` and an Engine line, per tonight's crate rule.

📋 **John:** Classic, Modern or both?

🎲 **Samus:** Both. Modern may differ from Classic when it's better. Hiding a room behind a shaft isn't better.

😤 **Grumbal:** Fine. One condition: the PR shows a real old save with an overlap opening to the identical game, before and after. Not a fixture we made up.

**Verdict on the shaft question: bug, 4.x fix, both modes.** An elevator shaft (standard, service or express) and a room can no longer be placed on the same tiles, in either order: placing a room through a shaft, placing a shaft over a room, and resizing or extending a shaft through a room are all refused with an engine reason. Stairs and escalators keep overlapping rooms as they do now (canon). Existing towers are untouched: no loader change, no save change, and a real save that already has an overlap opens to the identical game (Grumbal's condition). The ported rule test flips. It's an engine change, so it carries `crate: patch` and `app: patch`. The docket thread owns it.

---

## Verdict

### Close (work shipped or no longer applies)

| Issue | Why |
|---|---|
| #1336 Retire the TypeScript save codec | Done. The TypeScript engine (#1956) and the TypeScript `.TDT` codec are gone. What remains is `towerFileCodec.ts`, a byte-preserving container rewrap that never decodes a tower and that the shipped save model (#2411) uses; `vctowerContainer.ts`, which only tests and tools import; and the fflate writer in `vctowerWriter.ts` (`packVctower`), kept on purpose as the never-lose-a-save fallback when the engine writer throws and for saves over the engine writer's size cap. |
| #372 Tap the traffic chip to fly to the hotspot floor | Shipped in #2437 (in 4.13.0): tapping "Backed up" zooms to the floor and outlines the shafts. |
| #1161 Pin the pub API in the crate version guard | Not planned. It extends a guard test that scans source, which the owner barred on 2026-11-14. The risk it covered (an API change without a crate bump) is now the reviewer-checked crate tier rule (2026-11-17). |
| #1247 Hold .mjs scripts to the 500-line ceiling | Not planned. The guard half is barred by the same rule; splitting one script alone has no taker and no player effect. |

#1323 stays in Backlog with item 1 (the workflow guard) dropped for the same reason.

The rest of 4.x was checked and is still real (for example #1957 still has stale `src/engine/` references, #2080's guides still pin 1.24.0 against crate 1.50.0, #1260's export still re-parses the save text, #2060 still sorts both door lists each chunk). Most of 4.x was re-audited on 2026-11-15 and 2026-11-17, so the stale sweep found little.

### Move

| Issue | From | To | Why |
|---|---|---|---|
| #2210 undo refuses a lobby gesture | 5.x | 4.x fix | A defect; bugs stay in 4.x. |
| #970 audio docs drift | 5.x | 4.x fix | Docs fix. |
| #1203 hot-path rules gaps | 5.x | 4.x fix | Docs and process; waits on owner rulings. |
| #654 move-in gate recompute cost | 6.x | 4.x perf | A speedup; hand to the perf audit (move-in pass). |
| #911 eviction wave rebuilds context | 6.x | 4.x perf | A speedup; the perf audit's "eviction probe". |
| #569 1994 reader and lobbyHeight 0 | 4.x | classic parity - needs pc | Needs the parked PC run. |
| #313, #324, #356, #382, #436, #612, #635, #646, #681, #714, #826, #919, #1713, #2010, #2212, #2298 | 4.x | 5.x | New features or model changes (see below). |

### Open PRs

| PR | Bucket | Note |
|---|---|---|
| #2446 Bring the manual up to date | 4.x docs | |
| #2445 Copy a vacant room once | 4.x perf | Merge after its review GO and after 4.13.0 is live (owner OK). |
| #2444 Auto elevators learn the line at their stops | 4.x fix | Follow-up to the 4.13.0 prod hotfix (#2441). |
| #2442 Row of rooms (#646) | 5.0 feature | Draft, auto-merge off. |
| #2434 Sky bridge looks | 5.0 feature | Draft, auto-merge off; also waits on Naftali's design pick. |

### 4.x after the audit

**4.x fix (bugs, parity corrections, tests, docs, tooling):**

- Gameplay and save fidelity: shaft blocks rooms (new, from this party), #2435 shop-only floor reads jammed, #2188 "gave up waiting" on the person card, #2386 staff patience at leg speed, #2168 meal floor service check, #2210 undo lobby roots, #305 `.TDT` schedule bytes round-trip, #1503 theatre halves and metro in `.TDT`, #549 Classic shows cause only (no Modern fix advice), #1556 schedule review leftovers, #724 "already built" message on floor 1.
- Web and input: #2206 service worker rollback, #628 palette tab keyboard navigation, #1841 Firefox Space release, #1842 held Enter repeat, #586 grab cursor, #1202 crash link diagnostics.
- Analytics correctness: #603 idle frames in session FPS, #621 bfcache latches, #1631 autosave failure kinds, #2075 import/export reason codes, #940 retire the unused emergency counters, #977 rule window scope.
- Tests and conformance: #680, #864, #869, #1117, #1154, #1288, #1351, #1816.
- Docs: #682, #970, #1203, #1356, #1957, #2080.
- Tooling and cleanup: #976, #978, #1079, #1369, #1945, #1976, #1676, #2081.

**4.x perf (one measured PR each, nothing slower):** #1984 (in progress), #2060, #1261, #1143, #1158, #1285, #908, #845, #1260, #1443, #1612, #1655, #1745, #1802, #2086, #654, #911.

**5.0 feature:** #646 (PR #2442), sky bridge looks (PR #2434), #714, #2212, #2010, #635, #382, #313, #324, #919, #826, #681, #1713, #436, #2298, #612, #356, joining the Tall lot, wide lot and the rest already in 5.x.

### Docket after the audit (next up, in order)

1. Shaft blocks rooms (fix, docket thread).
2. #1984 express stop bitset (perf, in progress), then #2060 door lists (the same dispatch code).
3. #549 Classic shows cause only.
4. #305 `.TDT` elevator schedule round-trip.
5. #2188 and #2386 (person card and staff patience, both in `crowd/`).
6. Perf batch through the perf audit thread: #654, #911, #1261, #1802.
7. #2168 meal floor service check.

## Dissent recorded

- Samus wanted #1713 kept in 4.x as a Classic fidelity gap; the room split the pair and sent #1713 to 5.0, keeping #549 as the fix.
- Winston wanted #1161's risk kept in view; it is covered by the crate-tier review rule rather than a scanner.
- Samus noted #1203 waits on six owner rulings and moving it does not make those faster.
