import * as ex from "excalibur";
import type { Simulation } from "../../engine/Simulation";
import { GRID } from "../../engine/facilities";
import type { Unit } from "../../engine/types";
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
import { SHIRTS } from "../pixelSprites";
import { personFigure } from "../pixelSprites/common";
import { FLOOR, TILE } from "../scale";
import * as overlayFx from "./towerOverlay";
import * as crowd from "./towerCrowd";
import type { TowerEngine } from "./TowerEngine";

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

export function makeGround(engine: TowerEngine): void {
  const total = GRID.width * TILE * 3;
  const centerX = (GRID.width / 2) * TILE;
  const depth = (2 - GRID.minFloor + 14) * FLOOR;
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
      z: -50,
      color: ex.Color.fromHex("#3a3326"),
    });
    engine.engine.add(dirt);
    engine.engine.add(
      new ex.Actor({
        pos: ex.vec(segCx, 0),
        width: segW + 1,
        height: 6,
        anchor: ex.vec(0.5, 0.5),
        z: -49,
        color: ex.Color.fromHex("#6f6a60"),
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
  engine.sky = new ex.ScreenElement({ x: 0, y: 0, z: -60 });
  engine.sky.graphics.use(engine.skyCanvas);
  engine.engine.add(engine.sky);
}

export function makeOverlay(engine: TowerEngine): void {
  // cache:false is deliberate: this full-viewport screen layer changes every
  // frame, the ruler always draws, the build-preview ghost tracks the cursor,
  // rain animates, and the stats heatmap's tints follow the camera (their
  // screen coords come from worldToScreen). Nothing here is stable across
  // frames, so a cached canvas would need a per-frame flagDirty() that
  // re-rasterizes and re-uploads the whole texture regardless, equal cost to
  // cache:false, plus extra plumbing and a staleness-bug risk. The *expensive*
  // input (the per-hour heatmap scan) is cached separately in drawStatsMap.
  engine.overlayCanvas = new ex.Canvas({
    width: engine.viewWidth,
    height: engine.viewHeight,
    cache: false,
    draw: (ctx) => overlayFx.drawOverlay(engine, ctx),
  });
  engine.overlay = new ex.ScreenElement({ x: 0, y: 0, z: 100 });
  engine.overlay.graphics.use(engine.overlayCanvas);
  engine.engine.add(engine.overlay);
}

/** One TileMap entity carries every static floor/lobby tile (see the
 *  structTiles field note). Sized to the whole buildable grid so cell
 *  lookups are plain coordinate math; row 0 is the TOP floor because the
 *  map's origin is its top-left corner in world space. */
export function makeStructTileMap(engine: TowerEngine): void {
  engine.structTileMap = new ex.TileMap({
    pos: ex.vec(0, engine.worldYTop(GRID.maxFloor)),
    tileWidth: TILE,
    tileHeight: FLOOR,
    columns: GRID.width,
    rows: GRID.maxFloor - GRID.minFloor + 1,
  });
  engine.structTileMap.z = -1; // behind rooms (0) and transports (1), like the old actors
  engine.engine.add(engine.structTileMap);
}

// ---- Shared graphics ----------------------------------------------------

export function bakeSharedGraphics(engine: TowerEngine): void {
  // Structural tiles bake from a FIXED DrawCtx (not the live this.d): these
  // canvases cache on first render, so baking from live state would freeze
  // whatever lighting happened to be on screen at that moment into the tile.
  const bake = (u: Unit, lit: boolean) =>
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
      draw: (ctx) => drawLobbyEntrance({ ctx, lit, anim: engine.d.anim, hour: lit ? 20 : 12 }, kind, 0, 0, TILE, FLOOR),
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

  // The tenant/staff bake recipe. The routed crowd is the tower's foreground
  // layer, so it uses the finalized `walker` build (24px tall, art bible pages
  // 06 to 07), the same human scale the repainted rooms draw their standing
  // occupants at, instead of the legacy half-height figure that read as a
  // miniature next to a full-scale concourse. `personFigure` takes an explicit
  // fill, so the one-canvas-per-shirt scheme (indexed by seed) is unchanged.
  // Geometry: the walker's feet sit at footY = PERSON_H - 1, one pixel above
  // the canvas floor, and each actor is anchored bottom-center, so the figure
  // grows upward from the same ground line the old bake used.
  const PERSON_W = 9;
  const PERSON_H = 25; // 24px walker + a 1px contact-shadow row at the foot
  const PERSON_FOOT = PERSON_H - 1;
  const PERSON_X = 1; // centers the 7px-wide build in the 9px canvas
  const bakePerson = (color: string): ex.Canvas =>
    new ex.Canvas({
      width: PERSON_W,
      height: PERSON_H,
      cache: true,
      draw: (ctx) => personFigure(ctx, PERSON_X, PERSON_FOOT, "walker", color),
    });
  for (const color of SHIRTS) engine.personGfx.push(bakePerson(color));
  // Housekeepers wear a single work uniform, so staff read at a glance.
  engine.personGfxStaff = bakePerson("#E8E4DA");
  // Fed-up figure: the reserved stress red is the whole cue. The waiting crowd
  // massing red-shirted at an overwhelmed elevator landing reads as "these
  // tenants are fed up" on its own, so a per-figure "!" badge would only add
  // noise; the red walker uses the same bake and canvas as every other figure.
  engine.personGfxRed = bakePerson("#C24A3A");
}

export function fakeStruct(kind: "floor" | "lobby", floor = 1, x = 0): Unit {
  return {
    id: -1,
    kind,
    floor,
    x,
    width: 1,
    state: "occupied",
    satisfaction: 1,
    occupants: 0,
    everOccupied: false,
    pendingIncome: 0,
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
  ctx.fillStyle = w === "rain" ? "rgba(86,92,108,0.55)" : "rgba(244,247,255,0.72)";
  for (let i = 0; i < 5; i++) {
    const seed = i * 97 + 11;
    const speed = 6 + (seed % 7);
    const y = H * 0.1 + ((seed % 100) / 100) * H * 0.22;
    const x = (((seed * 53) % (W + 240)) + t * speed) % (W + 240) - 120;
    drawCloud(ctx, x, y, 56 + (seed % 44));
  }
}

function drawCloud(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.arc(x, y, r * 0.5, 0, Math.PI * 2);
  ctx.arc(x + r * 0.5, y + 4, r * 0.4, 0, Math.PI * 2);
  ctx.arc(x - r * 0.5, y + 4, r * 0.38, 0, Math.PI * 2);
  ctx.arc(x, y + 9, r * 0.55, 0, Math.PI * 2);
  ctx.fill();
}

function drawSun(engine: TowerEngine, ctx: CanvasRenderingContext2D): void {
  const hour = engine.sim.clock.hour + engine.sim.clock.minute / 60;
  // The sun arcs across 06:00→18:00; the moon takes the same arc 18:00→06:00,
  // so both rise in the east, climb, and set in the west.
  const day = hour >= 6 && hour < 18;
  const arc = day ? ((hour - 6) / 12) * Math.PI : (((hour - 18 + 24) % 24) / 12) * Math.PI;
  const cx = (arc / Math.PI) * engine.viewWidth;
  const cy = engine.viewHeight * 0.62 - Math.sin(arc) * engine.viewHeight * 0.5;
  ctx.fillStyle = day ? "#fff7c0" : "#eef";
  ctx.beginPath();
  ctx.arc(cx, cy, day ? 16 : 11, 0, Math.PI * 2);
  ctx.fill();
}

export function skyColor(hour: number): string {
  const t = Math.cos(((hour - 13) / 24) * Math.PI * 2) * 0.5 + 0.5; // 1 at midday
  const mix = (a: number, b: number) => Math.round(a + (b - a) * t);
  const r = mix(28, 130);
  const g = mix(34, 175);
  const b = mix(70, 224);
  const hex = (n: number) => n.toString(16).padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

// ---- Engine lifecycle ---------------------------------------------------

export function disposeScene(engine: TowerEngine): void {
  for (const cell of engine.structTiles.values()) cell.clearGraphics();
  for (const rec of engine.roomActors.values()) rec.actor.kill();
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
  engine.roomActors.clear();
  engine.roomSig.clear();
  engine.transportActors.clear();
  engine.transportSig.clear();
  crowd.clearMotion(engine);
}

export function setSim(engine: TowerEngine, sim: Simulation, opts?: { keepCamera?: boolean }): void {
  disposeScene(engine);
  crowd.clearCrowd(engine);
  // Full input reset: a tower swap (new game / load) must not inherit a
  // half-finished gesture, and dropping any tracked contacts here is the
  // recovery path if a browser ever swallows a pointer's up/cancel.
  engine.tracker.reset();
  engine.gesture = null;
  engine.arrowDrag = null;
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
  engine.builtRev = -1;
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
  // Engine.dispose()'s internal stop() is guarded by clock.isRunning(),
  // and on the recovery path the context-loss handler has already stopped
  // the clock, so that stop() would skip the texture GC and the browser
  // teardown: the GC's requestIdleCallback loop would respawn forever and
  // the per-engine window/document listeners (resize, visibilitychange)
  // would keep the dead engine graph reachable for the page's life. Run
  // both explicitly; each is idempotent, so the path where dispose()'s own
  // stop() also runs them stays correct. The GC handle is private in
  // Excalibur 0.32, hence the cast; if a future version renames it the
  // optional chain degrades to the old leak instead of a crash.
  (engine.engine as unknown as { _garbageCollector?: { stop(): void } })._garbageCollector?.stop();
  engine.engine.browser.clear();
  engine.engine.dispose();
}
