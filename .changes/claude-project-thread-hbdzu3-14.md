---
app: patch
crate: patch
readmes: unchanged
---
## Player
- Classic: the tower's notices and Tower Statistics now say what went wrong without telling you what to do, the way the 1994 game did, matching a room's card. That covers a floor only stairs reach, a metro cut off from the tower, a fire, a theft or a bomb with no Security, rooms a fire gutted, cockroaches, the VIP's verdict, and a recycling shortfall. Modern still says what to do about each one (#549).

## Engine
- The Classic notices drop their fix (`GameMode::advises_fixes`): the stranded-floor and metro cut-off notices, the Security tip after a fire, the theft, bomb and refused-ransom notices, the burned-room, helicopter and cockroach notices, and the unimpressed VIP. Modern's text is unchanged (#549).
