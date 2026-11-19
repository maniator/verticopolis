---
app: patch
crate: minor
readmes: unchanged
---
## Player
- A recycling center's card shows the population its verdict counts, so the numbers and "demand met" always agree (#1745).

## Engine
- A `.TDT` import merges multi-story parts with a sweep by left edge instead of comparing every pair, so a forged file with tens of thousands of theater pieces imports in linear-logarithmic time. The merged rooms are unchanged (#2086).
- New `recyclingCard()` read: the population the centers serve, what they process, the bins' fill and the verdict, from one read of the census tally (#1745).
