import * as ex from "excalibur";
import { drawTallLobbyEntrance, drawTallLobbyTile } from "../sprites/structure/tallLobby";
import { Z } from "../depthPlanes";
import { GROUND, groundBelowFloors } from "../sceneryLayout";
import type { RenderSim } from "../renderSim";
import { bindViewWorld, viewWorld } from "../../presentation/viewWorld";
import { bindViewKinds } from "../../presentation/viewKinds";
import type { UnitView } from "../../simport/view";
import {
  AWNING_W,
  drawAwning,
  drawEscapeStairs,
  drawLobbyEntrance,
  drawUnit,
  ESCAPE_W,
  LOBBY_VARIANTS,
} from "../sprites";
import { drawSanta } from "../sprites/events";
import { CLOUD_COUNT, CLOUD_DRIFT, SUN_ARC, cloudFill, cloudMotion, cloudRadius, cloudSeed, drawCloud, drawSunDisc, skyColor } from "../sprites/sky";
import { disposeRegions } from "./towerRegions";
import { emptyStructPass } from "./towerStructTiles";
import { emptyFlightPass } from "../venueFlights";
import { clearLongPress } from "./longPress";
import { NOT_BAKED } from "./sceneBake";
import { bakePeople } from "./peopleGfx";
import { FLOOR, TILE } from "../scale";
import * as overlayFx from "./towerOverlay";
import * as crowd from "./towerCrowd";
import { clearHallDoors } from "./towerHallDoors";
import type { TowerEngine } from "./TowerEngine";
import { towerCatalog } from "../../catalog/towerCatalog";

/**
 * Static scene construction, shared-graphics baking, the sky-layer painters
 * (sun/moon, clouds, Santa) and the engine lifecycle (sim-swap, teardown,
 * dispose) for {@link TowerEngine}. Friend functions taking the engine
 * instance. Extracted from `TowerEngine.ts`; the class keeps thin delegations.
 * Retained-scene reconciliation lives in `towerReconcile`; the 2D overlay
 * painters in `towerOverlay`. Pure code move: no drawing or teardown logic
 * changed.
 */

// ---- Static scene elements ----------------------------------------------

/** Bind the view's world from the tower's catalog: the tile maps, region grid,
 *  scenery and cursor clamps are all sized from it (#921). The engine binds it
 *  when it is built, before any input can read it. A swapped-in tower must
 *  state the same lot width and basement; its top floor may differ, and
 *  {@link setSim} then resizes the structure map to it (#1985). */
export function bindSceneWorld(sim: RenderSim): void {
  const catalog = towerCatalog(sim);
  bindViewWorld(catalog.world);
  bindViewKinds(catalog);
}

export function makeGround(engine: TowerEngine): void {
  const total = viewWorld().lotWidth * TILE * GROUND.lots;
  const centerX = (viewWorld().lotWidth / 2) * TILE;
  const depth = groundBelowFloors() * FLOOR;
  const leftEdge = centerX - total / 2;
  // One rectangle this wide (~11k px) would rasterize to a bitmap past the GPU
  // texture limit (4096 on mobile) and render as a black band. It needs the
  // full width to cover the dirt when zoomed out at the camera's edge, so tile
  // it into texture-safe segments instead (seamless, same solid color).
  // Keep each segment under 2048px, the lowest MAX_TEXTURE_SIZE on older
  // mobile GPUs (the transport-shaft cap stays under this too).
  const MAX_SEG = 2000;
  const segments = Math.ceil(total / MAX_SEG);
  const segW = total / segments;
  for (let i = 0; i < segments; i++) {
    const segCx = leftEdge + segW * (i + 0.5);
    const dirt = new ex.Actor({
      pos: ex.vec(segCx, 0),
      width: segW + 1, // overlap neighbors by 1px to hide any seam
      height: depth,
      anchor: ex.vec(0.5, 0),
      z: Z.dirt,
      color: ex.Color.fromHex(GROUND.dirt),
    });
    engine.engine.add(dirt);
    engine.engine.add(
      new ex.Actor({
        pos: ex.vec(segCx, 0),
        width: segW + 1,
        height: GROUND.lineH,
        anchor: ex.vec(0.5, 0.5),
        z: Z.groundLine,
        color: ex.Color.fromHex(GROUND.line),
      }),
    );
  }
}

/**
 * Sun/moon on a screen-space layer placed *below* the world ground and tower
 * (a z under the dirt). They hang in the open sky, and as you pan, the dirt
 * and the building slide over them and hide them at the horizon, so it pans
 * correctly with no manual clipping.
 */
export function makeSky(engine: TowerEngine): void {
  // cache:false is deliberate (like the overlay below): this is a full-viewport
  // screen layer whose pixels change every frame, the sun/moon arc and clouds
  // drift on the decorative clock. A cached canvas would have to flagDirty()
  // every frame, which re-rasterizes AND re-uploads the whole texture anyway
  // (see the RoomRec cache note), no reuse to gain, just extra plumbing.
  engine.skyCanvas = new ex.Canvas({
    width: engine.viewWidth,
    height: engine.viewHeight,
    cache: false,
    draw: (ctx) => drawSky(engine, ctx),
  });
  engine.sky = new ex.ScreenElement({ x: 0, y: 0, z: Z.sky });
  engine.sky.graphics.use(engine.skyCanvas);
  engine.engine.add(engine.sky);
}

export function makeOverlay(engine: TowerEngine): void {
  // cache:false is deliberate: this full-viewport screen layer changes every
  // frame, the ruler always draws, the build-preview ghost tracks the cursor,
  // rain animates, and the event visuals follow the camera (their screen
  // coords come from worldToScreen). Nothing here is stable across frames,
  // so a cached canvas would need a per-frame flagDirty() that re-rasterizes
  // and re-uploads the whole texture regardless, equal cost to cache:false,
  // plus extra plumbing and a staleness-bug risk.
  engine.overlayCanvas = new ex.Canvas({
    width: engine.viewWidth,
    height: engine.viewHeight,
    cache: false,
    draw: (ctx) => overlayFx.drawOverlay(engine, ctx),
  });
  engine.overlay = new ex.ScreenElement({ x: 0, y: 0, z: Z.overlay });
  engine.overlay.graphics.use(engine.overlayCanvas);
  engine.engine.add(engine.overlay);
}

/** One TileMap entity carries every static floor/lobby tile (see the
 *  structTiles field note). Sized to the whole buildable grid so cell
 *  lookups are plain coordinate math; row 0 is the TOP floor because the
 *  map's origin is its top-left corner in world space. A map built before
 *  (a swap to a tower with another top floor) leaves the scene first. */
export function makeStructTileMap(engine: TowerEngine): void {
  const world = viewWorld();
  if (engine.structTileMap) engine.engine.remove(engine.structTileMap);
  engine.structTileMap = new ex.TileMap({
    pos: ex.vec(0, engine.worldYTop(world.maxFloor)),
    tileWidth: TILE,
    tileHeight: FLOOR,
    columns: world.lotWidth,
    rows: world.maxFloor - world.minFloor + 1,
  });
  engine.structTopFloor = world.maxFloor;
  engine.structTileMap.z = Z.structure; // behind rooms (0) and transports (1), like the old actors
  engine.engine.add(engine.structTileMap);
}

// ---- Shared graphics ----------------------------------------------------

export function bakeSharedGraphics(engine: TowerEngine): void {
  // Structural tiles bake from a FIXED DrawCtx (not the live this.d): these
  // canvases cache on first render, so baking from live state would freeze
  // whatever lighting happened to be on screen at that moment into the tile.
  const bake = (u: UnitView, lit: boolean) =>
    new ex.Canvas({
      width: TILE,
      height: FLOOR,
      cache: true,
      draw: (ctx) => drawUnit({ ctx, lit, anim: 0, hour: lit ? 20 : 12 }, u, 0, 0, TILE, FLOOR),
    });
  engine.floorGfx = bake(fakeStruct("floor"), false);
  // Lobby variants: [lit 0/1][ground 0/1][variant]. The fake unit's floor
  // selects the grand ground style (1) vs the sky-lobby style; x the variant.
  engine.lobbyGfx = [false, true].map((lit) =>
    [false, true].map((ground) =>
      Array.from({ length: LOBBY_VARIANTS }, (_, v) => bake(fakeStruct("lobby", ground ? 1 : 2, v), lit)),
    ),
  );
  // Grand-entrance tiles need the ANIMATED path (cache: false) so the
  // doorman's two-frame sway advances on the decorative clock without extra
  // plumbing. The bake reads `this.d.anim` at draw time; `this.d.lit` is
  // fixed per canvas so the lit and unlit versions don't get swapped on the
  // evening flip (that path re-issues use() to swap between them). Service
  // tiles are static so they use the same cache-true bake as normal variants.
  const bakeGrand = (kind: "grand-left" | "grand-right" | "grand-solo") => (lit: boolean): ex.Canvas =>
    new ex.Canvas({
      width: TILE,
      height: FLOOR,
      cache: false,
      // `staffed` is read live off `engine.d` the same way `anim` is, so this
      // cache:false canvas never holds a stale baked figure. Unlike `anim` the
      // VALUE only changes at scene-sync cadence (`syncScene` writes it), which
      // is the right cadence: tenancy moves on the hour tick, and that tick is
      // itself a sync trigger, so the entrance follows a frame later.
      draw: (ctx) =>
        drawLobbyEntrance(
          { ctx, lit, anim: engine.d.anim, hour: lit ? 20 : 12, staffed: engine.d.staffed },
          kind, 0, 0, TILE, FLOOR,
        ),
    });
  const bakeService = (lit: boolean): ex.Canvas =>
    new ex.Canvas({
      width: TILE,
      height: FLOOR,
      cache: true,
      draw: (ctx) => drawLobbyEntrance({ ctx, lit, anim: 0, hour: lit ? 20 : 12 }, "service", 0, 0, TILE, FLOOR),
    });
  engine.entranceGrandLeftGfx = [bakeGrand("grand-left")(false), bakeGrand("grand-left")(true)];
  engine.entranceGrandRightGfx = [bakeGrand("grand-right")(false), bakeGrand("grand-right")(true)];
  engine.entranceGrandSoloGfx = [bakeGrand("grand-solo")(false), bakeGrand("grand-solo")(true)];
  engine.entranceServiceGfx = [bakeService(false), bakeService(true)];
  // Tall lobby stories (#308): each cell draws the whole hall shifted up so
  // only its own story lands on the canvas, so the slices line up into one
  // hall. Baked on first use: a tower holds at most a few tall lobbies.
  const tall = new Map<string, ex.Canvas>();
  engine.tallLobbyGfx = (lit, ground, height, story, slot) => {
    const key = `${lit ? 1 : 0}|${ground ? 1 : 0}|${height}|${story}|${slot}`;
    let gfx = tall.get(key);
    if (!gfx) {
      const y = -(height - 1 - story) * FLOOR;
      // The grand doors' story carries the swaying doorman, so it takes the
      // animated path (and live staffing) like the one-story grand entrance.
      const doorman = story === 0 && typeof slot === "string" && slot !== "service";
      gfx = new ex.Canvas({
        width: TILE,
        height: FLOOR,
        cache: !doorman,
        draw: (ctx) => {
          const d = doorman
            ? { ctx, lit, anim: engine.d.anim, hour: lit ? 20 : 12, staffed: engine.d.staffed }
            : { ctx, lit, anim: 0, hour: lit ? 20 : 12 };
          if (typeof slot === "string") drawTallLobbyEntrance(d, slot, 0, y, TILE, height * FLOOR, height);
          else drawTallLobbyTile(d, 0, y, TILE, height * FLOOR, slot, ground, height);
        },
      });
      tall.set(key, gfx);
    }
    return gfx;
  };
  const bakeEsc = (side: "left" | "right") =>
    [0, 1].map(
      (p) =>
        new ex.Canvas({
          width: ESCAPE_W,
          height: FLOOR,
          cache: true,
          draw: (ctx) => drawEscapeStairs(ctx, side, p as 0 | 1, FLOOR),
        }),
    );
  engine.escGfx = { left: bakeEsc("left"), right: bakeEsc("right") };
  const bakeAwning = (side: "left" | "right") =>
    new ex.Canvas({
      width: AWNING_W,
      height: FLOOR,
      cache: true,
      draw: (ctx) => drawAwning(ctx, side, FLOOR),
    });
  engine.awningGfx = { left: bakeAwning("left"), right: bakeAwning("right") };

  // The moving people (#2097): the cast drawn by `people.ts`, baked lazily per
  // look, pose, walk frame, mood and facing (`peopleGfx.ts`), so a frame only
  // looks a figure up. The routed crowd and the passers-by share it.
  engine.people = bakePeople();
}

export function fakeStruct(kind: "floor" | "lobby", floor = 1, x = 0): UnitView {
  return {
    id: -1,
    kind,
    floor,
    x,
    width: 1,
    state: "occupied",
    occupants: 0,
    label: "",
  };
}

// ---- Sky layer painters -------------------------------------------------

function drawSky(engine: TowerEngine, ctx: CanvasRenderingContext2D): void {
  if (engine.skyCanvas.width !== engine.viewWidth || engine.skyCanvas.height !== engine.viewHeight) {
    engine.skyCanvas.width = engine.viewWidth;
    engine.skyCanvas.height = engine.viewHeight;
  }
  ctx.clearRect(0, 0, engine.viewWidth, engine.viewHeight);
  drawSun(engine, ctx);
  drawClouds(engine, ctx);
  renderSanta(engine, ctx);
}

/** Santa's sleigh crossing the sky during a holiday cameo (see syncEventFx). */
function renderSanta(engine: TowerEngine, ctx: CanvasRenderingContext2D): void {
  if (engine.santaStart === null) return;
  const p = (engine.d.anim - engine.santaStart) / overlayFx.SANTA_FLIGHT_SECONDS;
  if (p < 0 || p > 1) return;
  // Slide fully across, offscreen to offscreen, with a gentle bob.
  const x = -160 + p * (engine.viewWidth + 320);
  const y = engine.viewHeight * 0.15 + Math.sin(p * Math.PI * 3) * 12;
  drawSanta(ctx, x, y, 1.15);
}

/** Clouds drift across the sky on overcast and rainy days (sky layer). */
function drawClouds(engine: TowerEngine, ctx: CanvasRenderingContext2D): void {
  const w = engine.sim.weather;
  if (w === "clear") return;
  const W = engine.viewWidth;
  const H = engine.viewHeight;
  const t = engine.d.anim;
  ctx.fillStyle = cloudFill(w);
  for (let i = 0; i < CLOUD_COUNT; i++) {
    const seed = cloudSeed(i);
    const { speed, row, offset } = cloudMotion(seed);
    const { pad, top, band } = CLOUD_DRIFT;
    const y = H * top + row * H * band;
    const x = ((offset % (W + pad)) + t * speed) % (W + pad) - pad / 2;
    drawCloud(ctx, x, y, cloudRadius(seed));
  }
}

function drawSun(engine: TowerEngine, ctx: CanvasRenderingContext2D): void {
  const hour = engine.sim.clock.hour + engine.sim.clock.minute / 60;
  // The sun arcs across 06:00→18:00; the moon takes the same arc 18:00→06:00,
  // so both rise in the east, climb, and set in the west.
  const { rise, set, baseY, lift } = SUN_ARC;
  const day = hour >= rise && hour < set;
  const arc = day ? ((hour - rise) / (set - rise)) * Math.PI : (((hour - set + 24) % 24) / (24 - (set - rise))) * Math.PI;
  const cx = (arc / Math.PI) * engine.viewWidth;
  const cy = engine.viewHeight * baseY - Math.sin(arc) * engine.viewHeight * lift;
  drawSunDisc(ctx, cx, cy, day);
}

export { skyColor };

// ---- Engine lifecycle ---------------------------------------------------

export function disposeScene(engine: TowerEngine): void {
  for (const cell of engine.structTiles) cell.clearGraphics();
  // Region canvases, their membership, the dirty queue and the dead-parking
  // set all clear together, so no queued repaint can survive into (and paint
  // against) a swapped-in tower.
  disposeRegions(engine);
  for (const a of engine.animatedRooms.values()) a.kill();
  for (const a of engine.transportActors.values()) a.kill();
  for (const rec of engine.escapeActors.values()) {
    rec.l.kill();
    rec.r.kill();
  }
  engine.escapeActors.clear();
  if (engine.craneActor) {
    engine.craneActor.kill();
    engine.craneActor = null;
    engine.craneGfx = null;
  }
  engine.structTiles.clear();
  // The cells were just emptied, so the next sync must walk the tiles again
  // (and the old view's unit list, rooms and lobby cells are not kept alive).
  engine.structPass = emptyStructPass();
  engine.flightPass = emptyFlightPass();
  engine.animatedRooms.clear();
  engine.roomSig.clear();
  engine.transportActors.clear();
  engine.transportSig.clear();
  crowd.clearMotion(engine);
}

/** Full input reset: a tower swap (new game / load) or an undo step must not
 *  inherit a half-finished gesture, and dropping any tracked contacts here is
 *  the recovery path if a browser ever swallows a pointer's up/cancel. */
function resetInput(engine: TowerEngine): void {
  engine.tracker.reset();
  engine.gesture = null;
  engine.arrowDrag = null;
  // The long-press peek resets with the rest of the input state: a hold armed
  // on the old tower must not fire its captured pick against the new sim, and
  // a fired peek's latch must not outlive the contact the reset just dropped
  // (a stale latch suppresses every pointerMove until the next press).
  clearLongPress(engine);
  engine.longPressFired = false;
  // The placement ghost and the shaft preview were judged against the tower
  // as it was; the next pointer move, or the app's keyboard cursor refresh,
  // draws them again against this one.
  engine.preview = null;
  engine.transportPreview = null;
}

/**
 * Follow an undo or redo step the engine took on the tower this scene draws.
 * The step is an edit of that tower, and it moved the tower's revision, so the
 * scene is kept: the tiles, the room, shaft and crowd actors, the camera and
 * any effect in flight. The next sync brings the scene up to the changed tower
 * by its own keys (the revision and unit list for the tiles, each room's and
 * shaft's signature, each person's id), as it does after a build or a
 * bulldoze. A swap to another tower goes through {@link setSim} instead. The
 * input resets, because the engine committed any gesture under way before it
 * took the step, and an effect drawn on a spot the step emptied ends.
 */
export function followStep(engine: TowerEngine): void {
  resetInput(engine);
  overlayFx.dropStrandedFx(engine);
}

export function setSim(engine: TowerEngine, sim: RenderSim, opts?: { keepCamera?: boolean }): void {
  // The scene keeps its lot width and basement, so the swapped-in tower must
  // state the same ones. Bind first: a refused world throws before anything
  // is torn down.
  bindSceneWorld(sim);
  disposeScene(engine);
  // A tower with another top floor (a taller lot, #1985) gets a structure map
  // of its own height. The cells were just cleared, so nothing drawn is lost.
  if (engine.structTileMap && viewWorld().maxFloor !== engine.structTopFloor) makeStructTileMap(engine);
  crowd.clearCrowd(engine);
  clearHallDoors(engine);
  resetInput(engine);
  // Drop any in-flight event visuals and adopt the new sim's fx baselines, so
  // a tower swap neither leaves Santa mid-sky nor re-fires a stale flash.
  engine.santaStart = null;
  engine.explosions = [];
  engine.thiefStart = null;
  engine.thiefCaught = false;
  engine.thiefFloor = 1;
  engine.treasures = [];
  engine.vipStart = null;
  engine.lastSantaSeq = sim.santaFxSeq;
  engine.lastExplosionSeq = sim.explosionFx.seq;
  engine.lastThiefSeq = sim.thiefFx.seq;
  engine.lastTreasureSeq = sim.treasureFx.seq;
  engine.lastVipSeq = sim.vipFxSeq;
  engine.sim = sim;
  engine.builtRev = NOT_BAKED;
  engine.mealOverlayRev = -1;
  // Invalidate the per-floor occupancy cache so a swapped-in tower (new game /
  // load) can't briefly gate walkers on the previous sim's occupancy even if
  // its hour and revision happen to match the cached keys.
  engine.floorLiveHour = -1;
  engine.floorLiveRev = -1;
  engine.floorLive.clear();
  engine.adoptCamera(sim.view, opts?.keepCamera);
}

/** True when the engine draws through WebGL. Excalibur's constructor
 *  silently falls back to a Canvas2D context when `webgl2` creation fails
 *  (GPU still wedged after a loss), and that fallback never receives the
 *  context-loss handlers, so a "recovered" 2D engine would run degraded
 *  with the whole crash pipeline dead. The rebuild path checks this and
 *  treats the fallback as a failed recovery. */
export function rendersWithWebGL(engine: TowerEngine): boolean {
  return engine.engine.graphicsContext instanceof ex.ExcaliburGraphicsContextWebGL;
}

/** Full teardown, used by in-place context-loss recovery before a rebuild:
 *  Excalibur's dispose stops the loop, force-collects GPU resources,
 *  disables input, and releases the engine singleton slot so a fresh
 *  TowerEngine can be constructed cleanly. Safe on a lost context (GL calls
 *  on one are no-ops per spec). */
export function dispose(engine: TowerEngine): void {
  // Engine.dispose()'s internal stop() is guarded by clock.isRunning,
  // and on the recovery path the context-loss handler has already stopped
  // the clock, so that stop() would skip the texture GC and the browser
  // teardown: the GC's requestIdleCallback loop would respawn forever and
  // the per-engine window/document listeners (resize, visibilitychange)
  // would keep the dead engine graph reachable for the page's life. Run
  // both explicitly; each is idempotent, so the path where dispose()'s own
  // stop() also runs them stays correct. The GC handle is private (still
  // in Excalibur 1.0), hence the cast; if a future version renames it the
  // optional chain degrades to the old leak instead of a crash.
  (engine.engine as unknown as { _garbageCollector?: { stop(): void } })._garbageCollector?.stop();
  engine.engine.browser.clear();
  engine.engine.dispose();
}
