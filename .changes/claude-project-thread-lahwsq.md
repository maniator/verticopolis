---
app: patch
crate: patch
readmes: unchanged
---
## Player
- Fixed people standing still forever beside an escalator, stairway or elevator that stands over a gap in their floor. They now step onto it from their own side of the gap, so a sky lobby with a gap under an escalator no longer fills up with a crowd that never leaves, and busy towers like that run much faster.
## Engine
- A walker whose shaft or flight stands over a gap in their floor walks to its nearest column on their own run instead of finding another way that leads back to the same shaft every step (`crowd::walk::reach_on_run`).
