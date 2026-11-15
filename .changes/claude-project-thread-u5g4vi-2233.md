---
app: patch
crate: patch
readmes: unchanged
---
## Player
- Modern towers run smoother at the morning and evening rush: finding each person's quickest way up takes about half the work it did, so a busy office tower keeps up at top speed.
## Engine
- The Modern router (`crowd::expected_time`) bounds its A* search by the least a route to the goal can cost with no lines and the most cars each shaft holds running, from a search back from the goal that each route resumes only until its start's cost is final, read capped at that cost so it never depends on earlier searches, in place of the floors left times the fastest car's ride. The searches carry across tower edits that leave the graph's ways and least costs as they were (rooms, rents, car counts) and stay under 4 MiB. Routes cost what they did; where two routes tie, the one taken can differ, which moves the Modern conformance cases.
