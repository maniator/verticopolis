# Canon reference: the original SimTower `.TDT` save format

**Provenance.** The facts below are merged from two independent
reverse-engineering efforts, tagged where they disagree:

- **[OS]**: OpenSkyscraper's notes (`doc/simtower/TDT_format.txt` in
  [fabianschuiki/OpenSkyscraper](https://github.com/fabianschuiki/OpenSkyscraper),
  GPL-3.0).
- **[TD]**: the dedicated spec in
  [dfloer/tower-docs](https://github.com/dfloer/tower-docs) (`tdt_spec.md`,
  CC-BY-SA 4.0; its reference Python reader is **AGPL-3.0; never copy that code
  into this repo**). [TD] is substantially more complete and, where the two
  conflict, usually better evidenced.

This file **restates the factual layout in our own words**; no upstream text
or code is copied. Keep it that way when editing this page: describe the format
in your own words and never paste upstream prose or code.

**Sources policy (clean-room).** Verticopolis is a clean-room clone. Canon may
be derived from observed game behavior, published FAQs/wikis, and
reverse-engineered **data formats** like this one, always with attribution.
It must **never** be derived from the original games' source code. In
particular, the [YootTowerManagement/YootTower](https://github.com/YootTowerManagement/YootTower)
archive holds a code drop of Yoot Saito's tower games (unpublished as of
2026-07; an MIT relicense is intended but unverified, and SimTower-era rights
are entangled with Maxis/EA): **nobody working on Verticopolis reads that code,
even if it is published or relicensed**: reading it would end our clean-room
claim regardless of license. Its non-code materials (interviews, design
commentary) are fair inspiration.

**Why this exists.** The `.TDT` save is a window into the 1994 original's
internals: it confirms (or corrects) numbers our engine treats as canon, and it
is the specification for the importer of original saves
(`src/storage/tdtFormat.ts` + `src/storage/tdtImport.ts`; see PARITY.md).
`src/tests/integration/canon.integration.test.ts` asserts our engine constants against this page so
drift gets caught in CI.

**Reliability.** Both sources analyzed the Windows version (little-endian);
neither pins an exact game version. Structures after the floor map are
variable-width; walk, don't seek. Unconfirmed fields are flagged.

---

## 1. Header (fixed offsets; 70 bytes, then 490 undocumented, floor map at 560)

| Offset | Size | Field | Meaning |
| --- | --- | --- | --- |
| 0x00 | u16 | magic | Always `0x2400` (little-endian, so the bytes on disk read `00 24`) |
| 0x02 | u16 | level | 1–5 = star rating; **6 = TOWER** |
| 0x04 | i32 | balance | Current funds, in stored units (see §2) |
| 0x08 | i32 | otherIncome | Finance-window line |
| 0x0C | i32 | constructionCosts | Finance-window line |
| 0x10 | i32 | lastQuarterMoney | Finance-window line |
| 0x14 | u16 | tick | Time of day in ticks, 0–2599 (see §3) |
| 0x16 | i32 | currentDay | Signed; rolls over at 11,987 (999 years, §3 calendar) |
| 0x1C | u16 | lobbyHeight | Ground lobby height, 1–3 stories [TD] |
| 0x26 | 2×u16 | window position | Saved viewport X, Y in world px (8 px per tile segment, 36 px per floor slot). Our importer reads it (a 0, 0 pair means "no saved view": the game then opens at the top-left sky). Our exporter writes the live camera view when the save carries one, else the New Tower default 1105, 3491 so a load opens on the ground lobby. The window-size constants behind the mapping (640×469) are derived from that default anchor, not measured; see `viewWordsFromView` in `src/storage/tdtFormat.ts`. |
| 0x2A | u16 | recyclingCount | Total recycling centers [TD] |
| 0x2E | u16 | commercialCount | Shops + restaurants + fast food [TD] |
| 0x30 | u16 | securityCount | Max 10 [TD] |
| 0x32 | u16 | parkingStallCount | Includes disconnected stalls [TD] |
| 0x36 | u16 | hallCinemaCount | Party halls + cinemas combined [TD] |
| 0x38 | u16 | namedUnits | Custom-named tenants [TD] |
| 0x3A | u16 | namedPeople | Custom-named people [TD] |
| 0x3E | u32 | bomb | Floor + position while a bomb event is active [TD] |

The floor map begins at byte **560** (0x230). ([OS]'s `0x9C4` figure is the
offset of the **ground floor's** record (floor index 10) in a tower whose ten
underground floors are empty: 560 + 10 × 194 = 2500 ≈ 0x9C4. It is not where
the floor map starts.)

## 2. Money scale

The game **displays 100× the stored value** (everywhere except the finance
window). A stored balance of `20000` renders as `$2,000,000`, which matches our
`ECON.startingMoney` of 2,000,000 display-dollars. Any importer must multiply
stored amounts by 100; our engine keeps display-dollars and must never adopt the
×100 storage quirk itself.

## 3. Time system

One day is **2,600 ticks**, starting at 7:00 AM. The mapping from tick to clock
time is non-uniform: ticks are dense through lunch and sparse overnight, so
relative to the tick counter the in-game clock **crawls through lunch and races
through the night** (the original's signature rhythm). The span table is the
ground truth for that mapping:

| Ticks | In-game span | Hours covered | Game-seconds/tick |
| --- | --- | --- | --- |
| 0–400 | 7:00–12:00 | 5h | 45 |
| 400–1200 | 12:00–13:00 | 1h | 4.5: the lunch crawl (~10× the morning's tick density) |
| 1200–2400 | 13:00–1:00 | 12h | 36 |
| 2400–2600 | 1:00–7:00 | 6h | 108: the night sprint |

- **The date changes at tick 2300**: midnight. Check it against the table: the
  13:00 boundary is tick 1200, and the 13:00-to-1:00 period runs at 36 s/tick,
  so 3600 / 36 = 100 ticks per hour. Midnight is 11 hours after 13:00, so
  1200 + 11 × 100 = 2300.
- Every period's seconds-per-tick is exactly consistent with its span
  (e.g. 200 × 108 s = 6 h). [OS] gave 126 s for the night row, which contradicts
  the span; [TD]'s 108 s resolves it; **the old inconsistency footnote is
  retired**.
- **Calendar:** a week is 3 days (2 weekdays + 1 weekend day); a quarter is one
  week; a year is 4 quarters = **12 days**. The day counter rolls at 11,987
  (999 years). Verticopolis's 7-day week is a documented deliberate divergence
  (PARITY.md); the retro date *display* already mimics the WD/WE format.
- `src/engine/timePacing.ts` implements the span table's math for the
  presentation-layer "breathing clock"; the simulation itself stays on a
  uniform 1,440-minute day.

## 4. Floors

**120 floor slots**, index 0–119:

| TDT index | Meaning | Verticopolis floor |
| --- | --- | --- |
| 0–9 | B10 … B1 | −9 … 0 |
| 10 | Ground (1F) | 1 |
| 11–109 | 2F … 100F | 2 … 100 |
| 110–119 | reserved/padding | not buildable |

The uniform mapping is `ours = tdt − 9`. It is confirmed by [TD]'s lobby
table (§11): lobbies appear at TDT indexes 10, 24, 39, 54, 69, 84, 99 = in-game
floors 1, 15, 30, 45, 60, 75, 90. **The old "TDT 110 = floor 100" ambiguity is
resolved: floor 100 is index 109; 110–119 are reserved rows** to drop (with an
import-report note) if ever non-empty.

Each floor record: a 6-byte header (`u16 unitCount`, `u16 leftEdge`,
`u16 rightEdge`), then `unitCount` × 18-byte unit records, then a 188-byte remap
table (94 × u16 indices into the unit array).

> **Record order is significant (harness-confirmed).** A floor's unit records
> must be written in **ascending left-edge order**, with the empty-floor (type-0)
> paving spans interleaved at their real x-position (a game-written save reads
> e.g. `…171, 187[type-0], 192, 201[type-0], 203…`). The 1994 renderer walks the
> records left to right and **truncates the floor at the first record whose left
> edge goes backwards**: everything past an out-of-order record draws as bare sky.
> An exporter that appends its type-0 fillers after the rooms therefore blanks the
> right side of any wide floor that has a mid-floor gap (the gh-318 sky-gap,
> reproduced and fixed in the Wine harness). The remap table's zero-fill is
> unrelated: a populated remap does **not** fix the truncation, and a real save
> renders correctly on record order alone.

**Unit record (18 bytes):** left/right extents in segments (u16 each; one
segment = one of our tiles; half-open range); type byte (§5; negative ⇒ under
construction [OS]); a flags byte (bit-mapped hotel state [TD]: bits for occupant
count, booked-but-empty, occupied-overnight, dirty, bug-infested); then **byte 6
holds the retail variant** (0-10 for shops, 0-4 for fast food/restaurants; §7
names), measured against game-written saves (`my_tower` fast-food byte 6 =
`3,1,2,4,0`, matching the "BURGER" stand in the Wine render); the next ~9 bytes
are undocumented; a **rent/lease byte** at offset 16 (0 = Very Low, 1 = Low,
2 = Average, 3 = High, 4 = No Rate) [TD]; and a final byte 17 that earlier notes
guessed was the retail variant or hotel days-dirty. It is neither: it reads `0`
in every real save for retail, hotels, empty-floor, lobby, security, and
housekeeping (measured across TOWER5's 338 hotel rooms and every game-written
retail unit we have), so there is no persisted "days-dirty" counter in the unit
record. It is **nonzero only for offices (type 7) and condos (type 9)** (the
resident/worker kinds), where it carries a small per-unit value (`my_tower`
offices `10,11,17`; condos `1,5,6,8,9,10,12,13,18`; `mo` similar), measured
2026-07-19 on the Wine harness across `my_tower`/`mo`. Its exact meaning is still
unknown, but it tracks only the crowd-bearing kinds and the game rebuilds the
live crowd on load, so it is almost certainly a derived/live value, not
persisted state: our exporter writes `0` and the game regenerates it (the same
posture as the zero-filled people block). A hotel's dirty/asleep/booked state
and its occupant count all live in the flags byte (offset 5), which the importer
decodes.

## 5. Unit type IDs

Multi-story units are stored as one part **per floor** (top/bottom halves,
etc.); an importer must merge parts into one unit, never place each part.

| ID | Original unit | Our `FacilityKind` (importer mapping) |
| --- | --- | --- |
| 0 | Empty floor | `floor` (structural pave) |
| 3 | Hotel single | `hotelSingle` |
| 4 | Hotel twin | `hotelDouble` (lossy name) |
| 5 | Hotel suite | `hotelSuite` |
| 6 | Restaurant | `restaurant` |
| 7 | Office | `office` |
| 9 | Condo | `condo` |
| 10 | Shop (11 variants, §7) | `shop` |
| 11 | Parking stall | `parking` |
| 12 | Fast food (5 variants, §7) | `fastFood` |
| 13 | Medical clinic | `medical` |
| 14 | Security office | `security` |
| 15 | Housekeeping | `housekeeping` |
| 17 | SECOM, a **cut feature** (string table only) [OS] | `security` (approximate) |
| 18 / 19 | Theatre top / bottom half | `cinema` (merge halves) |
| 20 / 21 | Recycling top / bottom half | `recycling` (merge halves) |
| 24 | Lobby | `lobby` |
| 29 / 30 | Party hall top / bottom half | `partyHall` (merge halves) |
| 31 / 32 / 33 | Metro station top / middle / bottom | `metro` (merge parts) |
| 34 / 35 | Theatre screen top / bottom [TD] | `cinema` (part of the theatre) |
| 36–40 | Cathedral, five stacked parts | `weddingHall` (merge; deliberate divergence, see PARITY.md) |
| 42 | "Structures" (string table only) [OS] | — |
| 44 | Parkade ramp [TD] | `parkingRamp` |
| 45 | Metro tunnel [TD] ([OS] read this as "parking ramp"; [TD]'s reading is the better-evidenced one) | full-lot metro backdrop |
| 48 | Burned area (fire/bomb damage); **the retail game does not render one, see below** | cleared floor (report) |

> **Writer note (harness-confirmed, 2026-07-31).** Do **not** write type 48. The
> retail game draws such a record as **garbage pixels** (a block of colored
> static where the room was), measured on the Wine harness with both shapes: one
> record spanning the whole room and a strip of 1-tile records. The ID is real
> (the importer still reads it, and reports the area as cleared), but nothing we
> can write makes the 1994 renderer draw a burned shell. Our exporter therefore
> emits **no record** for a burned-out or burning room and lets the paving pass
> fill those tiles with bare floor (lobby on the ground row), which is what the
> original shows once debris is cleared, and matches what our own importer does
> with a type-48 record it reads. The loss is reported to the player either way.

## 6. People

A `u32` count, then 16-byte per-person records: home floor + unit index +
person-within-unit, a bit-flags byte (flag 32 = belongs to a deleted unit,
retained temporarily [TD]), current floor (negative ⇒ outside [OS]), and a
**u16 stress** and **u16 eval** per person. Known per-tenant populations:
**condo = 3, office = 6**, fast food = 48 (**workers + customers**, never a
census figure; our census counts occupants only).

> **Writer note (harness-confirmed).** The game rebuilds the live crowd on load,
> so the record *bytes* need no real content, but a **populated** tower must
> carry a **nonzero count** here or the game faults reading its people block
> ("file is already open, or damaged"). An **empty** tower is fine at count 0.
> Our exporter writes the tower's resident/worker census with that many
> zero-filled records. Verified by forcing a real save's people count to 0
> (crashes) versus keeping the count and zeroing every record (loads).

## 7. Commercial (retail) table

A fixed **512-slot** table (18 bytes each; floor byte `0xFF` ⇒ empty slot):
floor, a status byte (0–3), and the **variant** byte:

- **Restaurants (type 6):** English Pub, French, Chinese, Sushi Bar, Steak House.
- **Fast food (type 12):** Japanese Soba, Chinese Cafe, Hamburger Stand,
  Ice Cream, Coffee Shop.
- **Shops (type 10):** Men's Clothing, Pet Store, Flower Shop, Book Store,
  Drug Store, Boutique, Electronics, Bank, Hair Salon, Post Office, Sports Gear.

The 512-slot fixed table is a file-format artifact; the subtype *names* are
the canon we care about.

**The variant a room actually renders with is the unit record's byte 6** (the
first byte after the status byte, §4), NOT the record's final byte 17 as earlier
notes implied. Confirmed against game-written saves via `tools/simtower`:
`my_tower`'s five fast-food units read byte 6 = `3,1,2,4,0`
(Ice Cream / Chinese Cafe / Hamburger Stand / Coffee Shop / Japanese Soba), which
matches the readable "BURGER" stand in the Wine render, while byte 17 is `0` in
every real save. The importer reads byte 6 (`tdtParse.ts`) and the exporter
writes it there (`tdtEncoder.ts`). The §7 table's own status/variant bytes do
NOT line up with byte 6 (`my_tower`'s §7 variant column read `0,1,0,1,0`), so the
§7 record's internal layout past its floor byte is still unresolved; it is not
the variant source and is a separate follow-up.

## 8. Transport pools

### Elevators: fully documented [TD]

**24 entries** (confirming the single 24-shaft pool shared by standard +
service + express; see `POOLED_CAPS` in `src/engine/facilities.ts`). Each entry:
a **194-byte header** (byte layout: `used` u8 @0; `type` u8 @1; capacity byte
@2; `cars` u8 @3; 56-byte schedule block @4; visibility + reserved @60; `x` u16
@62; `topFloor` u8 @64; `bottomFloor` u8 @65; 120-byte serviced-floors bitmap
@66; 8 per-car home floors @186). Fields: in-use flag; type (0 = express,
1 = standard, 2 = service); a **capacity byte**; car count 1–8 (confirming
`MAX_CARS` 8); the per-day-type car schedule block; visibility; horizontal
position; top/bottom floor; the serviced-floors bitmap (per-floor stop
configuration!); and the 8 per-car home floors. Built shafts append a fixed
**3,140-byte block** (see the measured note below), then **324-byte per-floor
entries** (one per SPANNED floor, carrying that floor's waiting-up/down counts
and up to 40 queued person indices each way; a floor the shaft passes without
stopping still gets its entry), then a **single 348-byte car block** (current floor,
passenger count, turnaround floor, up to 42 passenger indices, their destination
floors, and per-floor destination counts). So one built shaft's record stride is
`194 + 3140 + 324 * perFloorEntries + 348`, and the 348 block is
**cars-INDEPENDENT**, NOT `* cars`.

`perFloorEntries` depends on the shaft's KIND:

- **standard and service** (`type` 1 and 2): one entry per SPANNED floor,
  `topFloor - bottomFloor + 1`, **every floor the shaft passes, stop or not**
  (see the 2026-07-13 correction below).
- **express** (`type` 0): one entry per **SERVICED** floor, the count of set
  bytes in the header's 120-byte stop bitmap **within the shaft's own span**, in
  files the 1994 game wrote (see the 2026-08-04 measurement below). The in-span
  qualifier is the SAFE reading of a measured hazard: game re-saves carry stray
  set bits OUTSIDE a shaft's span (a standard shaft at floors 54..69 carried 2,
  seen 2026-08-04), and counting a stray would size an express record a full
  entry long, so a reader clamps the count to the span. Whether the game itself
  counts strays is unmeasured (the only express measured so far has none). Our
  own exporter still spans this kind, which the game accepts on load (it loses
  only what FOLLOWS the oversized record, which is why the exporter orders
  express last); the importer tells our files from the game's by the trailer
  (§12a).

The distinction is invisible on standard and service shafts, which stop at every
floor they pass, and that is why it went unnoticed: an express is the one kind
that skips most of what it spans.

> **MEASURED (Verticopolis RE, 2026-08-04, Wine harness): the retail game
> WRITES an express shaft's payload sized by its SERVICED floors.** From a save
> SimTower itself wrote (4-star tower loaded, nothing built, `File > Save`),
> scanned for the 194-byte slot-header signature and measured by the distance
> between consecutive headers, which is the size the writer actually used. An
> express spanning floors 10..100 and stopping at 8 of them occupies
> **6,274 bytes** = `194 + 3140 + 324 * 8 + 348`. The same shaft sized by its 91
> spanned floors would be 33,166. Every standard and service record in that file
> matched the spanned prediction exactly, so the divergence is specific to
> `type = 0`, which is consistent with the earlier probe isolating the trigger to
> the `type` byte.
>
> **The importer must handle it, and now does.** Before this, a game-written file
> containing a skip-stopping express could not be read at all: the walk overshot
> by 324 bytes per skipped floor, landed mid-record, and lost the elevator table,
> the stairs table and the parking count together. It now reads with no warnings.
>
> **Corrected later the same day (2026-08-04), retracting the "both sizings
> load the same" claim above.** The two files behind that claim both carried a stop-sized
> express, so the comparison tested nothing. Re-run by re-saving each variant
> through the game (`File > Save` needs no dialog: a tower loaded from a path
> saves back over it), the outcomes differ dramatically on the same 23-shaft
> tower. The two variants differ in the express's POSITION as well as its
> sizing (the stop-sized files come from pre-mitigation and experimental
> encoders that do not sort express last), so this contrast proves the shipping
> path safe without isolating sizing as the sole variable:
>
> - **Span-sized express, sorted last** (what our exporter ships): the game
>   keeps **22 of 23** in file order, losing exactly the SECOND express, and its
>   re-save (384,658 bytes) writes the kept express STOP-sized: the stop-rule
>   walk of that re-save completes with 18,880 bytes left in the file, less than
>   the 324 x 83 = 26,892 more a span-sized record would need, so span sizing is
>   arithmetically impossible there. The "write express shafts last" mitigation
>   is doing exactly what it promises, and stays.
> - **Stop-sized express at slot 5** (two variants, measured twice): the game
>   keeps only **slots 0-7** in file order, and its re-save (247,774 bytes)
>   carries no recognizable stairway records or parking count; the ~5.7 KB after
>   its elevator table is all zeros. (A reload of that re-save still RENDERS an
>   escalator, and neither re-save carries canon-shaped stair records, so where
>   the game persists stairways in a re-save is an open question; the genuine
>   from-play saves that defined the stairs table in this doc do carry them.)
>
> **Four controlled probes, 2026-08-04 evening: the trigger is the express
> RECORD, and it is NOT its length.** Each variant was built by rewriting only
> the elevator table of one 23-shaft export, leaving every other byte and the
> file length alone, then loaded and re-saved by the game:
>
> | variant | shafts the game keeps |
> |---|---|
> | no express at all (both express records deleted) | **21 of 21** |
> | express LAST, span-sized (what we ship) | **22 of 23** (loses only the second express) |
> | express FIRST, span-sized | **1** (the express alone) |
> | express FIRST, stop-sized (the game's own sizing) | **2** (express + 1) |
>
> The no-express row kills the "8-shaft ceiling" reading outright: with no
> express the game keeps every shaft, so shaft COUNT was never the limit. The
> last two rows kill the size theory: giving the express exactly the length the
> game itself writes (6,274 bytes, verified byte-for-byte) still loses the 20
> shafts behind it. So an express record ends the useful read of the table
> whatever its length, and the surviving-tail count (0, 1, or 2 shafts observed)
> does not track the sizing in any way we can yet explain.
>
> That left the express record's CONTENT as the remaining suspect, on the guess
> that our zero-filled per-floor entries stood where the game's carried live
> queue state. **That guess was wrong, and the next note records the
> measurement that killed it: the two records are byte-identical.** The
> practical consequence was already settled and is unchanged: ordering express
> last is not a stopgap for a sizing bug, because it puts the record the game
> cannot read past where nothing follows it.
>
> A re-save of a re-save is a **fixpoint**: the 8-shaft file re-saves to the
> same 8 shafts, same table end, same 5,672-byte tail.
>
> **SETTLED 2026-08-05: the trigger is the express record's POSITION in the
> table, not its length and not its content.** Two probes closed this, both
> built from bytes the game itself wrote:
>
> - **Content is identical.** A game-written express record is 51 non-zero
>   bytes of header followed by an ENTIRELY ZERO payload: the 3,140-byte fixed
>   block, all eight per-floor entries, and the 348-byte car block are zeros.
>   Ours is byte-for-byte the same 6,274 bytes, followed by 26,892 more zeros
>   from the span sizing. So the game does not keep live queue state in an
>   express payload, our zero-fill was never a divergence, and splicing the
>   game's record into our file is a no-op that changes nothing.
> - **Order alone flips the outcome.** Taking the game's own 8-shaft save (a
>   known fixpoint: re-saving it reproduces all 8) and REORDERING its records so
>   the express sits first, without altering one byte of any record, the game
>   keeps **2 of 8**. Same records, same lengths, same file length, same
>   everything but the sequence.
>
> That explains every earlier row at once. Express last: everything before it
> survives. Express at slot 5 in the game's own file: all 8 survive. Express
> first: the express plus one shaft, whether the record is span-sized (1 kept
> plus nothing) or the game's own stop-sized bytes (2 kept). The mechanism is
> still unknown, and the plausible shapes are a required ordering (by column, by
> kind, by floor) or an express being read before the structures a later shaft
> depends on. What is no longer in doubt is that **writing express shafts last
> is the best available construction of the table**, not a workaround for a
> sizing bug: it is the arrangement that costs a tower with ONE express nothing.
>
> It does not make #740 solved for every tower. A tower with a SECOND express
> still loses it and anything after it (the 22-of-23 row above is exactly that
> case), which is why the export report still warns the player, and why this
> issue stays open. Ordering buys the common case, not the general one.
>
> **What that pins, and what it does not.** The game WRITES the express
> stop-sized (measured directly on one game-written save by header-to-header
> distance, and independently on the 384,658-byte re-save by the EOF fit above),
> so the
> importer's read rule for game files is right. But no single read-side sizing
> rule explains both rows above: two shafts AFTER the stop-sized express
> survive, which rules out the game reading it span-sized (a span read would
> desync inside the express and read zeros from there on), while the cut three
> slots later rules out a plain stop-sized read being the whole story. The
> exporter therefore stays as it is, mitigation included, and issue #740 stays
> open on the read-side question. The cut is not the columns: relocating the
> tower's two duplicate columns does not move it.
>
> **Not settled by this save:** every non-express shaft in it stops at every
> floor it spans, so spanned and serviced predict the same size for them. The
> spanned rule for standard and service still rests on the 2026-07-13
> measurement below.

> **Corrected (Verticopolis RE, 2026-07-13, Wine harness vs the real 1994
> game):** the appended 348-byte block appears **ONCE per built shaft, not once
> per car**. The old `* cars` stride was only ever validated on 1-car saves
> (my_tower and every other native reference save we have is cars=1), where
> `* cars == * 1` is indistinguishable from a fixed block. On a multi-car tower
> (the owner's "six seven": shafts up to 8 cars), `348 * cars` over-sized every
> multi-car shaft, so the retail game desynced the whole elevator table after the
> first such shaft: **only one elevator rendered, and the parking/basement block
> that follows the table mis-read too.** Forcing the payload to the fixed size
> (car count kept in the header) made all shafts render in the real game.
> Fixed in `tdtExport.ts` + `tdtFormat.ts` (and the `tdtBuilder` test fixture).

> **Corrected (Verticopolis RE, 2026-07-31, Wine harness vs the real 1994
> game):** the 324-byte per-floor entries run over the shaft's **whole span**
> (`bottomFloor..topFloor` inclusive), NOT over the floors it stops at. The
> serviced-floor reading was indistinguishable on every reference save we had,
> because each of their shafts stopped at every floor it passed
> (`serviced == spanned`), the same blind spot that hid the `* cars` bug: both
> old rules were only ever checked where the two coincide. A tower whose express
> shaft skipped 83 of its 91 floors under-ran that shaft's payload by
> `83 * 324` bytes and desynced the rest of the table, so the retail game
> dropped every shaft after it. Measured with a 4-shaft test tower whose second
> shaft skips five floors: sized by serviced floors the game rendered **2 of 4**
> shafts (and the tower sat dark and unpopulated); sized by spanned floors it
> rendered **4 of 4**, with the skipping shaft correctly showing no stops on its
> skipped floors. Fixed in `tdtEncoder.ts`, `tdtTail.ts`, and the `tdtBuilder`
> fixture; guarded by a payload-length test in `tdtExport.integration.test.ts`.

> **Measured (Verticopolis RE, tools/simtower round-trip vs the real 1994 game):**
> the fixed appended block is **3,140 bytes**, not the 480 + 2 * 120 = 720 this
> doc previously estimated. Walking the three shafts in a real save (my_tower.TDT)
> with the 720 figure desynced the table after the first shaft and forced the
> importer to synthesize fake elevators; the 3,140 figure reproduces every
> shaft's exact file offset (`src/storage/tdtFormat.ts` `TDT_ELEVATOR_BUILT_FIXED`).
> **The `type` byte @1 is the authoritative kind signal, NOT the capacity byte
> @2:** in that save a service shaft (type = 2) carried a capacity byte of 21
> (the standard value, not service's 10), so the capacity byte is unreliable for
> the kind. The importer reads kind from `type` and takes per-car capacity from
> the engine's canon table (`transportCarCapacity`), not from byte 2.

> **Resolved (v1.9.5):** the canon per-car capacities are express 42, standard
> 21, service 10 (`src/tests/integration/canon.integration.test.ts` pins all three). Note the on-disk
> capacity byte @2 does not reliably carry these per kind (see the measured note),
> so we do not read the kind from it.

> **Writer note (harness-confirmed).** The 56-byte schedule block @4 is
> load-bearing on export: the game dispatches cars from it, and a **zero-filled**
> block reads as "run no cars", so an exported shaft loads with **no cars** and
> traps everyone. Every built shaft in a sampled real save carried the identical
> default block **`0x01`×14, `0x05`×14, `0x00`×28**; the exporter emits that
> (`TDT_ELEVATOR_SCHEDULE_DEFAULT`) so exported shafts run. The precise per-hour
> WD/WE scheduling model (the elevator editor strip) is a separate feature; see
> the backlog's `elevator-scheduling`.

### Stairs / escalators

A fixed **64-entry** table (10 bytes each: built flag u8, type u8, left tile
u16, floor u16, people-up count u16, people-down count u16), confirming the
shared 64-link walkway pool. **Type field [TD]:** 0 = escalator, 1 = stairs,
2/3 = two-story escalator/stairs, 4/5 = three-story escalator/stairs. The game
packs the built flights into the table's **high slots** (a real save with 6
flights held them in slots ~58–63), so a reader must scan all 64 slots, not stop
at the first empty one.

> **Located by signature, not by offset (Verticopolis RE):** the blocks between
> the elevator table and this stairs table (the finance block §9 and the
> parking/lobby region §10+) are not yet pinned down across saves. In a real save
> the stairs table sat **436 bytes before** the offset we got by summing
> finance (132) + parking (1,026), so the old arithmetic read zeros and lost
> every flight. `src/storage/tdtFormat.ts` `locateStairs` now finds the table by
> scanning from the end of the elevator table for the 64-record window (empty or
> in-range built) that holds the most flights. Finance is still read at its known
> size (its last i32 carries the tower population total), but the stairs no
> longer depend on landing exactly after the parking block.

> **Canon question for review:** the format *supports* 2–3-story walkway
> variants; neither source says whether the shipped game ever creates them. Our
> canon (CLAUDE.md) holds walkways to a fixed two-floor flight. Do not change
> engine behavior on format evidence alone; verify against the real game first.

## 9. Finance block (132 bytes = 33 × i32) [TD]

Ten income lines (Office, Single, Twin, Suite, Shops, Fast Food, Restaurant,
Party Hall, Theatre, Condo), ten population lines (plus a tower total), a total
income, ten expense lines (Lobby, the three elevator kinds, Escalator, Parking,
Recycling, Metro, Housekeeping, Security), and a total expenses.

## 10. Parking (1,026 bytes) [TD]

A u16 **connected**-stall count (excludes stalls with no ramp path; the
original really did track ramp connectivity) followed by 512 u16 stall indices.
Max stalls: **512**.

## 11. Lobby / reachability table (528 × 6 bytes) [TD]

512 per-unit entries plus 16 lobby entries; each lobby entry carries a 24-bit
elevator bitmask (bit N ⇒ elevator N serves this lobby) and the lobby's floor.
Lobbies observed at in-game floors 1, 15, 30, 45, 60, 75, 90: the canon
15-floor sky-lobby ladder (§4's floor-mapping proof).

> **Writer note (harness-confirmed).** The game reads a trailing region here
> after the stairs table, whose extent depends on the file's own content (see
> the size note below); if the file ends too early (as our exporter used to,
> right after the stairs table) it reads past EOF and page-faults (0x0799). The
> exporter now emits this region **`0xFF`-filled** (the empty-slot sentinel) out
> to `TDT_ROUTING_TAIL_SIZE`: zero-filling instead is read as live routing data
> and invents a phantom population, while `0xFF` reads as "all slots empty" so
> the game rebuilds reachability from the floor map. Blanking this whole region
> to `0xFF` in a real save still loads, so its live content is not required on
> read; only its presence and size are.
>
> **Size, measured further at 4★ (2026-08-04).** The fixed
> `TDT_ROUTING_TAIL_SIZE` over-emit holds at 4★: three variants of a 4★
> 23-shaft export (399,256 / 399,263 / 453,047 bytes; the last is the earlier
> 453,040 export plus the 7-byte §12a trailer) all load in the retail game with
> no 0x0799 crash and can be re-saved. (Two of those loads lose shafts, a §8
> elevator-payload matter, not a tail one.) And no FIXED extent is required on
> read: the game's own re-save of the degraded 8-shaft load is 247,774 bytes
> with only **5,672 bytes past its elevator table** (that span covers stairs,
> finance, parking AND this region, all zeros), and the game re-opens that file
> cleanly. A fixed 25,600-byte read after the stairs table would run off that
> file's end, so the extent the game reads depends on the file's own content.
> Because that small file comes from a degraded load, it bounds the extent only
> for its own content; healthy-content extents at 5★/6★ remain unvalidated, and
> over-emitting the fixed constant remains the safe side of every measured case.
> See the backlog's `tdt-export-routing-tail`.

## 12. Named tenants / people

16-byte fields holding null-terminated names, **max 15 characters** [OS]; the
header carries named-unit and named-people counts (§1). The name↔tenant
linking mechanism is undocumented.

## 12a. Our own trailer (NOT part of the 1994 format)

Everything above describes the original's format. This section describes bytes
**we** add, which the 1994 game never wrote and never reads.

A `.TDT` Verticopolis writes ends with a small trailer: the ASCII magic
`VCTDT`, then a **u16 generation** (little-endian, like every other word here).
Generation `1` is the spanned-floor elevator payload (§8), which our writer uses
for every kind, express included. An UNSTAMPED file gets no such statement and
is decided by the structural reasoning described under "Reading it" below: it
may be a save the 1994 game wrote, or one of ours from before the trailer
existed, and those two want different rules.

**Why.** A `.TDT` carries no statement of who wrote it, so when our own writer's
layout changed, the importer had to *infer* which of our writers produced a file
by hunting for structures at known offsets. That inference took four review
rounds to make safe and still cannot cover every shape (see the backlog's
`tdt-legacy-pre-tail-import`). The trailer replaces the inference with a fact for
every file written from here on. It does nothing for files already in the wild.

**Where, and why there.** After the routing region, at the very end of the file.
That is the one place bytes can be added without disturbing anything the game
walks: it reads a fixed extent and ignores trailing slack, which is already
proven at scale (our exports run ~150 KB past the game's own re-saves and load
fine). **Harness-verified 2026-08-04:** a stamped 4★ export loads in retail
SimTower and renders identically to the same tower unstamped, with its rating,
funds, population and the same shafts as the unstamped load (both lose the second express to the §8 desync).

**Reading it.** A file whose last bytes are not the magic is unstamped: either
one of ours from before the trailer, or a save the game wrote. Both fall back to
the structural reasoning in `chooseLayout`. A reader must never REQUIRE the
trailer, and the game's own re-save of one of our files will not carry it.

Only a generation the reader KNOWS is a shortcut. A generation from a later
build, or a garbled trailer, falls back to the same structural reasoning an
unstamped file gets. The trailer exists because a later writer may lay the bytes
out differently, so reading an unknown generation as "current" would assert the
one thing it cannot know. A stamp can only ever help, never mislead.

## 13. Caveats for the importer

- The original game barely validates its own saves; treat every count and
  offset as hostile input (size ceilings, caps before loops, typed errors).
- `currentDay` is signed; negative values are representable.
- Multi-story units arrive as per-floor parts; merge them (§5).
- Mac-version byte order is unknown; assume Windows little-endian only.
- Everything after the floor map floats; walk, don't seek.
- Where the sources conflict ([OS] vs [TD]), this page names the better-evidenced
  reading; keep both tags when editing so future verification knows what to check.

## 14. Round-trip canonicalization (export → import is not always the identity)

`.vctower` is our lossless save; TDT is the lossy 1994 interop format. Exporting
to TDT and reading it back can return a tower that differs from the source in
ways the format cannot represent, so the importer canonicalizes to what TDT
*can* mean. Two known, benign cases (observed in the engine's own
`buildTDT`/`parseTDT` round-trips and pinned by the TDT storage integration
tests; the first is also confirmed against the live 1994 game, see below), both
engine-behavior only, not data loss:

- **Sky-lobby stories normalize to lobbies.** A plain floor tile placed on a
  sky-lobby story (floors 15, 30, 45…) exports byte-identically to a sky lobby
  there (the format carries no floor-vs-lobby distinction at those stories), so
  it reads back as a lobby. This only surfaces when a source tower has bare floor
  tiles on a sky-lobby story with no lobby, which the running game does not
  produce; a real save's sky-lobby stories already carry their lobby.
- **Built retail arrives tenanted.** A freshly placed, never-simulated shop with
  no `subtype`/tenant yet (the "legacy look" state) comes back `occupied` with a
  concrete retail `subtype`, because TDT has no representation for a vacant built
  retail cell (canon retail is always tenanted). A simulated tower's shops
  already carry their subtype, so a normal save round-trips unchanged.

Both are one-way to the canonical form and stable thereafter: a second
export → import is byte-identical (the round-trip reaches a fixed point after the
first import). Do **not** "fix" these by teaching `parseTDT` to reconstruct the
pre-canonical state; that would encode a tower the format cannot hold and the
game will not show. The first case is **confirmed against the live 1994 game**
(Wine harness, 2026-07-19): our type-24 export of a sky story renders as a proper
sky lobby (the game draws the lobby arches), and every sky lobby the game writes
in its own save is a type-24 record, never bare floor (feeding the game a raw
type-0 record there draws empty floor, but the exporter never emits that). See
the backlog `tdt-roundtrip-canonicalization` (#319).
