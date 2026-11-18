---
app: none
crate: patch
readmes: unchanged
---
## Engine
- How far a floor sits from the nearest lobby is read from a list of the lobby floors kept until a lobby is laid or removed, instead of walking every lobby floor and tall hall on each call, so a game day does less work (up to 1.9% on the bench towers) with every result unchanged.
