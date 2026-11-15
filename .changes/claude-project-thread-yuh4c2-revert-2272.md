---
app: none
crate: patch
readmes: unchanged
---
## Engine
- The Modern long-wait re-route added earlier in this cycle is taken back out until it costs no simulation time, so `Crowd::shaft_lines`, `routing::plan` and the motion pass are as they were in 1.41.0.
