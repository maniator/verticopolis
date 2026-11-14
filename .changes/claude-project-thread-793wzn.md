---
app: minor
crate: minor
readmes: unchanged
---
## Player
- Modern towers can now build up to three Metro stations, all on the same line as the first. Riders split between them, someone going back to the train walks to the nearest one, and one train runs the line, calling at each station in turn.
## Engine
- `build_cap_in(mode, kind)` gives a tower's cap per mode, and the Modern catalog publishes a Metro `buildCap` of 3. Every station stands on the first station's row, undo puts a station back beside another, and a returning rider walks to the station nearest their shaft.
