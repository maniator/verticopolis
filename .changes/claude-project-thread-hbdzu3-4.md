---
app: none
crate: patch
readmes: unchanged
---
## Engine
- The elevator dispatch no longer sorts its two door lists (closed and open cars) every chunk. Each shaft's cars are already in order, and the shafts' id order is kept per tower revision, so a tower whose save lists its shafts in id order does no reordering at all, and one that doesn't copies the runs into place. The lists, and every game, are identical (#2060).
