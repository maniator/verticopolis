# Keyboard and modifier keys: Verticopolis vs the original

Written 2026-11-04 at app 2.84.1. This compares every key the web app binds
with what the original PC game (SimTower for Windows) documents. The evidence
for the original is the project's SimTower reference library, kept with the
project files rather than in this repo: its evidence table and manual research
notes summarize the official manual, the Windows Help file and the Windows
Read Me, plus several fan guides for the PC version. No key behavior of the
original has been observed in the PC harness (`tools/simtower/`) yet, so where
only the PC can settle a question, the table says so instead of guessing.
"None documented" means the evidence is silent, which is weaker than saying the
original has no such key.

## What the original documents

The original is a mouse game. Its documented keys are modifiers held while
clicking, plus menu shortcuts whose keys our evidence does not record:

- **Shift-click replace.** With a facility tool selected, holding Shift and
  clicking an existing facility replaces it with the new one, with no separate
  bulldoze step (manual, The Tool Bar; Windows Help, Bulldozer).
- **Tall lobbies.** Holding Ctrl while placing a lobby builds a 2-story lobby;
  Ctrl+Shift builds a 3-story one. The Read Me ties this to the first lobby
  placement and the fan guides to the ground lobby, while the owner has seen
  tall sky lobbies in a real tower. The owner's rule to confirm on the PC is
  one height per floor, set by that floor's first lobby placement (#308).
- **Menu shortcuts.** Each menu command shows a keyboard equivalent beside it
  (manual, Menus). Which keys they are is not in our evidence.
- **No undo.** The Edit menu does nothing in the game (manual, Edit Menu).
- **Speed.** Pause is a Tool Bar button and Fast Mode is an on/off command in
  the Options menu; there are no speed levels.

## Key by key

| Key | Verticopolis | Original (PC) | Verdict |
| --- | --- | --- | --- |
| Shift + click with a build tool | Shift + drag pans the view, Shift + wheel zooms; nothing is built | Replaces the clicked facility with the selected one | Mismatch, #1793. The replace rules need the PC harness. |
| Ctrl + click, placing a lobby | A normal 1-story lobby | A 2-story lobby | Mismatch, #308 (multi-story lobbies are not built yet) |
| Ctrl+Shift + click, placing a lobby | Shift makes the press a pan, so nothing is built | A 3-story lobby | Mismatch, #308; the chord also clashes with our Shift pan key, the same clash as #1793 |
| Menu shortcuts (File, Options, Windows) | None bound: saving is in the Saves dialog and autosave | Present, keys not recorded | Unknown until a PC check, #1793 |
| Ctrl/Cmd+Z; Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y | Undo; redo | None (the Edit menu does nothing) | Ours only, a modern addition |
| 0 to 3 | Game speed (0 pauses) | Pause is a button and Fast Mode a menu command; a menu shortcut may drive Fast Mode | Unknown until a PC check, #1793 |
| Arrows or W A S D (Shift moves 10) | Move the keyboard build cursor | None documented; whether arrows scroll the view needs the PC | Ours only as documented (keyboard play); scroll keys need the PC, #1793 |
| Enter | At the keyboard cursor: build with a build tool, inspect with Inspect, bulldoze with Bulldoze. The first press only shows the cursor. Acts on the press, once per hold | None documented | Ours only (keyboard play) |
| Space | The same as Enter, but on the release, and only for a tap: a hold with a pointer press, or a wheel turn over the world that the camera reads as a zoom, does nothing at the keyboard cursor. A cursor key pressed (or still held) before Space comes up builds the tap first | None documented | Ours only (keyboard play) |
| Delete, Backspace, X | Bulldoze at the keyboard cursor, once per hold | None documented (the Bulldozer is a Tool Bar tool) | Ours only |
| + or =, - or _ | Zoom in, zoom out | None documented, and the evidence describes no zoom | Ours only |
| C | Scroll to the keyboard cursor, or center the tower when the cursor is hidden | None documented | Ours only |
| Esc | Cancel a pending shaft anchor; close an open dialog | None documented; needs the PC | Unknown until a PC check, #1793 |
| Space held, then a drag (any tool) | Pan the view. The pan key is read when the button goes down, so a drag already under way keeps its tool. A Space chord or a Space typed into a field does not pan | None documented | Ours only |
| Map window: arrows (Shift for a whole screen), Home, End, Esc | Move the view, jump to the top or bottom, close | Its view box can be dragged or clicked; no keys documented | Ours only as documented |
| Title screen: Esc | Continue the saved tower, when there is one and no dialog is open | Unknown | Unknown until a PC check, #1793 |
| Elevator schedule: Up and Down on an hour; Left and Right; Shift + click on an hour | Add or remove a car for that hour; move to the next hour; select a range of hours | None documented | Ours only (accessibility) |
| Tab, Enter and Space on controls | Standard web focus and activation | None documented | Ours only (accessibility) |

Not keys, for completeness: we inspect with a right-click, and a middle-button
drag pans. One PC guide says the original uses only the left button (the
Magnifying Glass tool does the inspecting there), but the same guide later
describes a right-click menu, so this needs the PC too (#1793).

## Fixed during this audit

Space was both the keyboard-play build key and the pan key held through a mouse
drag, and a Space-drag with a build tool built rooms. With focus on the page,
the held key's repeats built at the keyboard cursor; with focus on the palette
item just picked, the item kept Space from the pan, so the drag painted the
tool instead. Its release also clicked a toolbar button left focused by a
mouse click.

Space now builds on release, and only for a tap. A pointer down at any moment
of the hold (pressed before Space or during it) or a wheel turn over the
world that the camera reads as a zoom makes it a pan hold, which does nothing
at the keyboard cursor; its release is canceled so it clicks no focused button
and toggles no focused checkbox or radio, except under a cover where nothing
pans (a dialog, the splash, the crash card or the engine-failure card). A
cover that comes up or takes focus mid-press, such as an emergency choice or
one dialog swapped for another, does not have its controls pressed by the
repeats or the release of a Space it did not get the press of, even when the
hold ended before the release. A Space the page first
sees as repeats (one held while focus came back) is treated the same way
under a cover that is already up. Any other key held since before a cover
came up does not reach the cover with its repeats either, so a held Enter
does not press its button. Where Space types (a focused text field, text
area, dropdown or contentEditable region), and for a Space pressed with Ctrl,
Cmd or Alt, the game follows no hold: it neither builds nor pans, since the
camera reads the game's hold as its pan key. Cmd's release ends the hold,
since macOS sends no Space release while Cmd is down. So do a native context
menu, a native drag of selected text or a link, and a press or a key (Alt +
Down or F4, or an arrow or Enter on a Mac) that can open a dropdown's popup,
since each can take the release. Space may still be down after any
of these, so its late release is canceled when the hold was a pan, or when a
pointer press or a zooming wheel turn since would have made it one. A
drag pans when Space went down first; a drag already under way when Space
goes down keeps its tool. The camera gets each press at its next frame, so
it reads the hold as it was when the button went down. A wheel turn counts
only when the camera reads it as a zoom: a sideways trackpad swipe without
Shift zooms nothing (in browsers that report the legacy `wheelDelta` it used
to zoom in or out, by swipe direction) and leaves the tap, while a
trackpad's momentum scroll over the world right after a flick can still drop
one tap. A cursor key pressed before Space comes up, or one held since
before it, builds the tap first, where Space went down; Shift, the lock keys
and Fn leave the tap alone, and any other key (Ctrl, Cmd and Alt included)
drops it. The palette lets Space through and, like a native button, acts on
the release. A held Enter, Delete, Backspace or X acts once.
See `e2e/spacePan.spec.ts`, `src/game/inputKeys.test.ts`,
`src/game/inputKeysSpace.test.ts`, `src/game/inputKeysSpaceHold.test.ts`,
`src/game/inputKeysPointers.test.ts`, `src/game/engineWiring.test.ts`,
`src/render/excalibur/towerInputCameraInput.test.ts` and
`src/ui/uiPalette.test.ts`.
