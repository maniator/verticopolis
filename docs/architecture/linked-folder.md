# The linked folder

The Open and Save As windows can show a folder on the player's own computer
beside My Towers (owner, 2026-11-15). The design study, with mockups for each
browser and installed app, is in the project's shared files
(`local-folder-design/`); this page records what shipped and why.

## Where it works

It uses the browser's File System Access API (`showDirectoryPicker`), which
only Chromium browsers have: Chrome, Edge and Opera on desktop, Chrome on
Android from 132, and Samsung Internet from 29. Safari (macOS and iOS, so
every iOS browser) and Firefox do not have it. `canLinkFolder()` checks for the
API, a secure page and the top window, never the browser's name.

Where it is missing, the Open window offers **From a folder…** instead: an
`<input webkitdirectory>` that copies the picked folder's towers into My
Towers once (Safari 11.1+, Firefox 50+, iOS 18.4+).

## How it behaves

- My Towers stays the default and always holds the Auto-save. The linked
  folder is a second place in the Look in / Save in box; one folder at a time.
- The game lists `.vctower` and `.TDT` files at the folder's top level, opens
  them through the same importers as My Towers, and writes `.vctower` files
  there. It never deletes or renames a file there (owner: "don't let deleting
  PC files"). Duplicate writes a new "Copy of …" file and never replaces one.
- Saving asks before replacing a file, and checks the disk as well as its list
  so a file another program wrote is not replaced without asking. The browser
  writes to a scratch file and swaps it in on close, so a failed write leaves
  the old file intact. That guarantee covers replacing a file, not creating
  one: Chromium makes a new file empty before the bytes go in, so a save under
  a new name that fails can leave an empty `.vctower` behind (#2337). The game
  does not delete it. Instead an empty file is a free name: Save As and the
  Auto-save copy write over a file that is empty on disk at that moment
  without asking (nothing in it can be lost), and opening one says plainly
  that it holds no tower. A file that has bytes again is asked about as usual.
  Saves that pick a name (Save As and the Auto-save copy) hold one Web Lock
  shared by every tab (`verticopolis-linked-folder-save`), so a second tab
  can't take a file the first is still writing, which is empty until its
  write closes, for a free one.
- A tower opened from the folder, or saved there, is the live tower's file:
  File > Save writes it back over that very file by its name on disk, and Save
  As starts in the folder. Linking a different folder forgets it, so Save
  never writes over a file of the same name in the new folder.
- A file that can't be read while the folder is listed (removed meanwhile, or
  held by another program such as a cloud drive syncing it) is left out of the
  list; the rest of the folder still works, and the link is kept.

## The Auto-save copy

The player may keep a copy of the Auto-save in the folder too (owner,
2026-11-15, the follow-up to #2335): **Keep the Auto-save here too**, a check
item in the Look in box while a folder is linked. It is off by default and
kept in localStorage (`verticopolis-autosave-mirror`).

- The Auto-save in the browser stays the one the game loads. The copy is only
  written, never read back on its own; the player opens it from the folder
  like any tower.
- After a timer autosave (`startAutosave`'s `afterTick`), the game writes the
  live tower as a binary `.vctower` (`VCTOWER2`, a newline, then the raw
  DEFLATE of the stamped save), at most once a minute. It costs nothing while
  the copy is off. While on, it asks the engine for the same stamped bytes the
  autosave stores (`saveBytes`, about 2 ms on the split-tower-4 fixture) and
  packs them in the save packer's worker, so no compression runs on the frame.
  The engine's own file export compresses on the main thread (median 19 ms on
  split-tower-4, 10 ms on the large fixture), which is why the copy does not
  use it.
- It writes only while the folder is open this visit with the browser's OK.
  It never asks the browser and never reads the handle back on its own (see
  Permission below), so after a restart it starts again once Open or Save As
  shows the folder.
- Its first write in a folder takes `Auto-save.vctower`, or `Auto-save (2)`
  and up when the list or the disk has that name (`linkedFolder.saveNew`), so
  it never replaces a file it didn't write. It then writes that same file
  (`saveOver`), remembered beside the setting by the link's id
  (`linkedFolder.linkId`, made new by every link and held per page). Each
  link keeps its own file, so two tabs on two folders each write theirs, and
  a file remembered for another link is never written over, even when the new
  folder has a file of that name. The files of the last eight links are kept;
  linking again or unlinking drops the old link's. A copy whose folder was
  unlinked or linked again while it packed is dropped. Unlinking also turns
  the copy off. Turning it
  off leaves the file in the folder.
- A failed write says nothing on screen (the in-browser Auto-save worked or
  told the player itself) and tries again a minute later; it is counted once a
  page life.

## Permission

The folder's handle is kept in its own IndexedDB database
(`verticopolis-linked-folder`), and its name in localStorage
(`verticopolis-linked-folder`). After a restart the browser may want the
player's OK again; it only asks after a click, so the list shows **Allow
access…**. Chrome's prompt then offers "Allow on every visit".

The handle is read back from IndexedDB only when a window shows the folder,
never at the game's start. Reading a folder handle back has crashed whole
Chromium browsers (Opera's reports, and a private-window profile in our tests,
2026-11-15). Done lazily, a crash could only follow a player's own click on
the folder, never every visit; until then the windows name the folder from
its mark in localStorage.

## Analytics

`app_action` `folder_link`, `folder_allow`, `folder_unlink`, `folder_open`,
`folder_save`, `folder_copy`, `folder_failed`, `folder_mirror`, and `file_add` `folder` for
From a folder…. See `docs/analytics-data-map.md`.
