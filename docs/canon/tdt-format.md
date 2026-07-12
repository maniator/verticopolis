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
`src/tests/canon.test.ts` asserts our engine constants against this page so
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

**Unit record (18 bytes):** left/right extents in segments (u16 each; one
segment = one of our tiles; half-open range); type byte (§5; negative ⇒ under
construction [OS]); a flags byte (bit-mapped hotel state [TD]: bits for occupant
count, booked-but-empty, occupied-overnight, dirty, bug-infested); ~10
undocumented bytes; a **rent/lease byte** (0 = Very Low, 1 = Low, 2 = Average,
3 = High, 4 = No Rate) [TD]; and a final byte holding **hotel days-dirty (0–2)
or the shop variant (0–10)** [TD].

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
| 48 | Burned area (fire/bomb damage) | cleared floor (report) |

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
the canon we care about. (The variant is also mirrored on the unit record's
final byte, §4.)

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
entries** (per serviced floor: waiting-up/down counts + up to 40 queued person
indices each way), then **348-byte per-car entries** (per car: current floor,
passenger count, turnaround floor, up to 42 passenger indices, their destination
floors, and per-floor destination counts). So one built shaft's record stride is
`194 + 3140 + 324 * servicedFloors + 348 * cars`.

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
> 21, service 10 (`src/tests/canon.test.ts` pins all three). Note the on-disk
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

> **Writer note (harness-confirmed).** The game reads a fixed trailing region
> here after the stairs table; if the file ends early (as our exporter used to,
> right after the stairs table) it reads past EOF and page-faults (0x0799). The
> exporter now emits this region **`0xFF`-filled** (the empty-slot sentinel) out
> to `TDT_ROUTING_TAIL_SIZE`: zero-filling instead is read as live routing data
> and invents a phantom population, while `0xFF` reads as "all slots empty" so
> the game rebuilds reachability from the floor map. Blanking this whole region
> to `0xFF` in a real save still loads, so its live content is not required on
> read; only its presence and size are. The exact per-tower size for larger
> (3★+) towers is not yet pinned; see the backlog's `tdt-export-routing-tail`.

## 12. Named tenants / people

16-byte fields holding null-terminated names, **max 15 characters** [OS]; the
header carries named-unit and named-people counts (§1). The name↔tenant
linking mechanism is undocumented.

## 13. Caveats for the importer

- The original game barely validates its own saves; treat every count and
  offset as hostile input (size ceilings, caps before loops, typed errors).
- `currentDay` is signed; negative values are representable.
- Multi-story units arrive as per-floor parts; merge them (§5).
- Mac-version byte order is unknown; assume Windows little-endian only.
- Everything after the floor map floats; walk, don't seek.
- Where the sources conflict ([OS] vs [TD]), this page names the better-evidenced
  reading; keep both tags when editing so future verification knows what to check.
