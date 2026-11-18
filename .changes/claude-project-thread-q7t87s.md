---
app: patch
crate: patch
readmes: unchanged
---
## Player
- One rider who gives up waiting no longer makes a quiet floor read "Backed up" or cost its shops their rating. It takes several long waits before a floor counts as jammed.
## Engine
- A floor's average commute wait now starts from no wait instead of from its first trip's wait, so one long wait or give-up moves it only part way (#2435). The conformance lock, the frame-day and port-edit goldens and one fuzz-corpus golden move with it, `holidays-classic` now lights no fire, and `ransom-declined-classic` ticks to the bomb threat's new hour.
