# Waste & parking feature screenshots

Captured from the built app (a 3★ demo tower: office block, three hotel suites,
a basement garage and a Recycling Center).

| Screenshot | Shows |
|---|---|
| `parking-garage-day.png` | Weekday afternoon: office workers' cars fill the garage bays across both basement decks. |
| `parking-garage-predawn.png` | Pre-dawn (04:30): the same decks nearly empty once the office cars have gone; only overnight suite-guest cars remain. |
| `garbage-truck-collection.png` | The garbage truck loading at the Recycling Center during the 05:00 collection; the dead (unchained) parking space keeps its red X with no cars. |
| `recycling-filling.png` | The Recycling Center late in the day: garbage bags piled up with the green→amber→red wall fill gauge. |
| `inspector-recycling.png` | Hover inspector on the Recycling Center: live fill %, and the capacity/demand-met verdict. |
| `stats-dialog-demand.png` | Tower Statistics: the new parking-demand row (offices + suites) and the recycling load row. |

## Stats screenshots (income breakdown, elevator load, colored overlay maps)

Captured on a real player tower (Star 3, ~day 1025: 96 offices, 153 condos, 188
hotel rooms, a cinema, shops, food, 5 elevators) after warming up a quarter.

| Screenshot | Shows |
|---|---|
| `stats-income-elevators.png` | Tower Statistics with the new **Income (avg/day, last quarter)** breakdown per category (net of overhead) and the **Elevators (avg load, busiest first)** utilization section. |
| `overlay-congestion.png` | The colored stats overlay in **Congestion** mode: floors tinted green (clear) → red (jammed) with a legend. |
| `overlay-occupancy.png` | **Occupancy** mode: green where fully leased (offices/condos), red/amber on the hotel floors that sit empty at midday. |
| `overlay-satisfaction.png` | **Satisfaction** mode: green for happy tenants; floors with no one present are left untinted (no happiness to judge). |
| `overlay-picker-ui.png` | The **🗺️ Map overlay** dropdown in the Tower panel (below Full Statistics); every mode is directly selectable. |

## Condo rule-sets (Classic vs Modern)

Captured from the built app via `scripts/shot-condo-modes.mjs`.

| Screenshot | Shows |
|---|---|
| `condo-modes.png` | Both of the below stacked into one captioned figure (handy for embedding in a single image slot). |
| `new-tower-modes.png` | The **Found a New Tower** rule-set picker: Classic (faithful 1994: flat family of 3, 2×–2.5× price, owner buy-back) vs Modern (variant 2–5 households), with the permanence notice. The choice is fixed for the tower's life. |
| `stats-households-modern.png` | Tower Statistics on a Modern tower: the conditional **Households** section: people housed, average household, and the size mix across sold condos. (Classic towers don't show this section.) |

## Traffic congestion chip (peak-driven + hotspot floor)

Captured from the built app via `scripts/shot-traffic.mjs` on an identical jammed
tower (three office floors slammed onto one weak elevator, peak congestion 2.07).

| Screenshot | Shows |
|---|---|
| `traffic-chip-before.png` | Pre-fix build: the HUD chip reads **Smooth** on a genuinely jammed tower, because it tiered on the tower-wide *average*, which stays under the old 1.0 threshold. |
| `traffic-chip-after.png` | This change: **Gridlock · 11F**: the chip tiers on peak per-floor congestion (matching the overlay legend) and names the hotspot floor on one line, tier word bold and the floor a lighter footnote. |
| `traffic-chip-after-mobile.png` | The same state at phone width: the HUD wraps its stats onto rows and the chip (glyph + tier + floor) reads cleanly there too. |

## Build palette: unlock visibility (locked tiers hidden until earned)

Captured from the built app via `scripts/shot-palette-unlock.mjs`. Parity with the
1994 original: locked facilities are hidden until their star tier is reached, so
the palette grows as stars are earned rather than showing dimmed, unbuildable rows.

| Screenshot | Shows |
|---|---|
| `palette-unlock.png` | The three below stacked into one captioned figure (handy for embedding in a single image slot). |
| `palette-1star.png` | A fresh **1★** tower: only the 1★ tools, and the Leisure / Services / Special group headers are absent (nothing unlocked in them yet). |
| `palette-3star.png` | **3★**: the Leisure and Services headers appear and the 2★/3★ rows (Single/Double/Suite, Restaurant, Retail Shop, Escalator/Service/Express, parking, medical, recycling) are revealed. Special is still hidden. |
| `palette-5star.png` | **5★**: the full palette: the Special group (Metro Station, Wedding Hall) is now unlocked too. |

## Tablet responsive breakpoint

Captured with `scripts/shot-tablet.mjs` (full app at several viewport sizes).
A new tablet tier (`768–1023px` wide and `≥600px` tall) keeps the desktop
3-column layout (tool palette and panels stay docked) instead of the phone
bottom-strip + drawer, and wraps the top bar so nothing clips.

| Screenshot | Shows |
|---|---|
| `tablet-portrait-before.png` | 768×1024 (portrait tablet) **before**: the phone UI (tools in a bottom strip, panels hidden behind the ☰ drawer). |
| `tablet-portrait-after.png` | 768×1024 **after**: the tablet layout (Tools docked left, SELECTED/TOWER/BULLETIN/GAME docked right, stats on a tidy second row). |
| `tablet-compact-before.png` | 900×700 (compact band) **before**: desktop layout cramming. The brand wraps to two lines and the right speed buttons clip off. |
| `tablet-compact-after.png` | 900×700 **after**: the top bar wraps cleanly (brand on one line, all buttons visible) and the columns tighten so the canvas keeps room. |
## SimTower-1994 segment-width parity + save migration (`towerone_6`)

Captured from the built app via `scripts/shot-migration.mjs` on the real
`towerone_6` save the initiative began with: loaded twice, once with the v1→v2
reflow skipped ("before") and once applied ("after"), so the change is honest.

| Screenshot | Shows |
|---|---|
| `parity-migration-before.png` | The whole 57-floor tower with the reflow **skipped**: rooms at their pre-canon widths. |
| `parity-migration-after.png` | The same tower **migrated** to canon 1994 segment widths. Deliberately near-identical at full zoom: the reflow is minimum-disruption by design (rooms hold their anchors; only widths change). |
| `parity-migration-parking-before.png` | Basement parking pre-migration: narrow 6-wide ramps (short diagonals) and 6-wide spaces. |
| `parity-migration-parking-after.png` | Basement parking after canon widths: ramps widen 6→16 (the long diagonals now span each level) and spaces narrow 6→4, the whole basement reflowed. This is the clearest read on the change, and where the initiative started ("why does each parking spot only add one spot?"). |
