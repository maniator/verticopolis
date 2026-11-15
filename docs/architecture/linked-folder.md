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
  a new name that fails can leave an empty `.vctower` behind (backlog
  `linked-folder-empty-file-on-failed-new-save`, #2337).
- A tower opened from the folder, or saved there, is the live tower's file:
  File > Save writes it back over that very file by its name on disk, and Save
  As starts in the folder. Linking a different folder forgets it, so Save
  never writes over a file of the same name in the new folder.
- A file that can't be read while the folder is listed (removed meanwhile, or
  held by another program such as a cloud drive syncing it) is left out of the
  list; the rest of the folder still works, and the link is kept.

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
`folder_save`, `folder_copy`, `folder_failed`, and `file_add` `folder` for
From a folder…. See `docs/analytics-data-map.md`.
