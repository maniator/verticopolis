---
title: Verticopolis — Title-screen Load Tower behavior
status: final
updated: 2026-07-28
scope: title screen (splash) actions + the load-only tower picker
design: ./DESIGN.md
sources:
  - _bmad-output/party-mode/memories/installed/.memlog.md (roundtable 2026-07-28)
  - ./.decision-log.md
---

> Visual identity for this concern is `./DESIGN.md`; tokens are referenced by
> name as `{path.to.token}`. On conflict with any mock, both spines win.

# Foundation

One surface, three form factors: desktop browser, mobile browser, and the
installed PWA / Android TWA (which is the mobile browser with no browser chrome
and a home-screen entry point). There is no console or gamepad tier.

Input modalities are pointer, touch, and keyboard. Keyboard is not an
afterthought here: the title screen runs a focus trap, so every control on it
has to be reachable and every stacked dialog has to hand focus back.

The UI system is lit-html templates rendered into plain DOM, with imperative
controllers owning mount, focus, and dismissal. The splash is a full-screen
`<div id="splash">` with `role="dialog"` and `aria-modal="true"`; dialogs
stacked over it are the shared retro `<dialog id="modal">`.

**The load-bearing fact of this whole design:** while the title screen is up, the
live simulation is not necessarily the player's tower. On a first run, or after a
corrupt autosave, it is a throwaway boot sim that exists only so the app has
something to render. A standing invariant follows, stated in `saveLoad.ts` and
enforced by the autosave timer's `#splash` check: **nothing mutates the
simulation while the title screen is up.**

# Information Architecture

The title screen carries two clusters.

**Game actions**, centered, in this order:

| Order | Action | Shown when | Plate |
| --- | --- | --- | --- |
| 1 | ▶ Continue | A readable autosave exists | Amber |
| 2 | ▤ Load Tower | Always | Default |
| 3 | ＋ New Tower | Always | Amber only when Continue is absent |
| 4 | ？ How to Play | Always | Ghost |

**Utilities**, pinned top-right and last in reading order: install (when
offered), then mute.

New Tower sits after Load Tower because it is the only action that can cost the
player something, and the safe dismiss paths (Esc, backdrop) already resolve
toward Continue. Distance from the default focus is the protection.

Load Tower opens exactly one surface, the **tower picker**, whose contents are:

1. One row per device slot: the autosave, then slots 1 to 3.
2. A **Load from a file...** row, always present, always last.
3. A Back control returning to the title screen unchanged.

There is no second destination and no branch. The player chooses a tower; where
that tower is stored is not a question they are asked.

## What is deliberately absent

The picker has **no Save, no Delete, and no Export**, which is what separates it
from the in-game Saved Towers manager it resembles.

This is a correctness rule. On the title screen the live sim may be the throwaway
boot sim, so a Save would write an empty tower into a real slot, stamped with a
genuine timestamp, and it would *succeed*: `saveToSlot` reads `viewState()` from
an engine that is paused but alive, so nothing throws and nothing warns. Export
would hand the player a `.vctower` of a tower they never built. Delete would sit
one tap from Load on a phone.

The in-game manager keeps all three. It is reached from a running game, where the
live sim is by definition the player's tower.

# Voice and Tone

Plain, specific, and never falsely reassuring. American English, no em-dashes.

| Situation | Copy |
| --- | --- |
| The action | `▤ Load Tower` |
| Picker heading | `Load a Tower` |
| File row | `Load from a file...` |
| File row detail | `A .vctower export, or an original SimTower .TDT save.` |
| Empty slot | `empty` |
| Unreadable slot | `Couldn't be read by this version.` |
| Nothing on device | `No towers saved on this device.` |
| Load succeeded | `Welcome back. Press ▶ to resume.` |
| Load failed | `That slot is empty or corrupt.` |
| File unreadable | Existing importer copy, unchanged |

Two words are load-bearing. The action says **Tower**, not Save, because the
product says tower everywhere and a save is a file format. The unreadable row
says **this version**, not "corrupt", because a save written by a newer build is
unreadable here and recoverable later, which is exactly why `preserveUnreadable`
keeps the bytes.

# Component Patterns

## Splash action plate

A button in the splash focus trap. Behavior on activation is defined per action
below; no plate has hover-only affordance or a state the glyph alone carries.

## Tower picker row

Three variants, distinguished by what the row can do:

| Variant | Condition (raw presence, `hasSlot`) | Content | Action |
| --- | --- | --- | --- |
| Loadable | Present and parses | Name, rule-set chip, star, population, funds, day, saved-at | Load |
| Unreadable | Present, does not parse | Name plus the unreadable line | None |
| Empty | Absent | Name plus `empty` | None |

Presence is the raw `hasSlot` check, never the parse-based `listSlots().exists`.
An unreadable slot is shown and labeled, not hidden: hiding it tells the player
their tower is gone when it may yet be recoverable, and it removes the strongest
cue for the file row underneath.

An unreadable row carries **no control at all**, not a disabled one. A disabled
button invites a tap that can never work.

## File row

Always present, always last, in every state including the empty one. Its action
opens the OS file picker through the existing importer, which already accepts
`.vctower` and original 1994 `.TDT` saves and sniffs header magic so a renamed
file still routes correctly.

# State Patterns

The picker has three states, and the button that opens it has one behavior in all
three. A control that goes somewhere different on different days is a control
nobody trusts.

| State | Condition | Body |
| --- | --- | --- |
| Populated | At least one slot present | Slot rows, then the file row |
| Empty | No slot present | `No towers saved on this device.`, then the file row |
| All unreadable | Slots present, none parse | Unreadable rows, then the file row |

The empty state does not render four rows reading "empty". On a phone that is a
wall of nothing where one honest line does the job.

The **all unreadable** state is the one worth designing for rather than
tolerating: it is the player whose storage went bad, and the file row is their
recovery path. It must never be reached by scrolling past dead rows.

# Interaction Primitives

## The dismissal invariant

**The title screen is dismissed by a tower arriving, never by a dialog opening.**

| Event | Title screen |
| --- | --- |
| Picker opens | Stays, engine stays paused |
| Back, Esc, or dialog close | Stays |
| OS file picker opens | Stays |
| OS file picker cancelled | Stays |
| Load fails, or slot is corrupt | Stays, failure is toasted |
| File is unreadable or rejected | Stays, failure is toasted |
| **Tower successfully adopted** | **Tears down, tower is entered** |

The cancel case is quiet and easy to get wrong: the importer binds `onchange`
only, and a cancelled OS picker fires no event whatsoever. There is no callback
to handle, which is exactly why teardown must never be attached to *opening* the
picker.

The failure case matters just as much. A load that tears the splash down on
failure strands the player inside the throwaway boot sim with no route back to
the title screen, which is the same trap this whole change exists to remove.

## Resuming paused

Tearing the splash down resumes the engine to play speed. Continue already
compensates by setting speed to 0 and toasting "Press ▶ to resume", on the rule
that the Play control is the single resume. **A load from the picker inherits
that contract exactly**, or the player lands in a running tower they have not
looked at in three weeks, with time advancing while they reorient.

## Stacking and Esc

The splash's own Esc handler resolves to the safe default and already guards
against firing while a modal is open, so an Esc meant for the picker cannot leak
through and tear the title screen down into Continue. The picker inherits that
guard by using the same shared dialog.

## Focus

Opening the picker moves focus into it. Closing it returns focus to the Load
Tower plate, not to the top of the splash.

The splash focus trap enumerates its own buttons in DOM order. Adding a plate
adds it to that cycle in place; the utility cluster stays at the tail.

# Accessibility Floor

- Every control is a real `<button>`, reachable and operable by keyboard, with a
  visible focus ring in `{colors.splash.focus.ring}`. The global navy ring is
  invisible against the night sky and must not be inherited here.
- Touch targets are at least 42px on desktop and 48px on mobile, matching the
  existing plates.
- The picker's rows are a list with an accessible name per row. A row's status
  (loadable, unreadable, empty) is conveyed in text, never by color or italics
  alone.
- The file row's detail line names the accepted formats in text, so the accepted
  input is not knowledge held only by the OS picker's filter.
- Focus returns to the invoking plate on close, so a keyboard user is never
  dropped at the top of the screen.
- Nothing in this change animates, so there is no reduced-motion surface.

# Responsive & Platform

**Desktop.** Three plates and the ghost link fit one centered row at current
sizes; the existing wrap handles narrower windows.

**Mobile.** The stack is vertical, full width, 48px targets. A fourth control
tightens the vertical budget. Verify at 360x640 that the stack clears the
attribution block and does not push the wordmark off screen. If something has to
give, the attribution shrinks; the targets do not.

**Installed PWA and Android TWA.** This is where the file row is least reliable
and most needed. Android pickers grey out extensions they do not recognize, which
is why the importer's accept list already carries `application/octet-stream`
beside `.vctower`. The file row's copy therefore names the formats in text: if
the picker hides them, the player at least knows what they are hunting for.

The TWA is also the surface where the new-device journey is most likely, because
a reinstall from the home-screen icon starts with empty storage while the
player's exports sit in cloud storage.

# Key Flows

## Flow 1: Mo gets a new phone

Mo has a 92 floor tower and a cracked screen protector. In March he replaces the
phone, reinstalls from the home-screen icon, and opens Verticopolis. He exported
a `.vctower` back in January; it is in his Drive.

1. The title screen comes up. Storage is empty, so there is no Continue.
2. He taps **Load Tower**.
3. The picker says `No towers saved on this device.` and offers
   **Load from a file...**. The line tells him the truth he had already guessed,
   and puts the next step directly under it.
4. He taps the file row. The OS picker opens over the title screen. He goes to
   Drive and picks the `.vctower`.
5. **Climax.** The importer validates the file, the tower is adopted, the title
   screen tears down, and he lands in his 92 floors, paused, with "Press ▶ to
   resume."

Before this change, step 3 did not exist. Mo founded a tower he did not want in
order to reach Import from inside it.

## Flow 2: Rex loses his autosave

Rex plays on desktop and files good tickets. His autosave was written by a build
that has since rolled back, so it will not parse. He does keep a manual save in
slot 2 from two nights ago.

1. The title screen comes up with no Continue, because `hadReadableSave` is false.
2. The bulletin warns that his saved tower could not be read. Today that is where
   the story ends and he starts over.
3. He taps **Load Tower**.
4. The picker shows the autosave row as `Couldn't be read by this version.`, with
   no control, and directly beneath it **Slot 2**, with its name, star, day and
   population, and a Load button.
5. **Climax.** He loads slot 2 and is back in his tower, two nights behind but
   whole. The unreadable row above it is still there, still labeled, telling him
   the autosave was not silently thrown away.

This is the flow the change exists for. Everything else is reach the title screen
should always have had.

## Flow 3: A first-timer, who should not notice any of this

Someone opens Verticopolis for the first time.

1. Three controls: **Load Tower**, **＋ New Tower** in amber, **How to Play**.
2. The amber plate is the only amber thing on screen and it says New Tower.
3. **Climax.** They press it, and the flow they get is the one that already
   exists, unchanged.

If curiosity sends them into Load Tower first, they get one honest line and a
route back. They do not get four rows reading "empty", and they do not get a
control that could write over anything.

# Inspiration & Anti-patterns

The pattern being adopted is the oldest one in the genre: New, Load, Continue as
three lines on a title screen, which SimTower itself reached through File > Open.
Nothing here needs to be taught, which is the whole argument for the placement.

Anti-patterns this design rejects, each because it was proposed and killed:

- **Mounting the in-game save manager on the title screen.** It carries write
  controls that would operate on a simulation the player never built, and they
  would succeed silently.
- **Sending the button straight to the file picker.** It shows the player their
  Downloads folder while their towers sit in localStorage, invisible to any OS
  picker.
- **Hiding slots that will not parse.** It tells the player their tower is gone
  at the exact moment the bytes are still on disk and possibly recoverable.
- **Making the button's destination depend on what is in storage.** It saves one
  screen and costs the control its predictability.
- **Making Load Tower primary when the autosave is corrupt.** It is the most
  useful control on screen in that state, and it still should not be the amber
  one: amber means "this is where you were", and in that state nothing is.
