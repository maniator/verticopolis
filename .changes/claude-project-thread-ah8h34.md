---
app: none
crate: patch
readmes: unchanged
---
## Engine
- The motion pass and the queue projection refill their waiting-line lists in place each step instead of building them again, 0.7% to 2.5% fewer instructions per step with identical results.
