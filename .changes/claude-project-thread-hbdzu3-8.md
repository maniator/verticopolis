---
app: patch
crate: patch
readmes: unchanged
---
## Player
- A shop or restaurant's card now judges yesterday's business against what that day of the week usually brings, so a normal weekend no longer reads as booming (or a quiet one as very few customers).
- The local demand figure rounds down, so it no longer shows 100% without the "another venue would still sell" tip, or 50% beside the "more retail than its shoppers fill" tip.
- In Modern, the tower-wide retail tip no longer argues with the venue's own verdict: a slow venue in a busy tower is told shoppers are not reaching it, and a booming one in an over-built tower is told it is the exception.

## Engine
- `service_diagnostic_facts`: the retail tier reads yesterday's patronage against a baseline scaled by `weekend_multiplier` for the day yesterday was (venues with an attendance cap keep one baseline), and `localDemandPct` is rounded down instead of to the nearest (#549).
