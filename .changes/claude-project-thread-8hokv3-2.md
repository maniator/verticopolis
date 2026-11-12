---
app: minor
crate: minor
readmes: unchanged
---
## Player
- Modern: while you place a fitness club, spa or daycare, green bands mark the floors it helps, strongest nearest; a nightclub shows violet bands for the floors its noise reaches at night (#1980).
- Modern: while you place a shop, restaurant, other noisy venue or office, a violet band along its floor shows how far its noise carries to the rooms beside it; placing an office, condo, apartment or hotel room shows in amber the stretch that should stay clear of noisy neighbors. Both stop at a lobby, as the noise does.
- Modern: inspecting a condo, apartment or hotel room now names the amenity helping it most, and how much happier it can be when noise, a far lobby or too few shops hold it back.
## Engine
- New `rules::Halo` and `HaloEffect`, with `GameMode::halos()`, `halo_of(kind)` and `halo_strength(halo, d, family_size)`: the Modern venues' cross-floor halos (fitness club, spa, daycare, nightclub) as one table, which a rule test holds the hourly satisfaction step to, kind by kind. Classic has none.
- The catalog's facility entries gain `halo` (effect, floors, max, capLift, feltBy, openHoursOnly, familyScaled), null for a venue with none; `CATALOG_VERSION` is 13.
- New `rules::NoiseRule`, `NOISE_RULES` and `noise_rule_for(kind)`: the same-floor noise rule (which rooms hear which neighbors, and over how many tiles) as one table, which the noise scan now reads in both modes, and `GameMode::shows_noise_reach()` (Modern). The catalog's facility entries gain `noise`, a list of `{ role: "carries" | "hears", tiles, kinds }`, empty in Classic.
- `DiagnosticFacts` gains `amenity` (the venue's kind key and its ceiling lift), and `unitFacts` gains the `amenity` (kind code) and `amenityLift` slots, so `VIEW_LAYOUT_VERSION` is 17. No conformance scenario moves; the catalog digests do.
