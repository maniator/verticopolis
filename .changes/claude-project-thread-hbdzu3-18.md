---
app: none
crate: patch
readmes: unchanged
---
## Engine
- Dragging an elevator, stairs or escalator reads only the built shafts in the dragged columns, from an index kept per edit, and checks the floors once, so a drag on a tower with many shafts answers far faster (68 us to 0.3 us per move with 1,358 shafts). A build cap check also counts the shafts once per edit. The answers are unchanged (#1261).
