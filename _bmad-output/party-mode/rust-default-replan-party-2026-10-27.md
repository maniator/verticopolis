# Rust-default 3.0 replan: party transcript

> **Snapshot of Tuesday, Oct 27, 2026 (main 511dadf, app 2.47.0, crate 0.8.0). It does not refresh.** The decision packet that came out of this sitting is "Rust-default 3.0 replan: decision packet" (https://claude.ai/artifact/VccZTZe6p2iBBaqBcSwwhn). The live gate state is #1104 and the plan of record is section 1.3 of the release plan (PR #1271). Dates and counts the room quotes are projections from the plan's own durations and the governed traffic figures, and they are projections only. Nothing here activates a stage, flips a default, deploys or publishes 3.0.0; those stay with Naftali.

> **Correction, 11:45 UTC Oct 27.** The PC session is already back: its benchmark queue started at 11:01 UTC today under Remote Control (#1068's pair, then #1343, the size run, A8 load memory and the stage-1 recheck). The room worked from the 1:20 AM EDT daily report, which had the PC offline since Oct 21, so speeches below that call the PC dead or offline reflect that report. The decision packet has been corrected; the dates in it assume the PC stays available.

> **Addendum, 11:46 UTC Oct 27.** The facade plan lane reports (PR #1347) that slice 7 is six PRs, two of which wait on owner cards (6a's per-frame room compare and the F2 amendment for slice 5a) and one on 6c's remaining families. The plan's projections for slice 7 (Nov 5 to 8) and slice 9 (Nov 13 to 18) therefore look optimistic, and Dec 12, slice 10's latest date, is likelier. Speeches below quote the plan's dates; the packet carries both cases.

## What was asked

Naftali, 11:14 UTC Oct 27: "Remember we can probably release 3.0 beforehand and just set rust as default engine and then in 3.x remove ts as engine option." Then: "Maybe take to a proper bmad party." The room answered three questions: which #945 rows and facade slices are needed for "Rust default, TypeScript still selectable" and which only to remove TypeScript; the minimum evidence before the default flip, with every changed requirement listed as an owner decision; and new dates plus the 3.x removal plan.

## How it was run

Three rounds in the Cross-Cutting Plan Review room, one speaker per turn, each given a shared brief, the earlier rounds and a lens. Speeches below are verbatim. Staging and the facilitator's notes are marked and kept short. The roster is the planning party's (John, Winston, Anika, Grumbal, Ruth, Vera, Tess, Theo, Dana, Oona) plus two voices added for this sitting: Tomasz, a player on a low-end PC, and Bea, the community and player-support lead.

## Round 1

🏗️ **Winston:** I cut by what we can undo after the flip, and undo is slower than it looks: a drop-back is a deploy, and installed PWAs only get it on their next online launch. So I won't move slice 10 (today's host takes 6.1 s on a large tower, TS 0.69 s), saves both ways with the TS codec intact, the forced-trap fallback spec, #985 offline integrity, or the rollback rehearsal. On the wrong side today: slice 11, because deleting the mirror host is the step that costs most to undo and only removal needs it; the retirement inventory; TDT in the crate. The 1,000-session count and its freeze are removal-grade evidence. I'd put 300 sessions (1.0% bound) to the owner as an explicit decision. I expect pushback there, and on the soak, which the owner kept.

📈 **Anika:** Yes, move it, with conditions. Before the flip I want the plan's own floors, 100 engaged sessions at stage 2 plus the 100-session tail, and I'll say plainly that zero failures in 100 bounds the rate at 2.95% at best; 0.30% needs 1,000. That is tolerable because fallback makes a fault recoverable, at up to 30 s of play lost. Before removal I want 1,000 clean, which at 100% is about 70 days instead of 141 at a 50% arm. Pre-register now: a fault is any fault event, recovered fallbacks included, because fallback otherwise launders failures into successes; the denominator is engaged eligible Rust sessions, counts only; the stop rule; no early reads. I expect pushback that 2.95% is too thin to flip on, and any browser or device with no sessions in the count stays unbounded.

⏱️ **Tess:** Time buys only field sample size. The 1,000-session row can shrink if the owner accepts a quoted bound: zero failures in 100 sessions is 2.95%, in 300 it is 1.0%. Nothing in the lab trades: M1 to M8, conformance, dual run, saves byte for byte, offline PWA, rollback rehearsal. A mismatch stops the line, and the 14 counted nights arrive one per night. Delta and epsilon get pre-registered from 60+ hours of A/A before any M-row is read, and the one PC runs serially: calibration, size run, slice 9, RUN-1, RUN-3. PC offline since Oct 21, so slice 9's Nov 13 to 18 readout slides day for day. A Ryzen 5 5600X says nothing about phones or Chromebooks. Naftali will say the ramp covers them. Show me the trace.

😤 **Grumbal:** One concession: the bare engine really is faster, 0.41x to 0.43x of TypeScript. Nobody ships the bare engine. Players get the mirror host, 6.1 s per 720 steps against 0.69 s, heap 2.7x. Flip that to everyone and the 3am page is a Chromebook that, my guess, crawls but never faults. The fallback fires on a fault, slow is not a fault, and those players never open Settings. The gate that catches it is Performance M1 to M8, and no hosted run has passed. Dropping back is a deploy, so installed PWAs stay slow until their next online launch, and a real fallback costs up to 30 seconds of play. Selectable also keeps #1112 alive: every simulation change in both engines. Two copies of one fact, one wrong by Friday.

🚢 **Dana:** Most of the gap to May 16 is one row. Reliability at 1,000 sessions takes about 141 days at the 50% arm, and F2's freeze window and the observation tail exist to wrap that count. That is a TypeScript-removal standard. For the flip I'd propose 300 sessions (1.0% bound, about 42 days at 7.1 a day, my arithmetic) and move the 1,000 to the removal gate, where two releases on WASM already is the field evidence. Hard stops stay: facade as the WASM host with M1 to M8 passing on his PC, A9 saves with the TS codec fallback, rollback rehearsal, offline cold start. Slice 11's deletion, the 360-test mapping and the 82 files go to 3.x; keep the 7-night soak. Each change is a listed owner decision. And someone nudge him to restart that PC.

## Facilitator's draft shape (a thing to break, not an endorsement)

"One freeze, windows side by side, flip as a short ramp."

Hard stops before the flip, none traded for time: facade through slice 10 with M1 to M8
passing on the owner's PC (slice 9 on provisional caps, RUN-1 and RUN-3 on calibrated
ones), conformance, dual run, 14-night seeded replay, saves both directions plus A9 with the
TS codec as fallback, rollback rehearsal, offline #985, forced-trap fallback spec,
analytics (X1 or exception).

Moved to the 3.x removal gate: the 1,000 engaged sessions with the bound reported; slice 11
(mirror removal) after the soak, in 3.0.x or 3.x; the retirement inventory, the 360-test
mapping, the 82 frontend files, #1239's TS twins, TDT in the crate.

Field evidence before the flip is a choice of count, on the facade host, with the stop
signals unchanged, no size gate on the facade, and one freeze whose candidate deploy starts
the tail at stage 2 (so stage 2's 100 engaged sessions are also the tail):
  (i)  the plan's own floors: stage 1 30, stage 2/tail 100, stage 3 soak 50 = 180 sessions
       (1.65% bound), flip about Jan 9 to 10;
  (ii) 300 engaged sessions on the facade at stage 3 (1.0% bound), flip about Feb 13;
  (iii) today's 1,000, flip about mid-May.
Dates assume the owner approves the analytics packet this week, the PC is back online by
Nov 1, slice 10 deploys about Nov 22 and the freeze is about Dec 1. Flip is roughly freeze
plus 40 days because stage 2's floor, not the lab, is the long pole.

## Round 2

🦀 **Ruth:** Anything that moves the replay key lands before the freeze or waits until after the flip, otherwise the 14 nights restart. So before: #1143 items 5 to 8, #1237, the #1298/#1343 hotspot fixes, A9 saves, facade export. After the flip, where a new key costs no gate: TDT in the crate, as a deliberate new key for the removal window. Grumbal, if the freeze holds, #1112 costs nothing until the flip. After it I want Rust first and TypeScript patched only for parity, with the conformance fixtures catching drift. Winston, I'd take slice 11 right after the soak, because the mirror host makes every Rust change touch a TS read model. Then the 360-test mapping, TDT, and src/engine last. Dana, 1,000 sessions at the removal gate is fine by me.

🕸️ **Theo:** Grumbal is right that slow is not a fault, and Tess is right that the ramp traces nothing, so I want two cheap things before the flip. First, rehearse the update on a real installed PWA: offline for a while, launch online, and the old shell must never pair with a newer engine package. The TS bundle stays precached, because offline fallback is the only fallback some players have. Second, policy.ts says a fault suppression sticks across builds until the player taps retry, so one real failure strands them on TypeScript through every fix, and Automatic with no usable storage already boots TypeScript, so private windows are not everyone. Say that in the packet. Safari, Firefox and a throttled mid-range phone each get a smoke run. Winston, slice 11 and the recovery-code removal can wait for 3.x.

🗂️ **Vera:** Dana, I'm with you on moving the TDT half. A7, the .TDT half of #1066 and TDT in the crate can wait for 3.x, because the TypeScript codec stays and .TDT import and export route through it. I want a test on that routing. What cannot wait is the loop: Rust writes, TypeScript loads and saves, Rust loads, diff empty. That covers #856/#858 in #1327, the #902 mid-booking round-trip and A9 (#1301). Winston, "saves both ways" is one line on your list. For me it is every fixture, byte for byte. EX-1 I'll accept as time lost, up to 30 seconds. EX-2 and EX-3 I accept only if the TypeScript reader takes both number forms and the Infinity literal. I stop the line if the fallback cannot open a Rust-written save, or a booking vanishes on rollback.

🧰 **Oona:** Two steps after the flip, delete last. 3.0.0 is Rust default, TypeScript still choosable, nothing more. Step one, after two releases on WASM with the fallback unused: TypeScript labeled legacy, Settings choice gone, fallback and src/engine kept, so undoing stays a deploy. Step two: delete the fallback, mirror host, src/engine and the 82 importing files together, gated on no divergence, 360 tests mapped, TDT in the crate, and the 1,000 sessions with the bound reported. Dana, moving the count out of the flip is fine, but two releases are no substitute for it. Winston, agreed: slice 11 and the inventory stay out of 3.0.0. Version: one major at the flip (#1107), a minor for step one. Ruth, convince me AC5 earns a second major. TypeScript stays choosable until the count closes, 70 to 141 days.

💻 **Tomasz:** The day the update lands, I get whatever Automatic picks. If that is today's host, 6.1 seconds per 720 steps against 0.69 on a large tower, with 2.7x the heap, I won't see a fault. I'll see fans, stutter, and a closed tab. Grumbal's right that slow isn't a fault, so fallback never fires. Tess, I'm your missing trace. Dana, 300 engaged sessions count people who stayed, and I'd have left. The ramp alone isn't enough. Automatic has to watch my frame times in the first minutes and, if they crawl, pick TypeScript, say so in plain words, and put a one-tap switch on screen where I can see it. Count those switches as failures in the ramp. And no flip on the mirror host.

## Checked by the facilitator

Theo's claim about src/engineCohort/policy.ts is right: a suppression with scope "fault" applies
on every later build until the player taps retry; only a "load" scope (package load failures)
expires with the build. Automatic with no usable storage boots TypeScript (rule 6). The plan
already prints, beside the gate's bound, an engagement rate and an early-exit rate by arm, so a
Rust arm that loses players early cannot look healthier by dropping them (plan 1.3.4); that is
the nearest existing stand-in for "slow is not a fault", and it is a report, not a guard.

## Facilitator's draft decision ledger (to be amended by the room)

D1  The 1,000 engaged-session count moves from "before the flip" to "before TypeScript is
    deleted (removal step two)". Field evidence before the flip is then one of: 180 (stage 1
    floor 30 + stage 2 floor 100 + the 50-session soak, bound 1.65%), 300 (1.0%), or 1,000
    (today).
D2  Sessions count as eligible at stage 2 and stage 3 on the facade host with no size gate (plan
    says stage 3 only); the observation tail is stage 2's 100 sessions on the frozen candidate.
    The size gate applies to the mirror host only and ends when slice 10 deploys.
D3  The 50% step stays as the 7-night, 50-session soak before 100%; 100% is the flip.
D4  One freeze about Dec 1 replaces F1/F2; replay, tail and RUN-3 run side by side.
D5  Slice 11 leaves the pre-flip path; it still waits for the soak. 3.0.x right after the soak
    (Ruth, Winston) or 3.x (Theo, Oona)?
D6  The .TDT half of #1066, A7 and TDT in the crate move to 3.x, with a pinned test that .TDT
    import and export route through the TypeScript codec (reverses OD-8 and D5 for that half).
D7  Unchanged and not tradable: slice 9 and 10, M1 to M8 with calibrated delta and epsilon, the
    14-night replay, conformance, dual run, the save loop in both directions on every fixture,
    forced-trap fallback spec, #985 offline cold start, rollback rehearsal, analytics (X1 or
    exception), no flip on the mirror host.
D8  "Slow is not a fault": a visible one-tap TypeScript switch and the early-exit rate by arm
    as a stop signal, or an automatic first-minutes frame-time guard (new behavior and new
    analytics, owner's call), or neither.
D9  Fault suppressions stranding players on TypeScript across fixing builds: leave for 3.0.0
    and report the stranded share, or expire them on a new build.
D10 Removal in two steps (legacy + Settings choice gone; then delete), gates reused from the
    retirement story plus the 1,000, versions per #1107 and #1112.
D11 New pre-flip evidence: installed-PWA update rehearsal, Safari, Firefox and a throttled
    mid-range phone smoke run.
D12 The owner's PC session has to come back online; it gates the size run, slice 9,
    calibration, RUN-1 and RUN-3.


## Round 3

Facilitator, to open: the ledger had twelve items and the owner skims. The room is asked to cut it to the decisions that are really his, answer the two open numbers (the field count and the calendar), and say what a player would see.

📋 **John:** Twelve is too many for a man skimming. First question nobody answered: what does 3.0.0 promise a player when the game looks identical? Nothing, I'd guess. The flip pays us, players carry the risk.

Blocking now: the PC restart and the analytics packet, due Oct 22, still not given. Default yes. Would a PC back after Nov 1 change it?

D1 to D4 are one decision, the count. Default 300, 1.0%, flip about Feb 13. Would he tell a Chromebook family 1.65% is fine?

D8 and D9 are one decision: the slow or stranded player. Default the visible switch, early-exit rate as stop signal. Unless slice 9 shows no crawl.

D5, D6, D10 are one: 3.0.0 is Rust default, nothing more. D7 and D11 are to-dos.

Anika, your 180 bounds faults, and slow is not a fault. Dana, 300 counts people who stayed. Winston, why is slice 11 in his packet?

📣 **Bea:** 3.0.0 promises one thing: the engine under your city changed, the game and your saves didn't. Changelog line: "New simulation engine, same game, same saves." No "faster" until hosted M1 to M8 passes. After the flip Settings reads Automatic (recommended), Rust engine, TypeScript engine (stable); "experimental" can't sit on the default. In the legacy step the label becomes "TypeScript engine (legacy)", a release before the choice leaves. Oona, no silent removal of the choice. Support macro: ask for Copy Diagnostics, read the engine line and fallback reason. Tomasz, yes to a visible one-tap switch, and when Automatic picks TypeScript or the fallback fires, one plain sentence saying so and why (a fault adds "up to 30 seconds of play may be lost"), but no hidden guard I can't explain. Nothing on removal dates or reliability numbers until the count closes.

😤 **Grumbal:** Concession: Winston, the 1,000 belongs at the removal gate. Now D1's 180. Stage 1 starts about Nov 1 to 5, slice 10 targets Nov 22, so those 30 sessions run on the mirror host, behind a size gate that hides the large towers (6.1 s against 0.69). They say nothing about the host we flip. The facade count is 150, so 1.65% is a bound on a build nobody ships: a smoke detector in a house with no stove. Anika, you count recovered fallbacks as faults, the bound assumes zero, and one fallback leaves D1 with no answer. Count facade sessions only, and write the allowed fault count before the freeze. Dana, Dec 1 needs slices 7 and 8, unstarted, and a PC offline since Oct 21. Slice 10 at its latest is 20 days after target, so Jan 9 becomes late January, my arithmetic.

📈 **Anika:** I'm moving to 300, Dana. If stage 1's 30 run on the mirror host, 180 pools two builds and bounds neither; the facade would have 150. 300 is about 42 days at 7.1 a day for a 1.0% bound, and the 1,000 stays at removal.

A failure is any fault event, recovered fallbacks included, any latch-off, any tap on the visible TypeScript switch, any automatic frame-time pick of TypeScript. Tomasz, those taps count. The denominator is engaged eligible Rust sessions on the facade, always printed beside assigned sessions, engaged share and early exits by arm, with a written early-exit threshold before the first read. Grumbal, only that rate sees your crawling Chromebook. One read, at 300; a failure voids the 1.0% claim.

Browser and device is a second condition: empty cells are named unbounded.

Changelog may say: zero failures in 300 sessions, under 1.0% at 95%, in these browsers. Nothing about speed, leavers or Safari.

⏱️ **Tess:** Dana, Jan 9 to 10 has no float, and the facade isn't why. Slices 7 to 10 hold nine days to a Dec 1 freeze, then slip day for day. The tight chain starts on the dead PC: size run, stage-1 GO Nov 1 to 5, plus 25 days, lands Nov 26 to 30, one to five days of float. PC back Nov 1, Jan 9 to 10 holds; Nov 8, about Jan 13 (my arithmetic). Calibration, 60 hours, is 30 to 40 nights at under 2 hours, done by Dec 18, before the plan's earliest stage 3, Dec 26. After the freeze, zero: any engine change restarts the 14 nights. Theo, a smoke run proves boot, not speed. Add determinism hashes in Firefox and WebKit, free, plus one CPU-throttled Chromium pass and a Firefox pass on the PC, about 3 hours (a guess), thresholds written first.

## Where the room ended

Twelve ledger items became four decisions for the owner, three to-dos and one action. The packet carries the recommendations; the owner decides.

| Ledger items | Became |
| --- | --- |
| D1, D2, D3, D4 (the count, where sessions count, the 50% soak, one freeze) | Decision 1: the field standard before the flip. 300 engaged facade sessions with zero failures, the 1,000 moves to the removal gate |
| D8, D9 (slow is not a fault, stranded players) | Decision 2: a visible one-tap TypeScript switch, taps counted as failures, early-exit rate as a stop signal, stranded share reported |
| D5, D6 (slice 11, the .TDT half) | Decision 3: what 3.0.0 is and what waits for 3.x. The room split 2 to 2 on slice 11's timing, and four voices moved the .TDT half, which reverses OD-8 and D5 for that half |
| D10 (removal in two steps) | Decision 4: how TypeScript leaves, versions per #1107 and #1112 |
| D7, D11 | To-dos: the unchanged lab gates, and the added installed-PWA rehearsal and cross-browser checks |
| D12 (the PC session) | Resolved: the PC session came back at 11:01 UTC (see the correction at the top) |

Open at the end of the sitting: slice 11 in 3.0.x (Ruth, Winston) or 3.x (Theo, Oona); whether an automatic frame-time guard is wanted (Tomasz yes, Bea not unless she can explain it); and whether any reliability number is announced before the 1,000 count closes (Anika allows the 300 statement, Bea does not).
