---
app: patch
crate: minor
readmes: unchanged
---
## Player
- A recycling center's card shows the population its verdict counts, so the numbers and "demand met" always agree (#1745).
- Opening a tower, and counting each save's population in the Saves dialog, takes about a quarter less time on a large tower (#1612).

## Engine
- A `.TDT` import merges multi-story parts with a sweep by left edge instead of comparing every pair, so a forged file with tens of thousands of theater pieces imports in linear-logarithmic time. The merged rooms are unchanged (#2086).
- New `recyclingCard()` read: the population the centers serve, what they process, the bins' fill and the verdict, from one read of the census tally (#1745).
- Loading a save finds each room's fields in one pass over its object instead of a lookup per key: about 30% fewer instructions and 25 to 30% less time on the perf towers, with the loaded game unchanged (#1612).
