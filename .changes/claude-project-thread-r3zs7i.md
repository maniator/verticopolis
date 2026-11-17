---
app: patch
crate: patch
readmes: unchanged
---
## Player
- The elevator schedule's busiest-floor markers, its "Most riders board on" note and Auto-tune now count everyone who gets on, so a cinema or party hall floor can show up as a busy floor, a service elevator no longer counts the same waiting staff twice, and Auto-tune aims its up-tower cars at the busiest floor above the lobby even when the lobby is busier.

## Engine
- Every crowd rider who boards an elevator joins the shaft's origin tally (`Crowd::elevator_boardings`, renamed from `commuter_boardings`), and the dispatch tallies only the waiting estimate's riders, no longer a staff car's callers (#477). Auto-tune's staging aim picks the busiest boarding floor above the base lobby, since the lobby now counts every crowd rider coming in. The tally is counting only: the conformance lock and every golden are unchanged.
