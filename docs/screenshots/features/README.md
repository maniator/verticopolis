# Waste & parking feature screenshots

Captured from the built app (a 3★ demo tower: office block, three hotel suites,
a basement garage and a Recycling Center).

| Screenshot | Shows |
|---|---|
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
| `overlay-cleanliness.png` | **Housekeeping** mode: hotel rooms tinted by service coverage: green where a housekeeping crew can reach them, amber for dirty rooms waiting, red for floors with no service-elevator route (the "build another housekeeping station" nudge). |
| `overlay-picker-ui.png` | The **🗺️ Map overlay** dropdown in the Tower panel (below Full Statistics); every mode is directly selectable. |

## Metro station (routed commuters + the train)

Captured from the built app via the unified generator (`scripts/screenshots.ts`, `metro` scene) on the hero
tower during the morning rush. The station is the high-platform composition: a
double-height concourse over a one-story track trough, with the platform deck
on the module's middle story, where the crowd engine stands routed commuters.

| Screenshot | Shows |
|---|---|
| `metro-platform-waiting.png` | The platform mid-rush with the track empty: commuters who rode down (or just stepped off the last train) wait at the yellow edge among the benches, posters, and vending machines. |
| `metro-station-train.png` | The consist pulled in: coupled cars with lit window bands and door pairs at the crowd, the red livery stripe running the platform's length. |

## Traffic congestion chip (peak-driven + hotspot floor)

Captured from the built app via the unified generator (`scripts/screenshots.ts`, `traffic` scene) on an identical jammed
tower (three office floors slammed onto one weak elevator, peak congestion 2.07).

| Screenshot | Shows |
|---|---|
| `traffic-chip.png` | **Gridlock · 11F**: the chip tiers on peak per-floor congestion (matching the overlay legend) and names the hotspot floor on one line, tier word bold and the floor a lighter footnote. |
| `traffic-chip-mobile.png` | The same state at phone width: the HUD wraps its stats onto rows and the chip (glyph + tier + floor) reads cleanly there too. |

## Tablet responsive breakpoint

Captured via the unified generator (`scripts/screenshots.ts`, `tablet` scene; full app at several viewport sizes).
A new tablet tier (`768–1023px` wide and `≥600px` tall) keeps the desktop
3-column layout (tool palette and panels stay docked) instead of the phone
bottom-strip + drawer, and wraps the top bar so nothing clips.

| Screenshot | Shows |
|---|---|
| `tablet-portrait.png` | 834×1112 (portrait tablet): the tablet layout (Tools docked left, SELECTED/TOWER/BULLETIN/GAME docked right, stats on a tidy second row). |
| `tablet-compact.png` | 1000×720 (compact band): the top bar wraps cleanly (brand on one line, all buttons visible) and the columns tighten so the canvas keeps room. |

## Crash screen (context-loss recovery with a crash report)

Captured from the built app via the unified generator (entrypoint `scripts/screenshots.ts`; the
`crash-screen` scene is defined in `scripts/screenshot-scenes.ts`) on a phone-sized viewport: a full canon
tower running, then the same hook the engine raises when the GPU drops the WebGL context.

| Screenshot | Shows |
|---|---|
| `crash-screen.png` | The crash card that replaced the silent auto-reload (v1.20.0): what happened, the save status, **Download crash report** (a zip with the crash details and the tower save), **Report a bug** (prefilled GitHub issue form), and **Reload game**. |
