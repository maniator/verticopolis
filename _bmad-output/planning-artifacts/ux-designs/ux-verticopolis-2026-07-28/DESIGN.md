---
title: Verticopolis — Title-screen action stack and tower picker
status: final
updated: 2026-07-28
scope: title screen (splash) actions + the load-only tower picker (not a full visual-identity spine)
sources:
  - _bmad-output/party-mode/memories/installed/.memlog.md (roundtable 2026-07-28)
  - ../ux-verticopolis-2026-07-07/DESIGN.md (responsive layout tiers)
tokens:
  colors:
    splash.btn.ink: "#20204a"
    splash.btn.face: "#e6dcc0"
    splash.btn.edge: "#0d0d10"
    splash.btn.primary.face: "#ffc94a"
    splash.btn.ghost.ink: "#ffe6bf"
    splash.focus.ring: "#ffc94a"
    row.unreadable.ink: "var(--muted)"
  typography:
    splash.btn.size: 15px
    slot.name.size: 13px
    slot.detail.size: 11px
  spacing:
    splash.actions.gap: 12px
    splash.btn.minHeight: 42px
    splash.btn.minHeight.mobile: 48px
    splash.actions.width.mobile: min(86vw, 320px)
    slot.row.padding: 7px 8px
  components:
    splash.btn: beveled box-art button, 2px ink border, dual inset highlight, 3px hard drop shadow
    splash.btn.primary: same body, amber face, 700 weight
    splash.btn.ghost: transparent face, underlined warm ink, drop text-shadow
    picker.shell: retro <dialog id="modal"> chrome (shared with How to Play and New Tower)
    picker.row: .slot row, name + detail block, single trailing action
---

> **Canonical for this concern.** These tokens govern the splash action stack and
> the tower picker's surface. Everything here already exists in `src/styles.css`
> except the two additions called out under **Components**. Behavior is in
> `EXPERIENCE.md`; on conflict with any mock, both spines win.

# Brand & Style

Two chromes meet on this screen, and the split is deliberate.

The **title screen** is art-deco box art: an indigo-to-coral dusk sky, an
engraved skyline, the wordmark set in SVG `<text>` with `textLength` so it fits
any viewport without a font download. Its controls are cream beveled plates that
look pressed out of the same era as the poster. This chrome is intentionally
un-unified with the game and stays that way.

Anything **stacked over** the title screen is retro desktop chrome: beveled gray
windows, navy title bars, tabular readouts, the same shell How to Play and the
New Tower rule-set picker already use. The tower picker joins that set.

The seam is the rule: the poster is the poster, and a window opened on top of it
is a window. Do not restyle the picker into box art to "match" the splash behind
it, and do not restyle the splash buttons into retro chrome to match the picker.

# Colors

| Token | Value | Used for |
| --- | --- | --- |
| `{colors.splash.btn.face}` | `#e6dcc0` | Default action plate (Load Tower, New Tower without a save) |
| `{colors.splash.btn.primary.face}` | `#ffc94a` | The single amber action: Continue, or New Tower when no save exists |
| `{colors.splash.btn.ink}` | `#20204a` | Plate label |
| `{colors.splash.btn.edge}` | `#0d0d10` | 2px plate border |
| `{colors.splash.btn.ghost.ink}` | `#ffe6bf` | How to Play, underlined, no plate |
| `{colors.splash.focus.ring}` | `#ffc94a` | Focus ring on every splash control |
| `{colors.row.unreadable.ink}` | `var(--muted)` | An unreadable slot row's label and detail |

**Exactly one amber plate is on screen at a time.** Continue takes it when a save
exists; New Tower takes it when none does. Load Tower never takes it, in either
state. Two amber plates would leave the returning player with no default.

The splash focus ring is amber rather than the global navy ring, because navy is
invisible against the night sky. Any control added to the splash inherits this.

# Typography

Unchanged. Action labels are `var(--r-font)` at `{typography.splash.btn.size}`.
Picker rows inherit the existing slot scale: name at
`{typography.slot.name.size}`, detail line at `{typography.slot.detail.size}`.

Labels are sentence-cased with a leading glyph, matching the existing pair:

| Action | Label |
| --- | --- |
| Continue | `▶ Continue` |
| Load Tower | `▤ Load Tower` |
| New Tower | `＋ New Tower` |
| How to Play | `？ How to Play` |

The glyph is a plain character, not an icon font or an SVG, so it survives
offline with no download. `▤` is chosen for reading as a stack of saved things
next to `▶` and `＋` without importing a new visual vocabulary.

# Layout & Spacing

`.splash-actions` is a wrapping flex row, `{spacing.splash.actions.gap}` gap,
centered. Three plates plus the ghost link fit one desktop row at the current
sizes; the existing `flex-wrap: wrap` already handles the narrow case.

On mobile (`#splash.splash--mobile`) the stack turns vertical at
`{spacing.splash.actions.width.mobile}`, every plate full width and
`{spacing.splash.btn.minHeight.mobile}` tall. **A fourth stacked control tightens
the vertical budget on short phones.** Confirm on a 360x640 viewport that the
stack does not collide with `.splash-attrib` below it or push the wordmark off
the top; if it does, the attribution block is what shrinks, never the targets.

The picker inherits the retro modal's own sizing. Rows keep
`{spacing.slot.row.padding}` and the `.slot + .slot` hairline divider.

# Elevation & Depth

Three layers, already established:

1. The splash art (stars, sun, skyline) at the base, all `aria-hidden`.
2. Splash content at `z-index: 3`, plus the utility cluster (mute, install)
   pinned top-right.
3. The retro `<dialog>` in the browser's top layer, above everything.

The picker is layer 3. It paints over the toast rail, which is why `showSaves`
already closes itself before firing an export. Anything the picker needs to say
in passing has to be said *in* the picker, not toasted behind it.

# Shapes

Splash plates are square-cornered with a 2px ink border and the beveled inset
pair. Picker rows are flat, divided by a hairline. No radii are introduced.

# Components

Two additions. Everything else on this screen already exists.

## `picker.row.unreadable`

A slot present in storage but unreadable by this build. Rendered as a row with
its name intact, its detail line replaced by the unreadable copy in
`{colors.row.unreadable.ink}`, and **no load affordance at all**. Not a disabled
button, which invites a tap that cannot work: the row simply carries no action.

It renders italic like the existing `.slot-empty`, so "present but unreadable"
and "empty" read as the same family of non-actionable row while their copy keeps
them distinct.

## `picker.row.file`

The "Load from a file..." row. Same `.slot` geometry as a tower row so it reads
as one more place a tower can come from, separated from the slot rows above it
by a slightly heavier rule to mark that it crosses from device storage to the
file system. Its action button is the row's only control.

# Do's and Don'ts

**Do** keep exactly one amber plate on the title screen.

**Do** give any new splash control the amber focus ring; the global navy ring
disappears against the sky.

**Do** let the picker wear the retro modal chrome, as How to Play and New Tower
already do over this same screen.

**Don't** add a Save, Delete, or Export control to any surface reachable from the
title screen. See `EXPERIENCE.md` for why this is a correctness rule and not a
matter of taste.

**Don't** restyle the picker into splash box art. The poster and the windows over
it are meant to look different.

**Don't** let Load Tower become the primary action in any state, including the
corrupt-autosave state where it is the most useful control on screen. The plate
that means "this is where you were" is Continue, and when Continue is absent the
honest default is New Tower.
