---
app: patch
crate: minor
---
## Player
- Modern: people remember how long the last riders really waited at each elevator stop, for a few minutes after they board. A stop the cars reach already full, such as a Metro basement below a busy shaft, no longer looks quick, so riders take the escalators or another shaft. A saved tower keeps the memory, and a tower saved before loads with none.
## Engine
- Modern routing: each elevator stop keeps a fading memory of its boarders' waits (`crowd::line_count::waits_seen`), and a stop's line costs the longer of the model and that memory. Saved in the crowd as `waitsSeen` rows `[shaft, floor, wait, fade]`; the `lines` rows now leave out a line nobody stands in.
