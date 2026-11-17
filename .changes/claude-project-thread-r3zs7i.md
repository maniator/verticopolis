---
app: patch
crate: patch
readmes: unchanged
---
## Player
- The elevator schedule's busiest-floor markers, its "Most riders board on" note and Auto-tune now count everyone who gets on, so a cinema or party hall floor can show up as a busy floor, and a service elevator no longer counts the same waiting staff twice.

## Engine
- Every crowd rider who boards an elevator joins the shaft's origin tally (`Crowd::elevator_boardings`, renamed from `commuter_boardings`), and the dispatch tallies only the waiting estimate's riders, no longer a staff car's callers (#477). The tally is counting only: the conformance lock and every golden are unchanged.
