---
app: minor
crate: minor
---
## Player
- In Modern, each lobby hall keeps its own height, so a three-story hall and a two-story hall can stand side by side on one floor.
- Where two lobby halls of different heights meet, a wooden revolving door now turns as people walk through it, in either direction at once.
- A floor built beside a tall lobby hall no longer blocks it, and a shaft beside the hall still stops on every floor.
## Engine
- Saves are version 9 when they hold a tall lobby: `lobbyHeights` lists one `[floor, x0, x1, height]` entry per hall, and a version 8 `[floor, height]` entry still loads as one height over every lobby tile on that floor.
- `lobbyHeights()` returns `[floor, x0, x1, height]` quads, `lobbyRise(floor, x)` takes the column, and `walkwayTop(kind, x, bottom, top)` takes the flight's column.
- In Modern a tall lobby claims the raised stories over its own tiles only, and a shaft skips a raised story only where it passes through a tall hall.
