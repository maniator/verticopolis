---
app: minor
crate: patch
readmes: unchanged
---
## Player
- In Modern towers, someone who has stood an hour in one elevator line looks for another way up and walks to it when it is now quicker, and people choosing a route count how long each line has already kept its riders. On a tower whose Metro line jams in the morning rush, far fewer riders wait over an hour. Each hour the Bulletin names the worst landing where someone passed an hour in line.
## Engine
- The Modern router's lines (`Crowd::shaft_lines`) now hold a `line_count::Line` per landing, the riders and the longest wait in the line, and a boarding costs the longer of the expected wait and that measured one. A rider whose wait in a line passes an hour (`GIVE_UP`) is routed again once, from where they stand (`line_count::rethink_long_wait`), and keeps their place when the line is still quickest. `routing::plan` returns a route without joining its line. The saved `lines` rows are unchanged; a load counts the waits again from the saved people. The motion pass reuses the last count's map instead of allocating one.
