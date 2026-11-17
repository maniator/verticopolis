---
app: patch
crate: patch
readmes: unchanged
---
## Player
- The Traffic view, the Traffic box in the status bar, the morning complaint about elevator waits and a room's card now count how long a floor's people really wait, the same reading that costs tenants. A floor losing tenants to long waits no longer shows as Clear.

## Engine
- `spatialCongestionByFloor` (and every reader built on it: `peakCongestionHotspot`, `floorHeatmap("congestion")`, `congestion()`, the inspector's congestion and the hourly satisfaction pass) raises each floor's transport estimate to its real average commute wait over the mode's limit where that is higher, and lists a floor with only a real wait after the estimate's floors. The 9 AM wait warning reads the same map. The conformance lock and the frame-day golden moved, and the `ransom-declined-classic` scenario now runs 544 hours to its threat.
