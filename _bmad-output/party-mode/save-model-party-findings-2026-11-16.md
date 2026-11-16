# Save, Auto-save and Open: party findings (2026-11-16)

Rooms: Web Game Room (Theo, Juno, Sally, Samus, Wren, Tess, Grumbal,
Boundary) with Priya, Femi and Tomasz from the Player Panel. Asked by
Naftali on 2026-11-16 after opening a tower cost him "Harmony Tower 2.0":
"I feel like the save should save to the file I am working on, and not an
autosave per se", and "same for auto-save. Should just save to my current
file. No? Unless that is icky? Or keep n versions of the current file? What
do other games do?"

## What the room checked first

- **Why the tower vanished.** Every tower swap (File > Open…, New…, a
  dropped or picked file, a 1994 import, opening the Auto-save row) ends in
  `towerSwapped` (`src/game/appBoot.ts`), which autosaves the tower that just
  arrived at once (#1422, so a crash in the next 30 seconds reloads the new
  tower). There is one Auto-save, so that write replaces the tower before it.
  A tower that was never saved into My Towers lived only there, and is gone.
  A tower that had a file lost everything since its last Save. The 1994 import
  report and its adoption code promised "your current tower is kept in its
  autosave": the flush ran, then the swap's autosave overwrote it.
- **The title screen too.** At boot the engine holds a throwaway tower and the
  Auto-save holds the player's tower. Opening a file from the title screen
  overwrote it the same way.
- **The live tower's file is page memory only** (`src/game/currentFile.ts`),
  so after a reload the game no longer knows which file the Auto-save tower
  came from.

## What other games do

Two models, both common:

- **The document is the save.** Google Docs and the Mac's own apps save into
  the document itself and keep its history. Stardew Valley saves the farm's
  own file each night and keeps one `_old` backup.
- **Rolling autosaves beside the player's saves.** Factorio keeps
  `_autosave1`, `_autosave2`, … and overwrites the oldest (3 to 5 slots by
  default). RimWorld rotates `Autosave-1` to `Autosave-5`. Cities: Skylines II
  lets the player pick how many autosaves to keep (1, 3, 10, 50, 100 or
  unlimited). In all of them a manual save goes to its own named file.

Sources: [Factorio settings](https://wiki.factorio.com/Settings),
[Factorio autosaves](https://nodecraft.com/support/games/factorio/factorio-autosaves-and-rolling-back-to-an-autosave),
[RimWorld save file](https://rimworldwiki.com/wiki/Save_file),
[Cities: Skylines II autosave](https://www.gameskinny.com/tips/cities-skylines-2-how-to-enable-auto-saves/).

## The conversation (condensed)

🎨 **Sally:** He said it himself: "the file I am working on". Players think in
towers, not in a slot called Auto-save. The Auto-save row in Open is the game
showing its plumbing.

😤 **Grumbal:** And the day autosave writes my file, my "before the big fire"
copy gets the fire. Word asks "Save changes?" for a reason.

🎲 **Samus:** Word asks because Word doesn't autosave every 30 seconds. A
city builder that asks "save changes?" every time you open a tower trains
you to click No, and No is how you lose a tower.

🌐 **Priya:** I play on my lunch break and close the tab. I never press Save.
Whatever I was building must be there tomorrow, under its name.

🏢 **Tomasz:** Factorio's five rolling autosaves saved my base twice. Give me
"go back an hour" and I don't care where the file lives.

😤 **Grumbal:** Fine, if there are versions. Rolling versions per tower, not
one global slot. And a snapshot I make with Save As… stays a snapshot.

🕸️ **Theo:** Save As… already does that, the Windows way: the tower moves to
the new file and the old file stays as it was.

⏱️ **Tess:** Versions cost room. A maxed tower stores at about 80 KB. Five
versions is 400 KB a tower, and a version is the same packed bytes Save
already writes, so no new format and nothing slower in the 30-second save.

🌶️ **Boundary:** Linked folder. Writing a PC file every 30 seconds churns
OneDrive and Dropbox, and the browser's OK can lapse mid-session.

🕸️ **Theo:** Then a linked tower autosaves into its PC file on the mirror's
one-minute beat while the OK holds, and the browser always keeps a copy, so
nothing depends on the OK. Versions stay in the browser, never in his folder.

♿ **Wren:** No new question in the Open path. A blocking box only when the
game could not keep the tower, and Cancel is the default there.

🎒 **Femi:** And the "Name (2)" rule when a new tower's name is taken. I have
four towers called "Tower".

😤 **Grumbal:** Last thing. Ship the no-loss guard today. The redesign is a
storage change, and NO LOST SAVES says that waits for its proof.

## Verdict

1. **Today, as a patch (4.8.1 if it lands in time): never lose the outgoing
   tower.** Right before any swap the game captures the tower being left (the
   live tower, or, behind the title screen, the tower in the Auto-save). Once
   the new tower is in, it keeps that capture: in the tower's own My Towers
   file when it has one (what File > Save already writes), otherwise as a new
   My Towers file under the tower's name, with the "Name (2)" rule. The
   linked-folder file is never written behind the player's back; a tower from
   the linked folder is kept in My Towers instead. If My Towers can't take it
   (full, or a private window), a message box offers the download. The
   1994 import report stops promising the Auto-save and says where the tower
   goes. Analytics: `app_action` `tower_kept`.
2. **Next, as a minor: the tower is the document.** Every tower has a My
   Towers file from founding (named after the tower, "Name (2)" on a clash).
   File > Save and the 30-second autosave both write it. The Auto-save row
   leaves the Open window, and Continue opens the last tower played. The old
   Auto-save key stays as the internal crash copy.
3. **Versions are the safety net.** Each tower keeps its last 5 versions,
   at least 10 minutes apart, plus the last one saved by hand, in the
   browser only. Right-click > **Previous versions…** opens one as a new file.
4. **Linked folder:** File > Save writes the PC file. The autosave writes it
   on the one-minute beat while the browser's OK holds, and the browser keeps
   a copy too.
5. **No "Save changes?" box.** Nothing is ever more than a few seconds
   unsaved; the outgoing tower is written before every swap.
6. **The name is always the tower's** (Naftali, 2026-11-16: "shouldn't the
   auto-save tell you the name of the tower it is autosaving?"). The Open
   window's row already reads "Auto-save (Harmony Tower 2.0)"; with item 2
   the row goes and the tower's own file carries its name. The linked
   folder's copy, called plain "Auto-save" today, becomes the tower's own
   file there too, under the tower's name ("Name (2)" on a clash), so a
   folder of copies reads as a list of towers.
7. Item 2 to 4 and 6 change storage layout, so they ship only with the NO LOST
   SAVES proof: real 4.x storage (Auto-save, My Towers, linked folder) opens
   to the identical game before and after.
