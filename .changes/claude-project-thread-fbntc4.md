---
app: patch
crate: minor
readmes: unchanged
---
## Player
- Modern towers with hundreds of stairs and escalators do less work on each drawn frame.
## Engine
- The view's frame carries only the elevators' transport records, in tower order; stairs and escalators run no car and come only with the structure (#2383). View layout version 29.
- A people window keeps its widest-shaft pad per tower revision instead of walking every transport each frame.
