---
app: patch
crate: patch
---
## Player
- The Bulletin shows a tower's earlier messages again after you open a saved tower, import a tower file or reload the page. It came up empty before.
## Engine
- A loaded tower numbers its saved log lines from 1 up to the log counter, so `logSince(0)` and the port's `logAfter(0)` list every line the save carried. They answered nothing before, since the counter restarted at 0.
