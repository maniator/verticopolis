---
title: "UX spec: the Classic rent editor (pricing-split epic gate)"
game: Verticopolis (browser SimTower clone)
author: Sally (UX designer)
date: 2026-07-15
status: Draft for owner review (this is the editor-UX detail the `pricing-split`
  backlog row is gated on; GitHub issue #299)
scope: Editor and dialog UX only. The engine rulings are ratified inputs and are
  cited, never re-litigated. Folds in the owner-approved editor access IOU
  (issue #370) because this spec redraws the editor panel anyway.
inputs:
  - _bmad-output/planning-artifacts/design/gdd-classic-modern-pricing-roadmap-2026-07-08.md (§0-§2)
  - _bmad-output/planning-artifacts/design/epics-classic-modern-roadmap-2026-07-08.md (Epic 1, FR1-FR8, NFR1-NFR3, AR6, UX-DR1/2/4)
  - _bmad-output/party-mode/memories/installed/.memlog.md (epic-review party + elicitation-findings party, 2026-07-08)
  - docs/design-system.md (the dialog grammar this spec composes from)
  - _bmad-output/implementation-artifacts/spec-pixelart-unit-states.md (the reserved state-cue canon)
  - src/ui/templates/editor.ts, src/ui/templates/batchPricing.ts, src/game/facilityDiagnostics.ts, src/ui/templates/stats.ts (current surfaces)
  - _bmad-output/implementation-artifacts/backlog.md rows `pricing-split` (#299) and `editor-access-too-far-state` (#370)
---

# UX spec: the Classic rent editor

## 0. Ratified ground (cited, never re-argued)

Everything below designs the surface for rulings already on record:

- **The split shape.** `GameRules.priceOptions(kind)` returns a discrete
  four-rung ladder plus a No Rate sentinel in Classic and today's continuous
  `{min, default, max, step}` band in Modern; the editor switches on the SHAPE
  of that return, never on the mode string (GDD §1; epics FR1/FR3, NFR1).
- **The canon rungs and values.** Very Low / Low / Average / High at the FULL
  canon dollar tables for office, condo, and all three hotel room kinds, colors
  Blue/Green/Yellow/Red as in 1994 (GDD §0 and §2, user call 2026-07-08).
- **No Rate = OFF-MARKET, one inseparable state.** A No Rate unit charges
  nothing AND accepts no move-ins; the two halves never separate. Setting No
  Rate on an occupied unit never evicts: the tenant stays, pays nothing, and
  still counts in the rating census (canon, the endpoint of the 1994 cheap-rent
  population lever). Classic-only surface; Modern's editor never offers it and
  a forged Modern `noRate` coerces away through the GameRules method
  (`coerceNoRate`, already on main) (epics FR4; epic-review party and
  elicitation-findings party, memlog 2026-07-08).
- **Snap-on-load.** Pre-split Classic rents snap once to the nearest rung at
  load, ties round up, uniform for every kind with no intent-guessing; the
  labeled "grandfather" row was considered and rejected. Modern saves are
  untouched (epics NFR3, owner call at the epic-review party 2026-07-08;
  uniform nearest-ties-up enforced at the elicitation party).
- **Sold condos are price-locked**; unsold Classic condos may list at $50,000,
  below build cost (GDD §2; epics FR7).
- **Batch pricing speaks in rungs in Classic** and keeps the range editor in
  Modern (GDD §1; epics FR6, UX-DR2).
- **Dialog grammar.** Gray face, `--bevel-out`, navy full-bleed `.win-title`,
  Win-style `.btn` press-only feedback, one primary per dialog, `.field` wells,
  36px touch targets under `pointer: coarse`, visible focus always
  (docs/design-system.md; epics UX-DR1).

Engine notes this spec relies on but does not design: `Unit.noRate`,
`coerceNoRate`, and the TDT class-4 round-trip already shipped (PR #200,
v1.26.0); the editor's price value cell already reads "No Rate" for an
off-market unit. What does not exist yet is `priceOptions(kind)`, the rung
picker, the Classic batch dialog variant, the snap migration, and every
legibility line below.

## 1. The Classic rung picker

### 1.1 Where it lives

The unit editor card (`#editor`, a floating `.win` bottom-left over the stage,
250px desktop / `min(250px, 80vw)` phone) currently offers a two-button nudge
row (`– rent` / `+ rent`) for priced kinds. In Classic that row is REPLACED by
one rung-picker row. Nothing else about the card moves.

Desktop, Classic office, occupied:

```
+--------------------------------------------+
| Office                                  [x]|   navy .win-title, full bleed
+--------------------------------------------+
|  Location           Floor 12               |
|  Status             occupied               |   .kv stat grid
|  Occupants          6/6                    |
|  Elevator access    Yes                    |   (see §4 for the third state)
|  Eval               [######  ] 62%         |
|  Quarterly rent     $10,000                |   data-field="rent"
|  Resale value       $12,000                |
|  [ name........... ] [ Rename ]            |   unchanged
|  [#] [ Average  $10,000              v ]   |   THE RUNG PICKER (new row)
|  [ Set all offices...                  ]   |   unchanged entry point
|  [ Sell / Bulldoze                     ]   |   unchanged
+--------------------------------------------+
```

The row is one `.ed-row` holding two elements:

- **The rung chip** `[#]`: a 12px square swatch, `--bevel-in` ring, filled with
  the current rung's color (§1.3). For No Rate the chip is hollow (chrome face,
  no fill). The chip is decorative reinforcement only (`aria-hidden="true"`);
  the rung NAME is always in text right beside it, so color never carries the
  state alone (design-system §5).
- **The select** `<select class="field">`, flex-grown to the row. A `.field` is
  the house well-you-type-into recipe, which is exactly what a Win 3.1 combo
  box is, so no new component is invented (design-system rule 3).

### 1.2 The options

Five options, ladder order then the off switch, labels from
`priceOptions(kind)` so the UI can never drift from the engine table:

| Kind | Options (label text, verbatim) |
|---|---|
| Office | `Very Low  $2,000` / `Low  $5,000` / `Average  $10,000` / `High  $15,000` / `No Rate` |
| Condo (unsold) | `Very Low  $50,000` / `Low  $100,000` / `Average  $150,000` / `High  $200,000` / `No Rate` |
| Hotel single | `Very Low  $500` / `Low  $1,500` / `Average  $2,000` / `High  $3,000` / `No Rate` |
| Hotel double | `Very Low  $800` / `Low  $2,000` / `Average  $3,000` / `High  $4,500` / `No Rate` |
| Hotel suite | `Very Low  $1,500` / `Low  $4,000` / `Average  $6,000` / `High  $9,000` / `No Rate` |

- The billing period is NOT repeated in the option text; the kv row label
  above already says `Quarterly rent` / `Sale price` / `Room rate`, and the
  value cell keeps its `/night` suffix for hotels. One statement of the
  period per card.
- Native `<option>` text cannot be color-styled reliably across platforms
  (phones hand the list to the OS picker), which is why the color lives on
  the chip outside the select rather than on the options. The dropdown is
  still the control the epics ratified (UX-DR1); the chip restores the 1994
  color identity the native widget cannot carry.
- `No Rate` is the last option, separated from the ladder by a disabled
  divider option (`──────`, the standing empty-value glyph exception). It is
  a deliberate off switch and should not read as a fifth price.

### 1.3 The rung colors

The 1994 dropdown color-coded its four levels Blue/Green/Yellow/Red (GDD §0).
Proposed chip fills, chosen to read on the gray face and to stay far from every
reserved sprite state-cue literal (vacancy `#C9CCC4`/`#B2B0A4`, notice
`#E8A030`, stress `#C24A3A`, dirty tray `#D4623A`, ready lamp `#FFD86A`, closed
`#E0556B`; spec-pixelart-unit-states.md):

| Rung | Chip fill | Note |
|---|---|---|
| Very Low | `#2048B0` | period navy-blue, distinct from `--r-title` |
| Low | `#1E7A2E` | green, distinct from `--good` usage in text |
| Average | `#C8A000` | dark gold; plain yellow dies on gray chrome |
| High | `#B02020` | red, distinct from stress `#C24A3A` and `--bad-ink` |
| No Rate | none (hollow) | absence of a price is absence of a fill |

These are UI chrome values, new tokens in the tokens layer (for example
`--rung-vlow` .. `--rung-high`), never hard-coded per design-system §1. Hex
ratification is an open question for the pixel-art party (§6.2).

### 1.4 Interactions

- **Commit on `change`.** Picking an option applies immediately through the
  engine's one price choke point, exactly like the old nudge buttons: no
  Apply step for a single unit, matching 1994's dropdown-and-done feel.
  Native select semantics give keyboard users arrows, Home/End, and
  first-letter jumps for free; Esc closes the open list without committing.
- **Announce on commit** through the existing single-throat announce path,
  pinned strings (UX-DR4):
  - `Rent set to Average ($10,000).` (office)
  - `Sale price set to Very Low ($50,000).` (unsold condo)
  - `Room rate set to High ($3,000).` (hotel kinds)
  - `No Rate: off the market. Charges nothing; no one moves in.`
- **Setting No Rate needs no confirm.** It never evicts, it is one click to
  reverse (pick any rung), and 1994 offered it as a plain fifth entry. The
  legibility lines in §2 carry the consequences.
- **Sold Classic condo: the picker renders DISABLED at the locked rung**, chip
  filled, classic GrayText. Today the price row is hidden entirely for sold
  condos; in Classic we show the disabled control instead, because the design
  system's rule is to show why a thing cannot be pressed, and the locked rung
  is real information (FR7). The kv value cell keeps showing the fetched
  price. Modern keeps today's hidden-row behavior unchanged.
- **Tab order** within the card is unchanged: rename field, Rename, rung
  picker, `Set all ...`, Sell / Bulldoze, title-bar close.

### 1.5 Phone variant

Same card, same row. The phone editor is the same floating window at
`min(250px, 80vw)`; the select opens the OS wheel/sheet picker, which is
correct behavior and needs no custom list. Two rules:

- Under `pointer: coarse` the rung select joins the existing 36px minimum
  (today that media block grows `.ed-row .btn` only; it must also cover
  `.ed-row .field` when the field is a select).
- The mobile editor folds diagnostics in below the stats (existing behavior);
  the No Rate lines of §2 appear there, so a phone player sees the
  consequence in the same panel that owns the picker.

### 1.6 What Modern towers see

Nothing changes. `priceOptions()` returns the continuous band, the editor
renders today's `– rent` / `+ rent` nudge row and stepper semantics, batch
pricing keeps its range editor, and No Rate exists nowhere in the surface: no
option, no announce string, no diagnostics line (FR3, FR4). The renderer picks
per the SHAPE of the return value, so no UI file ever asks which mode it is in
(NFR1).

### 1.7 Batch pricing, Classic variant

`Set all offices...` opens the same modal window; in Classic its body swaps
the number machinery for the rung picker. Modern's dialog is byte-for-byte
today's (UX-DR2).

```
+--------------------------------------------+
| Set all offices                         [x]|
+--------------------------------------------+
|  Set every office to                       |
|  [#] [ Low  $5,000                    v ]  |   same chip + select as §1.1
|  [x] Only offices still on Average         |
|                                            |
|  Set 9 of 12 offices to Low ($5,000).      |   live preview, aria-live
|                                            |
|              [ Apply ]  [ Cancel ]         |
+--------------------------------------------+
```

- The two mode radios ("Set price to" / "Reset to default") collapse into the
  one select: Average IS the default rung (epics AR6), so a separate reset
  mode would be the same choice twice.
- The `Range $min-$max` helper line disappears; a ladder needs no band hint,
  and a rung can never clamp, so the preview never emits clamp sentences.
- The "only default-priced" filter survives, reworded to the ladder:
  `Only offices still on Average` (`Only condos...`, `Only singles...`). Same
  engine semantics as today.
- **Preview sentences** (pinned; reuse the existing honest-preview pattern):
  - `Set 9 of 12 offices to Low ($5,000).`
  - `Set 4 of 6 condos to High ($200,000). 2 sold skipped.`
  - No Rate target: `Take 12 of 14 offices off the market (No Rate). Occupied
    offices keep their tenants and charge nothing.`
- **Batch No Rate is armed, two clicks.** Taking a whole kind off the market
  is the one heavyweight choice in this dialog, so it borrows the existing
  armed-confirm idiom (today's bulk reset): first activation relabels the
  primary to `Confirm No Rate`, second applies. Any other change disarms.
- One primary per dialog (Apply), Cancel beside it, ✕ routes the cancel path,
  Esc cancels; all inherited from the window grammar unchanged.

## 2. State legibility: how No Rate reads

No Rate is a player choice; it must read as one everywhere the unit shows up,
without ever borrowing a fault color or a reserved sprite cue.

### 2.1 Editor card

- The price value cell reads `No Rate` (already shipped) and the picker sits
  on the hollow-chip No Rate option. That pairing is the primary read.
- The Status row is untouched: an occupied No Rate unit still says `occupied`,
  a vacant one `empty`. No Rate is a pricing state layered on tenancy states
  the panels already know how to say.

### 2.2 Inspector and folded-in diagnostics

`facilityDiagnostics` gains one line for No Rate units, uncolored (plain ink):
this is a chosen setting, so neither `--good` nor `--bad` applies. Pinned copy:

- Vacant: `Off the market: No Rate. No one moves in until you set a rate.`
- Occupied: `No Rate: the tenant stays, pays nothing, and still counts toward
  stars.`

The occupied line states the census fact out loud on purpose: the party pinned
free-tenants-still-count as canon (the 1994 cheap-rent lever endpoint, Samus's
ruling, memlog 2026-07-08), and saying it in the inspector stops it reading as
a bug later.

The line slots into the existing card order after the access line and before
the on-notice block, so a No Rate unit that is ALSO on notice (possible in
sequence: notice given first, then rent zeroed; the notice does not rescind by
itself) shows both truthfully.

### 2.3 Stats dialog (Tenancy)

The Tenancy section's `Vacancies` row learns to split off-market emptiness out
of the number the player is being asked to fix:

- `Vacancies    7` (no No Rate vacancies; unchanged)
- `Vacancies    7 (2 off-market)` (when at least one vacant unit is No Rate)

No new row, no color: off-market vacancies are not a problem indicator, and the
parenthetical keeps the headline count honest (a player chasing "7 vacancies"
should know 2 of them will never fill at the current setting).

### 2.4 The tower view (explicitly out of scope, one open question)

No sprite work in this epic. A vacant No Rate office/condo keeps today's
hatched vacancy shell in the reserved grays `#C9CCC4`/`#B2B0A4`, the notice
ribbon keeps `#E8A030`, and no new state-cue color is introduced; the reserved
canon (spec-pixelart-unit-states.md) is frozen and adding a cue is an
ask-first renegotiation. The one honesty wrinkle (that shell carries a
LEASE/SALE plate, and an off-market unit is not really advertising) is raised
as open question §6.1 rather than smuggled in here, because suppressing the
plate touches the frozen art canon and every gallery baseline.

## 3. The snap-on-load moment

The migration itself is ratified (NFR3: snap once, nearest rung, ties up,
clamp-then-snap for forged values, Modern untouched). What the player sees:

- **One bulletin line, once per save**, posted on the first load where the
  snap actually changed at least one stored rent. A pre-split save whose
  rents already sat on rungs loads silently; so does every Modern save and
  every post-split save.
- **Pinned copy:**
  - Base line: `Classic pricing: rents snapped to the four 1994 rate levels.`
  - When the tower contains at least one condo, append the ratified feature
    callout: `Condos can now sell for as little as $50,000.`
- The line goes through the normal bulletin path (durable in the log,
  announced via the existing live region), no modal and no toast: the snap is
  a fact about the save, and the bulletin log is where facts about the save
  go. After it, every surface simply tells the truth: the picker sits on a
  real rung, the value cell shows a rung dollar amount, and no phantom
  "custom" entry exists anywhere (the grandfather row was rejected on the
  record, memlog 2026-07-08).
- The release notes for the shipping version repeat the snap and the condo
  callout per NFR3; that is process, listed here only so the copy stays
  consistent between the two surfaces.

## 4. The editor access row's third state (folds in issue #370)

The editor's `Elevator access` row today knows `Yes` / `No`, while the
inspector and the move-in gate know a third truth: a floor can be connected
yet sit 3+ rides from the lobby, where no commuter ever comes. Since this spec
redraws the editor panel, the IOU lands here (owner-approved; backlog row
`editor-access-too-far-state`, #370).

- **Values and colors** (text carries the state; color reinforces):
  - `Yes` in `--good` (served and `sim.floorReachable(floor)` true)
  - `Too far (3+ rides)` in `--bad` (served, `floorReachable` false)
  - `No` in `--bad` (not served)
- **Trigger:** the third state applies only to kinds that draw commuters or
  visitors (`hasAccessDiagnostic(u)`), the same predicate the diagnostics
  line already uses; zero-population service kinds (security, medical,
  housekeeping, metro) keep plain Yes/No, because the two-ride rule is about
  passenger trips they do not make. `floorReachable` is already computed per
  render by the inspector's diagnostics line, so the editor reading it too
  adds no new cost class.
- **Copy alignment:** `(3+ rides)` deliberately echoes the inspector's
  existing sentence ("Access: too far. 3+ rides from the lobby...") and the
  stats dialog's stranded-floors footnote, so the three surfaces name one
  concept with one phrase. The row stays terse; the full sentence and the
  sky-lobby fix live in the diagnostics line, which the mobile editor already
  folds in (and which is why the mobile panel needs no change at all here).
- Both modes get this; it is legibility, unrelated to the pricing seam.

## 5. Pinned player-facing strings (the copy inventory)

Every new string this spec introduces, in one place for the announce-path
tests:

| Surface | String |
|---|---|
| Announce, rung set (office) | `Rent set to <Rung> ($<amount>).` |
| Announce, rung set (condo) | `Sale price set to <Rung> ($<amount>).` |
| Announce, rung set (hotel) | `Room rate set to <Rung> ($<amount>).` |
| Announce, No Rate | `No Rate: off the market. Charges nothing; no one moves in.` |
| Diagnostics, vacant No Rate | `Off the market: No Rate. No one moves in until you set a rate.` |
| Diagnostics, occupied No Rate | `No Rate: the tenant stays, pays nothing, and still counts toward stars.` |
| Stats, Tenancy vacancies | `<n> (<m> off-market)` |
| Batch preview, rung | `Set <c> of <m> <noun> to <Rung> ($<amount>).` (+ existing ` <k> sold skipped.`) |
| Batch preview, No Rate | `Take <c> of <m> <noun> off the market (No Rate). Occupied <noun> keep their tenants and charge nothing.` |
| Batch primary, armed | `Confirm No Rate` |
| Batch filter label | `Only <noun> still on Average` |
| Bulletin, snap | `Classic pricing: rents snapped to the four 1994 rate levels.` |
| Bulletin, snap + condos | `... Condos can now sell for as little as $50,000.` |
| Editor access row | `Yes` / `Too far (3+ rides)` / `No` |

## 6. Open questions (owner / party; the engine rulings are settled)

1. **LEASE/SALE plate on a vacant No Rate unit (owner + art canon).** The
   hatched vacancy shell advertises LEASE/SALE, but a No Rate unit is off the
   market. Suppressing the plate (shell stays, plate omitted) would be honest
   and uses no new color, but it edits a frozen reserved-cue helper
   (`vacancy()` in spec-pixelart-unit-states.md, an ask-first change) and
   ripples every gallery and visual baseline. Ship panels-only legibility
   (this spec) and leave the sprite as is, or fold the plate suppression into
   the epic? My recommendation: panels-only now; sprite honesty as a
   follow-up row if it bothers anyone in play.
2. **Rung chip hex values (pixel-art party).** §1.3 proposes
   `#2048B0 / #1E7A2E / #C8A000 / #B02020`. They avoid every reserved
   state-cue literal and read on gray chrome, but the party owns color
   adjacency and should ratify or retint before the tokens land.
3. **Batch No Rate reach (owner, small).** The armed `Confirm No Rate` treats
   kind-wide off-market as deliberate. If the owner would rather keep batch
   No Rate out entirely (per-unit only), the dialog simply omits the option;
   1994 offers no precedent either way because it had no batch pricing at
   all. Default if unanswered: keep it, armed.
