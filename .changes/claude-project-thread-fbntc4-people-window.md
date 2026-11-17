---
app: patch
crate: patch
---
## Player
- Zoomed far out, where the crowd is hidden, the game no longer reads every person each frame.
## Engine
- From 512 people the crowd keeps a per-floor index of its people in the step, and a view's people window reads the people on its floors from it, so the frame's cost follows the screen instead of the crowd (#2151). Smaller crowds, today's included, keep no index and cost what they did.
