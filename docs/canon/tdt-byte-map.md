# Canon reference: the `.TDT` byte map

Every byte of a SimTower `.TDT` save, in file order: what we know, what we only
suspect and what nobody has decoded yet. [`tdt-format.md`](./tdt-format.md) is the
narrative reference (how the codec uses the file); this page is the table of
bytes. The two must agree. Where they differ, fix both in the same change.

**Snapshot.** Written 2026-10-30 from the nine game-written saves in
`conformance/fixtures/tdt-reddit/`, the game's own re-saves of our exports
(`pc-verify/ground-truth` in the project files) and the public specs. It is a
snapshot of what we knew that day. The live evidence is the fixtures plus
`engine-rs/tests/tdt_real_saves.rs`; re-measure there before trusting a
"constant in every save" claim for a save the nine do not cover.

**Sources.** **[OS]** OpenSkyscraper's notes, **[TD]** dfloer/tower-docs
(`tdt_spec.md`, CC-BY-SA 4.0), **[RE]** measured by us on the nine saves. No code
or text from either upstream is copied, and the original game's source and
binaries were not read (clean room, see `tdt-format.md`).

**Confidence.**

- **Known**: seen in every save and checked against the game's own display or a
  harness re-save.
- **Inferred**: consistent across all nine saves, meaning deduced from the
  values; not confirmed in the game.
- **Unknown**: the bytes are mapped (we know where they are and how they vary)
  but not what they mean. Listed with the values seen.

The nine saves: TOWER1 to TOWER8 and MYTOWER (u/invokes). Counts below that say
"all nine" count those files only. Offsets inside a block are decimal from the
block start unless written `0x`.

All integers are little-endian. After the floor map nothing sits at a fixed
offset: walk the blocks in order.

---

## 1. Whole file, in order

| # | Block | Size (bytes) | Notes |
| --- | --- | --- | --- |
| 1 | Header | 560 | 66 bytes used, the rest zero in all nine saves |
| 2 | Floors 0 to 119 | `6 + 18 n + 188` each | n = unit count of that floor |
| 3 | People | `4 + 16 N` | N is a pool size (multiple of 256 in game saves) |
| 4 | Retail table | 9,216 | 512 rows of 18 |
| 5 | Elevator slots 0 to 23 | 194 empty, `194 + 720 + 324 k + 2,768` built | k = floor entries (section 6) |
| 6 | Statistic words | 88 | 22 x i32 |
| 7 | Finance | 132 | 33 x i32 |
| 8 | Undecoded flags | 12 | |
| 9 | Undecoded bytes | 42 | |
| 10 | Parking | 1,026 | u16 count + 512 x u16 |
| 11 | Clinic list | 22 | u16 count + 10 x u16 |
| 12 | Stairs and escalators | 640 | 64 x 10 |
| 13 | Tail | 17,242 (+48 with named units) | sparse routing state, section 8 |
| 14 | Our stamp | 7 | `VCTDT` + u16, exports only; never part of the 1994 file |

Every offset in blocks 6 to 12 is fixed relative to the end of block 5 (call it
F): statistic words F+0, finance F+88, flags F+220, bytes F+232, parking F+274,
clinic list F+1,300, stairs F+1,322, tail F+1,962.

---

## 2. Header (560 bytes)

Only bytes 0 to 65 are ever non-zero in the nine saves. Bytes 66 to 559 are
zero in all of them (no field known there).

| Off | Size | Field | Values seen | Meaning | Status |
| --- | --- | --- | --- | --- | --- |
| 0 | u16 | magic | `0x2400` | File signature | Known |
| 2 | u16 | level | 1 to 6 | Star rating; 6 = TOWER | Known |
| 4 | i32 | balance | | Funds; shown x100 | Known |
| 8 | i32 | otherIncome | 5,000 in TOWER1, else 0 | Finance window "other income" line; SimTower zeroes it on save (TOWER1) | Inferred |
| 12 | i32 | constructionCosts | | Finance window line; SimTower zeroes it on save (non-zero in TOWER1, 2, 5 and 6, zero after the game's own re-save) | Inferred |
| 16 | i32 | lastQuarterMoney | | Finance window line; changes as the game runs | Inferred |
| 20 | u16 | tick | 0 to 2,599 | Time of day; changes as the game runs | Known |
| 22 | i32 | day | | Day counter, signed; changes as the game runs | Known |
| 26 | u16 | unknown | 1 in TOWER2 only, else 0 | | Unknown |
| 28 | u16 | lobbyHeight | | Ground lobby height in floors | Inferred |
| 30 | u16 | unknown | 2 in the 4 and 5 star towers, `0xFFFF` in the 3 star tower | Star-related; could be a rating-state flag | Unknown |
| 32 | u16 | unknown | `0xFFFF` in all nine | | Unknown |
| 34 | u16 | unknown | `0xFFFF` in all nine | | Unknown |
| 36 | u16 | unknown | 145, 145, 52, 52, 150, 150, 150, `0xFFFF`, 117 (TOWER1 to MYTOWER order) | Looks like an x position tied to the ground lobby; TOWER8 (no elevators) has `0xFFFF` | Unknown |
| 38 | u16 | windowX | | Saved viewport X in world pixels | Inferred |
| 40 | u16 | windowY | | Saved viewport Y | Inferred |
| 42 | u16 | recyclingCount | | Recycling centers; equals the unit count in every save | Known |
| 44 | u16 | unknown | 0 in all nine | | Unknown |
| 46 | u16 | commercialCount | | Shops + restaurants + fast food; equals the unit count except TOWER3 (48 here, 38 units) | Inferred |
| 48 | u16 | securityCount | | Security offices (max 10) | Known |
| 50 | u16 | parkingStallCount | | All stalls, connected or not | Known |
| 52 | u16 | clinicCount | | Medical clinics; equals the clinic list count | Known |
| 54 | u16 | hallCinemaCount | | Party halls + cinemas (TOWER3: 12 here, 11 units) | Inferred |
| 56 | u16 | namedUnits | | Custom-named tenants | Inferred |
| 58 | u16 | namedPeople | 0 in all nine | Custom-named people | Unknown |
| 60 | u16 | unknown | 0 | | Unknown |
| 62 | u32 | bomb | 0 | Floor and position while a bomb event runs [TD] | Unknown |

Comparing each original with SimTower's own re-save (TOWER1, 2, 5, 6, 7): only
bytes 4 to 7 and 16 to 22 change because the game keeps running, bytes 12 to 15
(and 8 to 11 in TOWER1) are zeroed, and byte 2 (stars) never changes. No 1-star
or 2-star save exists to test, so header 30 across those levels is still
unchecked.

Open question: bytes 26, 30, 32, 34, 36, 44, 60 and the zero tail (66 to 559).
TOWER3's two count mismatches (46 and 54) suggest the counts are running
counters the game does not always keep in step with the floor map.

---

## 3. Floors (120 records)

Each floor: 6-byte header, `n` unit records of 18 bytes, a 188-byte remap.

| Off | Size | Field | Meaning | Status |
| --- | --- | --- | --- | --- |
| 0 | u16 | n | Unit records on this floor | Known |
| 2 | u16 | left | Smallest `left` of the floor's units | Known |
| 4 | u16 | right | Largest `right` of the floor's units | Known |
| 6 | 18 n | units | Unit records, ascending `left` | Known |
| 6 + 18 n | 188 | remap | 94 x u16: logical unit id to list index | Known |

`left` and `right` match the units on every floor of every save. The remap maps
the id that people records and retail rows use ("logical id") to the unit's
position in the list; ids are unique per floor. Our exporter writes zeros here
and the game loads that fine; the game's own re-saves rebuild it.

### 3.1 Unit record (18 bytes)

| Off | Size | Field | Values and meaning | Status |
| --- | --- | --- | --- | --- |
| 0 | u16 | left | First tile | Known |
| 2 | u16 | right | End tile, half open | Known |
| 4 | u8 | type | Section 6 of `tdt-format.md`. As a signed byte, negative = under construction: 226 and 227 are a Party Hall under construction (-30, -29) in TOWER3 | Known |
| 5 | u8 | state | Hotels: bits 3 and 4 stay state (1 checked in, 2 asleep, 3 vacant and clean), 0x20 dirty, 0x40 infested, low 2 bits guests inside now; the finance guest lines count rooms in stay state 1 or 2 at full complement (section 7.2). Offices and condos carry a nonzero value while occupied | Known for hotels |
| 6 | u8 | variant | Shop, restaurant and fast-food style | Known |
| 7 | u8 | unknown | 0 everywhere except parking stalls (0 or 1) | Unknown |
| 8 | u32 | counter | High 16 bits always 0; values up to about 9,500; per-unit counter or timer | Unknown |
| 12 | u8 | small count | 255 on units that are not rooms; a small count on rooms | Unknown |
| 13 | u8 | flag | 0 or 1 | Unknown |
| 14 | u8 | usually 1 | | Unknown |
| 15 | u8 | state | 2 normal; 1, 0, 3 seen; 255 on vacant or non-applicable units | Unknown |
| 16 | u8 | rent | 0 Very Low, 1 Low, 2 Average, 3 High, 4 none | Inferred |
| 17 | u8 | live value | 0 for retail, hotels, lobby, security, housekeeping; small nonzero for offices and condos | Unknown |

Multi-story units are one record per floor (parts); the importer merges them.

---

## 4. People (`u32 N`, then N records of 16)

N is a pool size: 9,984 in TOWER2, always a multiple of 256 in game saves. Most
slots are zero; in the nine saves 44,012 records are non-zero.

| Off | Size | Field | Meaning | Status |
| --- | --- | --- | --- | --- |
| 0 | u8 | floor | Home floor index (file index) | Known |
| 1 | u8 | unit | Logical unit id on that floor (through the remap) | Known |
| 2 | u8 | slot | Person number inside the unit | Known |
| 3 | u8 | zero | 0 in every record | Known |
| 4 | u8 | unit type | Type of the home unit | Known |
| 5 | u8 | flags | 32 = belongs to a deleted unit [TD]; other bits not decoded | Inferred |
| 6 | u8 | state a | | Unknown |
| 7 | u8 | current floor | File index; negative means outside [OS] | Inferred |
| 8 to 13 | 6 B | state | Walking, waiting and goal state | Unknown |
| 14 | u16 | stress / evaluation | | Inferred |

Check: for 40,122 of the 44,012 non-zero records the (floor, unit id) pair finds
a unit of the stated type. The 3,890 mismatches are multi-part units: theatre
screens (34 and 35 against the stated 18), party halls (30 against 29).

---

## 5. Retail table (512 rows of 18)

One row per shop, restaurant or fast-food unit. The row count equals the sum of
those units in each save.

| Off | Size | Field | Meaning | Status |
| --- | --- | --- | --- | --- |
| 0 | u8 | floor | Floor index; `0xFF` marks an empty row | Known |
| 1 | u8 | unit | Logical unit id | Known |
| 2 to 12 | 11 B | venue statistics | Customers, income and the like; not decoded | Unknown |
| 13 | u8 | constant | 255 in every row | Known |
| 14 to 17 | 4 B | venue statistics | | Unknown |

---

## 6. Elevator slot (24 per file)

An unbuilt slot is 194 bytes (the header). A built slot is the header plus:

| Part | Size | Count |
| --- | --- | --- |
| Per-floor map | 480 (120 x 4) | 1 |
| Per-floor bytes | 240 (2 x 120) | 1 |
| Floor entries | 324 | k |
| Car blocks | 346 | 8 |

Total `194 + 720 + 324 k + 2,768`. All 146 built shafts in the nine saves have
eight cars, so a dependence of the car-block count on the header's car byte is
neither proven nor ruled out; [TD] says one block per car. Our codec always
writes eight and the game loads it. The spec's per-car size of 348 is wrong by
two: a stride search over every shaft in the nine saves peaks at exactly 346
(16 + 168 + 42 + 120), and 720 + 8 x 346 equals the 3,140 + 348 that older
versions of `tdt-format.md` described as a zero "fixed block".

### 6.1 Header (194 bytes)

| Off | Size | Field | Values and meaning | Status |
| --- | --- | --- | --- | --- |
| 0 | u8 | used | 1 built | Known |
| 1 | u8 | type | 0 express, 1 standard, 2 service | Known |
| 2 | u8 | capacity | 42 or 21 seen; unreliable (a service shaft carried 21) | Inferred |
| 3 | u8 | cars | 8 in all 146 built shafts | Known |
| 4 | 56 B | schedule | Dispatch settings per day type; default `01` x14, `05` x14, `00` x28; all zero = no cars run | Known |
| 60 | u8 | shown | 1 shown, 0 hidden [TD] | Inferred |
| 61 | u8 | reserved | | Unknown |
| 62 | u16 | x | Left tile | Known |
| 64 | u8 | topFloor | File index | Known |
| 65 | u8 | bottomFloor | File index | Known |
| 66 | 120 B | serviced | One byte per floor: 1 the shaft stops there | Known |
| 186 | 8 B | homes | Home floor of each car | Inferred |

### 6.2 Per-floor map (480 bytes, 120 x 4)

One 4-byte entry for every floor index 0 to 119, whether or not the shaft
spans it. Values seen in a standard shaft with floors 10 to 24 and in a 69-floor
express:

| Byte | Content | Status |
| --- | --- | --- |
| 0 | On serviced stop floors an ordinal (1 on the ground lobby, 2, 3, 4, 5 on the next lobbies in order). `0x80` on the first floors above the ground lobby and `0x40` on the floor just below a sky lobby | Unknown |
| 1 to 3 | Constant across all floors between two stops; changes at each stop. Seen: `00 00 00 39`, `00 00 60 00`, `00 00 1e 00`, `00 c0 01 00` (a bit set that differs for each stretch between lobbies) | Unknown |

The pattern looks like a per-stretch bitmask (which local shafts serve the
stretch) laid under the per-floor index. The meaning of the individual bits is
not decoded.

### 6.3 Per-floor bytes (240 bytes, 2 x 120)

Two arrays of 120 bytes. The first is zero in the sampled shafts; the second is
nonzero only at lobby floors (values 3 to 8, for example 5 at index 24 and 7 at
index 39 in TOWER4's express). Not decoded.

### 6.4 Floor entry (324 bytes, k of them)

`k` is every spanned floor for standard and service shafts, and only the
eligible floors for express shafts (file index minus 9 is at most 1 or a
multiple of 15). Layout from [TD], consistent with the nine saves:

| Off | Size | Field | Status |
| --- | --- | --- | --- |
| 0 | u8 | people waiting up | Inferred |
| 1 | u8 | unknown | Unknown |
| 2 | u8 | people waiting down | Inferred |
| 3 | u8 | unknown | Unknown |
| 4 | 160 B | 40 x u32 person indices, down | Inferred |
| 164 | 160 B | 40 x u32 person indices, up | Inferred |

The index arrays are not cleared when a person boards, so stale values are
normal (most entries carry about 40 non-zero bytes in saves from busy towers).

### 6.5 Car block (346 bytes, 8 per shaft)

All eight blocks have byte 15 = 1 in all 146 shafts.

| Off | Size | Field | Status |
| --- | --- | --- | --- |
| 0 | u8 | current floor (file index) | Inferred |
| 1 to 2 | 2 B | unknown | Unknown |
| 3 | u8 | passenger count | Inferred |
| 4 | u8 | unknown, 0 or 1 | Unknown |
| 5 to 6 | 2 B | floor indexes (stop and next stop?) | Unknown |
| 7 | u8 | unknown, 0 or 1 | Unknown |
| 8 | u8 | unknown, many values | Unknown |
| 9 | u8 | unknown, 1 to 9 | Unknown |
| 10 to 12 | 3 B | unknown, mostly 0 | Unknown |
| 13 | u8 | turnaround floor | Inferred |
| 14 | u8 | unknown, 0 to 2 | Unknown |
| 15 | u8 | built, 1 | Known |
| 16 | 168 B | 42 x u32 passenger person indices, `FFFFFFFF` empty | Inferred |
| 184 | 42 B | destination floor per passenger, `FF` empty | Inferred |
| 226 | 120 B | per-floor count of passengers heading there | Inferred |

---

## 7. Blocks after the elevators

### 7.1 Statistic words (F+0, 88 bytes, 22 x i32)

| Word | Content | Status |
| --- | --- | --- |
| 0 to 9 | Ten counters; nonzero only in words 0 and 3 in the nine saves | Unknown |
| 10 | Sum of words 0 to 9 | Known |
| 11 to 19 | Parking lines: 2n, n, n, 2n, n, n, n, n, n for n connected stalls | Inferred |
| 20 | 0 | Known |
| 21 | 11 n, sum of words 11 to 19 | Known |

### 7.2 Finance (F+88, 132 bytes, 33 x i32)

The hotel lines (single, twin, suite) are the number of rooms in stay state 1 or
2 (section 3.1, byte 5) times the complement 1, 2 and 2. Checked on all nine
saves; TOWER2 gives 180, 242 and 81 rooms for lines of 180, 484 and 162.

| Bytes | Content | Status |
| --- | --- | --- |
| 0 to 39 | People per class: Office, Hotel single, Hotel twin, Hotel suite, Shop, Fast food, Restaurant, Party hall, Theatre, Condo | Known |
| 40 to 43 | Total people (sum checked in all nine) | Known |
| 44 to 83 | Income per class, same order | Inferred |
| 84 to 87 | Total income (sum checked) | Known |
| 88 to 127 | Expense: Lobby, Elevator, Express, Service, Escalator, Parking, Recycling, Metro, Housekeeping, Security | Inferred |
| 128 to 131 | Total expense (sum checked) | Known |

### 7.3 Undecoded flags (F+220, 12 bytes)

`00 00 FF FF FF FF 00 00` then four bytes each 0 or 1. Unknown.

### 7.4 Undecoded bytes (F+232, 42 bytes)

Two single bytes, then two groups of ten bytes, then ten u16 values. Unknown;
ten-wide groups suggest a per-security-office or per-clinic table.

### 7.5 Parking (F+274, 1,026 bytes)

`u16` connected-stall count, then 512 x `u16` ascending stall ids (numbered from
0, the rest zero). Header byte 50 counts all stalls. Known.

### 7.6 Clinic list (F+1,300, 22 bytes)

`u16` count (equals header byte 52), then 10 x `u16` clinic ids. Known.

### 7.7 Stairs (F+1,322, 640 bytes, 64 x 10)

| Off | Size | Field | Status |
| --- | --- | --- | --- |
| 0 | u8 | built (1 in use) | Known |
| 1 | u8 | type (0 escalator, 1 stairs; 2 to 5 are multi-story types never seen) | Known |
| 2 | u16 | x (left tile) | Known |
| 4 | u16 | floor (file index of the lower floor) | Known |
| 6 | i16 | crowd going up (signed; `0xFFFB` occurs) | Inferred |
| 8 | i16 | crowd going down | Inferred |

Flights are packed from slot 0 except that TOWER2 leaves slot 20 empty. Flight
counts: TOWER1 1, TOWER2 30, TOWER3 29, TOWER4 29, TOWER5 7, TOWER6 64, TOWER7 64,
TOWER8 0, MYTOWER 37.

---

## 8. Tail (17,242 bytes)

Offsets from the end of the stairs table. The groups below tile the tail with no
gaps (the sizes add up to 17,242).

| Off | Size | Content | Status |
| --- | --- | --- | --- |
| 0 | 3,872 | 8 segments of 484 bytes: 4-byte header then 120 x 4 bytes. Segments 4 to 7 are empty (`00 00 FF FF`). Segments 0 to 3 hold per-floor 4-byte entries (`0x86`, `0x78` values) and a header like `00 01 0A 07` for the ground lobby | Unknown |
| 3,872 | 120 | One flag byte per floor (values 1 to 3), clustered near lobbies and commercial floors | Unknown |
| 3,992 | 20 | Ten security-office locators: floor index u8, logical unit id u8; `FFFF` empty | Inferred |
| 4,012 | 3,072 | 512 parking stall records of 6 bytes: floor index, ordinal, value; count equals the stall count; empty `FF 00 00 00 00 00` | Inferred |
| 7,084 | 96 | 16 lobby records of 6 bytes: pad, 3-byte elevator bitmask, floor, pad; empty `00 00 00 00 FF 00`; seven lobbies in the nine saves (floor indexes 10, 24, 39, 54, 69, 84, 99) | Inferred |
| 7,180 | 40 | Ten clinic records of 4 bytes: floor, extra; empty `FF FF 00 00` | Inferred |
| 7,220 | 192 | 16 housekeeping records of 12 bytes; empty `FE FE ...` | Inferred |
| 7,412 | 120 | Unknown band | Unknown |
| 7,532 | 4,354 | Seven records of 622 bytes: u16 count then u16 lists | Unknown |
| 11,886 | 2,114 | Seven records of 302 bytes: same shape | Unknown |
| 14,000 | 3,234 | Seven records of 462 bytes: same shape | Unknown |
| 17,234 | 8 | Final bytes | Unknown |
| 17,242 | 48 | Three 16-byte null-terminated names, only with named units (TOWER6, TOWER7) | Known |

The seven records match the seven lobby slots. TOWER2's first 622-byte record
holds 30 ascending values. These look like per-lobby routing lists (which floors
or units a lobby feeds), but nothing links their values to anything we can
check.

---

## 9. What is still unknown, and the experiment that settles each

Controlled saves from the game on the PC loop (one change per save, diff against
a baseline). TOWER8 (no elevators) is the nearest baseline we have; an empty
1-star tower would be better.

| Unknown | Experiment |
| --- | --- |
| Header 26, 30, 32, 34, 36, 44, 60 | Save at 1 to 6 stars; move the ground lobby; build the first elevator |
| Unit bytes 7, 8, 12, 13, 14, 15, 17 | One unit per save across ticks (office empty, filled, then after a few days) |
| Cars byte versus car blocks | Build an elevator with 1 car, then add cars; compare slot length |
| Per-floor map bits (6.2, 6.3) | Two shafts that serve different stretches; toggle a floor stop |
| Car block bytes (6.5) | Freeze a tower with cars at known floors and compare |
| Statistic words 0 to 9, flags (7.3), bytes (7.4) | Add one facility at a time and diff |
| Tail segments, 622, 302 and 462 records | Build one lobby, one sky lobby, one of each service; diff |
| 226 and 227 unit types | Find the two units in the saves by floor and compare with the screenshots |
