# Debugging Verticopolis

How to see what the game is actually doing at runtime: frame cost, draw
batching, ECS system timings, and Excalibur's geometry overlay.

Two ways in, and they control the same state:

```
?debug=fps                     launch with the metrics panel up

await vcdebug.on()             start it mid-session, from the console
vcdebug.fps()                  then drive it synchronously
```

`vcdebug` answers in every session, whether or not it was launched with a flag.
Until something asks for it, all it can do is `on()`, which loads the rest. That
matters more than it sounds: the hitch you want to measure has usually already
happened by the time you open devtools, and reloading with `?debug=` throws away
the state that caused it. Once `on()` resolves, `window.vcdebug` is the full API
and everything after is synchronous. A session launched with a flag skips this
step; `vcdebug` is already the full API.

Everything here is a developer tool. The read-only half ships in every build
(so a deployed build or a Vercel preview can be diagnosed on the device where
the problem actually happens); the parts that write to the game do not. See
[What ships where](#what-ships-where).

For the gated performance measurements that run in CI, see `npm run perf` and
`e2e/perf.spec.ts`. This file is about interactive debugging.

## Quick start

| I want to | Do this |
| --- | --- |
| See the frame cost | `?debug=fps` |
| Know why a frame is slow | `?debug=fps`, then read the system rows |
| See colliders and bounds | `?debug=draw:collider` |
| See them for people only | `?debug=draw:collider,filter:person` |
| Turn everything on | `?debug=all` |
| Turn everything off, permanently | `?debug=off` |
| Start it mid-session | `await vcdebug.on()` |
| Discover the rest | `vcdebug.help()` |

## Launch flags

`?debug=` takes a comma-separated list of tokens. A bare `?debug` (no value)
means `fps`.

| Token | Effect |
| --- | --- |
| `fps` (or `hud`) | Show the metrics panel |
| `draw` | Excalibur geometry draw, all sections |
| `draw:<section>` | One section (see below); repeatable |
| `filter:<name>` | Scope geometry draw to actors with that name |
| `all` | The panel plus every draw section |
| `off` | Nothing on, and forget any persisted flags |

`off` is the only token that forgets a persisted spec. A spec that merely
happens to switch nothing on (`?debug=filter:`, say, to drop a filter) leaves
your saved settings alone. And `?debug=off` genuinely starts nothing: no chunk
is fetched and no per-frame timing runs, so it is safe to use when measuring a
clean baseline.

Sections: `entity`, `transform`, `graphics`, `collider`, `physics`, `motion`,
`body`, `camera`, `tilemap`.

An unrecognized token is ignored, and named in a console warning rather than
dropped in silence: a debug flag that quietly does nothing is indistinguishable
from the thing you are measuring being fine.

Flags can be made to survive reloads with `vcdebug.persist(true)`, which writes
the current state to `localStorage` under `vc.debug`. An explicit `?debug=` in
the URL always overrides a persisted spec, and `?debug=off` clears it.

## The console: `window.vcdebug`

| Call | What it does |
| --- | --- |
| `await vcdebug.on()` | Start the surface (only needed if it is not running) |
| `vcdebug.help()` | Print the vocabulary and what is currently on |
| `vcdebug.fps()` / `.fps(true\|false)` | Toggle or set the metrics panel |
| `vcdebug.draw()` / `.draw('collider')` / `.draw([...])` | Toggle or set geometry draw |
| `vcdebug.filter('person')` / `.filter(false)` | Scope geometry draw, or clear |
| `vcdebug.stats()` | A plain snapshot object of the latest frame |
| `vcdebug.systems(10)` | The costliest ECS systems, as a `console.table` |
| `vcdebug.persist(true\|false)` | Keep the current flags across reloads |

`vcdebug.stats()` returns a copy, not a live reference. That matters: Excalibur
reuses its `stats.currFrame` object every frame rather than reallocating it, so
anything you keep a direct reference to silently changes under you.

## Reading the panel

```
fps      58   p50 59  p5 31
frame    16.2 ms   up 3.40  draw 11.8
sim      2.10 ms   peak 18.4
draws    412 calls  4,300 imgs  37 swaps
actors   214 alive / 219 total
camera   zoom 0.250
draw:GraphicsSystem              9.80 ms
update:MotionSystem              1.20 ms
update:PointerSystem             0.30 ms
```

**fps.** The instantaneous rate, then the session's median and 5th percentile.
The percentiles come from the analytics reservoir (`GameplaySession`), which
samples its own wall clock precisely because the engine's frame delta is
spike-clamped to 1ms above 200ms and would hide the hitches worth catching.
`p5` is the number that tells you whether the game stutters; instantaneous fps
tells you almost nothing. They read `—` for the first couple of seconds, below
the minimum sample count.

**frame / sim.** `frame` is Excalibur's own accounting: total, then the update
and draw phases. `sim` is the game's tick (`runFrame`), which runs *inside*
Excalibur's update phase and so is invisible to every other number here. If
`up` is large and `sim` is small, the cost is in the ECS systems, not the
simulation. `peak` is the worst tick since the last panel refresh; the panel
refreshes at 4Hz, so without it roughly fourteen frames in fifteen would go
unwatched, including the one that hitched.

One thing to know before blaming the simulation for a `sim` spike: `runFrame`
also carries the throttled (~6Hz) DOM and audio refresh, so roughly every 160ms
one tick does the sim step *plus* a UI pump and costs several times its
neighbors. A `peak` far above the typical `sim` is usually that pump, not the
tower. `npm run perf` measures the pump in isolation if you need to separate
them.

**draws.** This is the batching picture, and the two numbers answer different
questions.

- `swaps` (`rendererSwaps`) counts renderer switches per frame. A switch is
  literally a broken batch, so this is the direct batching metric. If it climbs
  with visible crowd size, the moving layer is breaking batches and atlasing
  those textures would pay.
- `calls` (`drawCalls`) is the total draw call count. Compare it against the
  number of things on screen: if it tracks the person count, batching is the
  problem and an atlas is the fix. If it is already low while frames are slow,
  the cost is per-entity overhead (transforms, motion, the crowd update) and
  atlasing buys nothing.
- `imgs` (`drawnImages`) is images submitted. High `imgs` with low `calls` is
  batching working correctly.

Measure this before changing anything. It is cheap, it is exact, and it settles
the atlas question without a profiler.

**actors.** Alive versus total. Watch this cross `CROWD_CULL_ZOOM` (0.125): the
crowd and vehicle layer culls below that zoom, and the `camera` row says
`crowd CULLED` when it has.

**System rows.** The three costliest ECS systems this frame, descending, from
Excalibur's `systemDuration`. The prefix is the phase (`draw:` or `update:`),
so `draw:GraphicsSystem` dominating means rendering, and `update:MotionSystem`
dominating means movement. This single row answers "is it drawing or is it
motion" with no profiler attached. `vcdebug.systems(20)` lists more than three.

> **Profile systems on `npm run dev`, not on a built bundle.** Excalibur names
> these from `constructor.name`, and a production or `VC_TOOLING=1` build
> minifies the engine's class names, so the rows come out as `draw:cn` and
> `update:ji`: correctly ranked, but unreadable. The dev server is unminified
> and shows real names. The rest of the panel is unaffected.

These timings are free, incidentally. Excalibur populates `stats.currFrame`
every frame and `SystemManager` wraps every system phase in `performance.now()`
unconditionally, with no reference to `isDebug`. The panel only reads what was
already being measured.

## Geometry draw, and its two traps

`?debug=draw` turns on Excalibur's own overlay: colliders, bounds, transforms,
camera focus, and so on, per section. `DebugSystem` early-outs when debug is
off, so it costs nothing when unselected.

**It inflates the counters above it.** Debug draw renders through the same
graphics context as everything else, so it adds to `drawCalls` and
`rendererSwaps`, exactly the numbers you would be reading. The panel says so
when both are on (`debug draw on: draws/swaps inflated`). Use geometry draw to
see shapes; turn it off to trust numbers.

**It draws in world space.** Debug labels are drawn at world scale, and this
game's camera goes down to about 0.06 zoom. Below roughly 0.125 the text is
sub-pixel and unreadable, which is precisely when you are investigating
zoomed-out performance. That is why the metrics panel is DOM and not debug
draw.

### Filtering by actor name

`engine.debug.filter` scopes debug draw to matching entities, and it matches on
the actor's **name**. Every actor this renderer creates is named
(`src/render/excalibur/actorNames.ts` is the single source of truth):

| Group | Names |
| --- | --- |
| Tower | `region`, `room`, `transport`, `escape`, `crane` |
| Moving | `person`, `walker`, `car`, `train`, `truck`, `garageCar` |
| Scene | `dirt`, `groundStrip`, `sidewalk`, `pavement`, `road`, `roundabout`, `fountain`, `lamp`, `plant`, `skyline` |
| Screen layers | `sky`, `overlay` |

So `vcdebug.filter('person')` reduces "every collider in a 400-actor tower" to
something you can actually look at.

Two of these are worth knowing about before you read an actor count:

- **`region`, not `room`, is most of a built tower.** Settled rooms are
  composited into shared region canvases (`towerRegions.ts`); only rooms that
  still animate (under construction, a playing cinema) keep a private `room`
  actor. A tower with 200 offices does not have 200 room actors.
- **`skyline` dominates a small tower.** The background city is 120 actors from
  the very first frame, so an early `actors` reading is mostly decoration.

Static floor and lobby tiles are TileMap cells rather than actors, so they have
no name and are reached through the `tilemap` section instead.

## Ad-hoc geometry: `ex.Debug`

For drawing your own shapes while investigating something, Excalibur's static
`ex.Debug` needs no graphics context at the call site. The calls are queued and
flushed only when debug is on, so they are inert otherwise:

```ts
import * as ex from "excalibur";

ex.Debug.drawLine(a, b, { color: ex.Color.Cyan });
ex.Debug.drawPolygon(points, { color: ex.Color.Magenta });
ex.Debug.drawCircle(center, r);
ex.Debug.drawText("stuck here", pos);
```

Also available: `drawPoint`, `drawLines`, `drawBounds`, `drawRay`.

This is the fastest way to check that two pieces of geometry agree. Drawing
each in its own color makes a divergence visible instead of inferred, which
beats comparing numbers when the question is "are these the same shape".

Remember to remove these before committing; they are not gated by the `?debug=`
flags, only by whether debug draw is on.

## Other Excalibur knobs

`engine.debug.colorBlindMode` simulates color vision deficiencies. Excalibur's
own documentation warns that it reduces FPS, so do not leave it on while
measuring anything.

The Excalibur DevTool browser extension reads this same data. It has not worked
well enough here to rely on, which is why this surface exists.

## What ships where

`window.game` (the handle e2e, screenshots, and perf drive) is published only
in dev serves and `VC_TOOLING=1` builds, and is compiled out of production.
`vcdebug` follows the same rule but splits in two:

| Half | Where | What |
| --- | --- | --- |
| Read-only | Every build | The panel, geometry draw, `stats()`, `systems()`, `filter()`, `persist()` |
| `vcdebug.unsafe` | Dev serves and `VC_TOOLING=1` only | `app`, `money(n)`, `speed(n)` |

The read-only half ships to production deliberately: diagnosing a real device
or a preview deploy is worth more than the chunk it costs, and reading counters
cannot cheat. The mutators are gated because `game.sim.star = 5` was a one-line
cheat and this must not reopen it. `scripts/verify-game-handle.ts` asserts both
on the built artifact on every `npm run build`, CI and the Vercel deploy
included, since dead-code elimination is only observable in the output.

Cost to a player who never asks for debug: one URL read, one localStorage read,
and a stub object on `window` whose only method is `on()`. The surface itself
lives in its own `debug-surface-*.js` chunk behind a dynamic import, and that
chunk is excluded from the service-worker precache, so a PWA install does not
download it either. `scripts/verify-precache.ts` asserts both halves on every
build: that the chunk exists under its expected name, and that it is absent from
the precache manifest.

## Where the pieces live

| Path | What |
| --- | --- |
| `src/debug/debugFlags.ts` | The `?debug=` vocabulary, precedence, persistence |
| `src/debug/debugMetrics.ts` | Frame snapshotting and formatting (pure) |
| `src/debug/debugHud.ts` | The DOM panel |
| `src/debug/debugConsole.ts` | `window.vcdebug` |
| `src/debug/simTimer.ts` | Sim-tick timing; in the main bundle, read by the frame loop |
| `src/debug/consoleStub.ts` | The always-present `vcdebug.on()` loader; in the main bundle |
| `src/debug/index.ts` | `installDebug`: adapts the real engines to the ports above |
| `src/render/excalibur/actorNames.ts` | The actor-name vocabulary |

The HUD and the console take narrow structural ports rather than `ex.Engine`
and `TowerEngine` directly, which is what lets them be unit-tested under
happy-dom with no WebGL. `installDebug` is the only place that knows about the
real engines.
