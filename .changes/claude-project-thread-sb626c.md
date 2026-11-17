---
app: none
crate: patch
readmes: unchanged
---
## Engine
- `labelUnit`, `nameTower` and `logLine` refuse text longer than 4,096 UTF-16 code units with "That request is not valid." and change nothing, so every caller meets the same cap the web's editor used to apply on its own (#1405).
