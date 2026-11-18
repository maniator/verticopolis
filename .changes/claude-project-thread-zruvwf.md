---
app: patch
crate: minor
---
## Player
- The Traffic readout now follows the worst line of people waiting for an elevator right now, so "Backed up · B4" means a crowd you can find, and it no longer stays red at night with nobody waiting. Tapping it zooms in on that line and marks just its stretch of the floor and its elevator, instead of the whole floor and every elevator that stops there.
- On the desktop, Info's meters keep one width each, so a named floor, a longer date or a bigger fund can no longer push the speed buttons under the tower's title bar.

## Engine
- New `queueLine(shaft, floor)` read: how far one elevator landing's waiting line reaches along its floor, from the shaft face to the rider standing farthest from it, so a host can mark one line in a bank of elevators whose lines run across each other.
