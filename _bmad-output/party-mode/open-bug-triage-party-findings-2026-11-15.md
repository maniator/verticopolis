# Open bug triage: party round (2026-11-15)

Room: Web Game Room (Theo, Juno, Sally, Samus, Wren, Tess, Priya, Lucia, Ben, Grumbal, Boundary), with Kenji summoned from the Engine Room for the engine rows. Session mode. Input: the thread's triage of the 21 open `bug` issues, checked against main at 1bdb1cd.

## The round

🕸️ **Theo:** Start with #1021, it's the easy one. The dual-run mirror is gone, the TypeScript engine is gone. What's left is "the binding coerces `"3"` into 3". That's an npm-package API nicety, and the registry publish is on hold anyway.

😤 **Grumbal:** Close it. A bug about two engines disagreeing, with one engine. Next.

⏱️ **Tess:** #803 I'll take. You can't keep a bug open you can't measure. The lab is gone, the compositor flags from the good arm ship in `scripts/screenshots.ts`, and the drift check is a hard gate now. That gate *is* the detector. Close, reopen on the first flake.

🌶️ **Boundary:** Agreed on both. Now #336, and I'm not with the thread. A limo every five game days on a tower that keeps failing...

🎲 **Samus:** ...is the game telling you the truth. The VIP really came, really looked, and really left unimpressed. The limo *is* the feedback. Throttling it means a real inspection happens with no visual.

🎨 **Sally:** Then the limo needs to *read* as a failure. Right now the same 6.5 seconds plays for a pass and a fail. A player sees the limo and thinks they won.

🌐 **Priya:** I did think that, once. The bulletin said "unimpressed" a second later, so I worked it out.

😤 **Grumbal:** So it's working. "Make the limo sad" is a feature request wearing a bug costume. Close the bug. If Sally wants a sad limo, that's a 4.x idea.

🎨 **Sally:** Fine. Close #336 as working as intended. But I'm saying it again when we do event polish.

🕸️ **Theo:** #337, the thief off-screen. Fires and bombs happen wherever they happen too. Nobody files "the fire was on floor 80 and I was looking at floor 3."

♿ **Wren:** As long as the bulletin line is there, I'm fine. A screen-reader player never sees any of the cosmetics anyway, so the text has to carry it. It does.

🎲 **Samus:** Close. A camera nudge to chase a cosmetic would be worse than missing it.

📐 **Juno:** #832 and #1061. #1061 is the dev sprite gallery, and the test already caps shrunk cells at 4. #832 asks to widen a test so it can see the daycare kids at widths we don't ship.

😤 **Grumbal:** #832 is a test that can't see two kinds of occupant. That's a test lying by omission. I'd keep it.

⏱️ **Tess:** It renders real sprites, so it's a behavior test, not config. But the miss only shows below 120px, and no daycare ships that narrow. Spending a PR on coverage of an impossible width is the kind of test the owner told us to stop writing.

😤 **Grumbal:** ...Fine. Close both. Coverage of a world that can't exist.

📐 **Juno:** #1063, the art fixes. Every one is 1 to 3 pixels and fixes something visibly wrong: a car painted over a stall line, hangers off center, a tail lamp outside its car body. I'd approve all ten in one PR.

🎲 **Samus:** All ten. The owner approves art, but this is restoring the intended art, not new art.

😤 **Grumbal:** One PR, one gallery refresh, rendered in the pinned image. Don't make me look at five refreshes.

🌶️ **Boundary:** Now the fix order. The thread's list leads with #669, the schedule dirty flag. I traced it: the "silently discards re-homed cars" half is gone. The engine snaps the stored homes when you toggle a stop (`snap_homes_to_stops` in `tower/transports.rs`), so there's nothing to discard. Only the false "unsaved changes" warning is left.

🎨 **Sally:** That still annoys people, but it isn't data loss anymore. Drop it down the list.

🎲 **Samus:** Then #358 goes first. That one moves a *star*. A Modern tower near the recycling edge can gain and lose the gate at the lunch peak and re-arm "Garbage is piling up" every day. That's gameplay, not polish.

🔧 **Kenji:** In Classic it's already fixed: shops, restaurants, cinemas and party halls count yesterday's visitors (`census_follows_the_day`). The Modern venues (nightclub, sky bar, spa and so on) still count live customers. The fix is to give those venues the steady count too. It's an engine change: no save change, and nothing on the hot path, because the census sum already walks those rooms.

📱 **Ben:** #554 next. On iPhone the first tap after load is silent every time. It's the first thing a new player hears, or doesn't.

🤖 **Lucia:** Same on Android. It feels broken in the first five seconds.

♿ **Wren:** #888 after that. A dialog that jumps 6px under your cursor right after you click means your next click can land on the wrong button. That's a misclick generator, and it's worse with magnifiers.

🔧 **Kenji:** #550 next. It teaches the wrong lesson: the tenant leaves and the game blames the rent you already fixed. Fold #663 into the same PR. It's the same diagnostics area, it's two lines, and that way it's one crate patch instead of two.

😤 **Grumbal:** Or close #663. It's a branch nobody can reach.

🔧 **Kenji:** It's a branch nobody can reach *until someone reorders `dominant_gripe`*. Two lines, riding along with #550. Done.

😤 **Grumbal:** Ride-along, fine. Not its own PR.

🎨 **Sally:** #672 and #671 together, same CSS. Add a phone-width capture with the warning showing.

⏱️ **Tess:** #477 and #474 are the Modern schedule readouts. Counting venue riders adds one map increment per boarding. I want the commute stress bench run before and after anyway, because the owner's rule is nothing slower.

📐 **Juno:** #1069 and #334 are cosmetic. #334: check whether anything is even drawn past the lot edge before writing code. If the camera never shows it, close it.

😤 **Grumbal:** And #931 and #797 are tooling that protects the gallery. Do them last, but do them. A cascade of bad shots after one failure is how a wrong PNG gets committed.

## Where the room landed

**Close (6):** #1021 (obsolete, TS engine and mirror deleted #1875), #803 (unmeasurable without the lab; the flags ship and the drift gate is the detector; reopen on a flake), #336 (works as intended: each limo is a real re-inspection; a "sad limo" is a later polish idea), #337 (works as intended, like fires; the bulletin carries it), #832 and #1061 (test and dev-gallery coverage of widths that never ship). Grumbal held out on #832 and gave way.

**#1063:** approve all ten pixel fixes in one PR with one pinned-image gallery refresh.

**Fix order:**
1. #358 Modern venue census flap on the recycling star (engine, no save change)
2. #554 first sound effect silent
3. #888 schedule dialog jumps under the cursor
4. #550 wrong cause blamed when a tenant leaves, with #663 riding along (one crate patch)
5. #1063 art fixes
6. #669 false "unsaved changes" (the data-loss half is already gone: the engine snaps homes on stop toggles)
7. #672 + #671 dialog footer (with a phone capture)
8. #477 + #474 Modern schedule readouts (bench before and after)
9. #1069 seat pattern; #334 verify first, close if nothing draws past the lot
10. #931 + #797 screenshot tooling

**Unsettled:** Sally wants a pass-or-fail look for the VIP limo at event polish time. Grumbal still thinks #832 is a lying test.
