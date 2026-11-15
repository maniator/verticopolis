# Install budget: party findings, 2026-11-15

Room: Web Game Room (bmad-party-mode, session mode).
Question from Naftali: the Metro jam fix (#2272) takes the first-install
precache to 4,617 KiB, 9 KiB over the 4.5 MiB budget in
`scripts/verify-precache.ts` (the screen saver used the last headroom).
He asked whether to raise it to 10 MB ("this is a game, no?").

Facts on the table: the precache is 25 files, 4,617 KiB raw and about
1,466 KiB gzipped. The engine `.wasm` is 2,811 KiB raw (858 KiB gzipped), and
about 440 KiB of that is its name section (`debug = 1`). Every deploy that
touches the engine downloads a new `.wasm` for every installed player.

## The round

🎲 **Samus:** It's a game. Steam games are gigabytes. Ten megabytes and we
stop arguing about kilobytes every release.

🌐 **Priya:** My browser fetches it once and keeps it. Ten is fine by me.

⏱️ **Tess:** A budget nobody can hit is a comment, not a check. The whole
point is that crossing it makes someone stop and say why, like the tall
lobbies did at 4 MiB. Ten means it never fires again. Pre-register the next
step: 6 MiB raw.

🕸️ **Theo:** The raw number isn't what crosses the wire. 4.6 MiB raw is
1.4 MiB gzipped. Ten raw would be about 3 MiB on the wire, which is still
fine on broadband, but the budget is the only thing that notices growth.
6 MiB keeps it noticing.

🤖 **Lucia:** It isn't one download. We ship several engine releases a day
some weeks, and each one is a new 850 KiB wasm on my bus data. Growth costs
me on every update, so I want the tripwire close.

💻 **Tomasz:** A bigger wasm compiles slower on my laptop at every cold
start. Naftali's own rule is nothing slower. Raise it, but not so far that
nobody looks.

😤 **Grumbal:** You're about to raise a budget while shipping 440 KiB of
function names to every phone. Strip the name section and you're back under
4 MiB today. Raise nothing.

🌶️ **Boundary:** Strip the names and every engine error in the console and
in the error reports reads `wasm-function[8812]`. That's a debugging trade
the owner makes on its own, not a side effect of a jam fix.

📐 **Juno:** Agreed with Boundary. Two different decisions. Today's is the
number.

🎒 **Femi:** School filters block domains, not megabytes. Either number
works for me; I'd still rather it stayed small.

📱 **Ben:** iPad storage won't notice 10. I'm with Samus.

🎨 **Sally:** Players feel the first load, not the budget file. 6 keeps the
first visit quick and leaves room for 4.x.

♿ **Wren** and 🌍 **Lior:** Not our fight; sat it out.

## Vote

- **6 MiB raw:** Tess, Theo, Lucia, Tomasz, Juno, Sally, Boundary, Femi (8)
- **10 MB:** Samus, Priya, Ben (3)
- **Keep 4.5 MiB and strip the wasm name section:** Grumbal (1)
- **Abstained:** Wren, Lior (2)

## Verdict

Raise the precache budget to **6 MiB raw**, recorded beside
`PRECACHE_BUDGET_BYTES` with this reason, in #2272. That leaves about
1.4 MiB of headroom (roughly a year of growth at the rate since the 4 MiB
raise) while keeping the check meaningful. Stripping the engine's name
section is a separate call for the owner (it saves about 440 KiB but loses
function names in error reports), not part of this change.
