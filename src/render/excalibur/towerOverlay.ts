import { RAIN } from "../sprites/sky";
import { isElevatorKind } from "../../presentation/viewKinds";
import { catalogFacility } from "../../catalog/catalogTypes";
import { towerCatalog } from "../../catalog/towerCatalog";
import { viewWorld } from "../../presentation/viewWorld";
import type { BombSearchGuard, TransportView, UnitView } from "../../simport/view";
import { drawExplosion, drawSearchGuard, drawThief, drawTreasure, drawVipLimo } from "../sprites/events";
import { FLOOR, TILE } from "../scale";
import type { ScreenRect } from "./towerInputCamera";
import type { ThiefSpan, TowerEngine } from "./TowerEngine";
import { drawShaftNumbers } from "./towerShaftNumbers";
import { drawHaloRings } from "./towerHaloRings";
import { drawNoiseReach } from "./towerNoiseReach";

/**
 * The 2D canvas overlay and sky painters for {@link TowerEngine}, plus the
 * decorative event-visual bookkeeping (syncEventFx) and the sky-color helper.
 * Every painter takes the engine instance and reads its live state. Extracted
 * from `TowerEngine.ts`; the class keeps thin delegations. This is a pure code
 * move: the drawing math, ordering and Excalibur/canvas calls are unchanged.
 */

/** How long Santa takes to cross the sky, and how long a bomb flash lingers
 *  (seconds of the decorative anim clock, so both freeze under pause /
 *  reduced motion, like every other decoration). */
export const SANTA_FLIGHT_SECONDS = 7;
export const EXPLOSION_SECONDS = 0.9;
export const THIEF_RUN_SECONDS = 4;
export const TREASURE_SECONDS = 1.8;
export const VIP_VISIT_SECONDS = 6.5;
/** Hard cap on simultaneous flashes/sparkles, the events are rare, but never
 *  let the lists grow unbounded (immediate-mode draws, no actors, so this is the
 *  only bound needed). */
export const MAX_EXPLOSIONS = 8;
export const MAX_TREASURES = 6;

export function setReducedMotion(engine: TowerEngine, on: boolean): void {
  engine.reducedMotion = on;
  // A frozen anim clock can't advance an event visual to completion, so drop
  // any in flight rather than leave one stuck on screen.
  if (on) {
    engine.santaStart = null;
    engine.explosions = [];
    engine.thiefStart = null;
    engine.thiefCaught = false;
    engine.thiefSpan = null;
    engine.treasures = [];
    engine.vipStart = null;
  }
}

/** End the event visuals an undo or redo step left over empty space: a blast
 *  or a treasure dig on a spot with no room and no floor now, and a thief on a
 *  floor above or below the tower. Santa and the VIP limo belong to the whole
 *  tower (the sky and the ground lobby), so they fly on. */
export function dropStrandedFx(engine: TowerEngine): void {
  const tower = engine.sim.tower;
  const standing = (fx: { floor: number; x: number }): boolean =>
    tower.unitAt(fx.floor, fx.x) !== undefined || tower.hasStructure(fx.floor, fx.x);
  if (engine.explosions.length > 0) engine.explosions = engine.explosions.filter(standing);
  if (engine.treasures.length > 0) engine.treasures = engine.treasures.filter(standing);
  if (engine.thiefFloor > tower.highestFloor || engine.thiefFloor < tower.lowestFloor) engine.thiefStart = null;
}

/** Reset the decorative animation clock to zero. Used by the screenshot
 *  generator right after it swaps in a manually stepped clock, so the
 *  decorations start from a known phase (the pre-swap boot accumulated a
 *  wall-time-dependent amount) and every capture is reproducible. */
export function resetDecorativeClock(engine: TowerEngine): void {
  engine.animClock = 0;
  // Also zero the published value the sprites read, so the reset is effective
  // immediately even if a capture happens before the next tick() copies it.
  engine.d.anim = 0;
}

/**
 * Poll the sim's cosmetic fx counters and start/retire the matching event
 * visuals. New visuals only begin while animating (reduced motion / pause
 * suppress fresh motion, matching every other decoration); in-flight ones
 * retire when their window on the anim clock elapses. No Excalibur actors are
 * involved, these are immediate-mode draws, so there is nothing to leak.
 */
export function syncEventFx(engine: TowerEngine, animating: boolean): void {
  if (engine.sim.santaFxSeq !== engine.lastSantaSeq) {
    engine.lastSantaSeq = engine.sim.santaFxSeq;
    if (animating) engine.santaStart = engine.d.anim;
  }
  if (engine.sim.explosionFx.seq !== engine.lastExplosionSeq) {
    engine.lastExplosionSeq = engine.sim.explosionFx.seq;
    if (animating && engine.explosions.length < MAX_EXPLOSIONS) {
      engine.explosions.push({ x: engine.sim.explosionFx.x, floor: engine.sim.explosionFx.floor, start: engine.d.anim });
    }
  }
  if (engine.sim.thiefFx.seq !== engine.lastThiefSeq) {
    engine.lastThiefSeq = engine.sim.thiefFx.seq;
    // He runs the floor's rooms; a floor with none has nowhere to prowl.
    const span = animating ? floorRoomSpan(engine.sim.tower.units, engine.sim.thiefFx.floor, engine.sim.thiefFx.x) : null;
    if (span) {
      engine.thiefStart = engine.d.anim;
      engine.thiefCaught = engine.sim.thiefFx.caught;
      engine.thiefFloor = engine.sim.thiefFx.floor;
      engine.thiefSpan = span;
    }
  }
  if (engine.sim.treasureFx.seq !== engine.lastTreasureSeq) {
    engine.lastTreasureSeq = engine.sim.treasureFx.seq;
    if (animating && engine.treasures.length < MAX_TREASURES) {
      engine.treasures.push({ x: engine.sim.treasureFx.x, floor: engine.sim.treasureFx.floor, start: engine.d.anim });
    }
  }
  if (engine.sim.vipFxSeq !== engine.lastVipSeq) {
    engine.lastVipSeq = engine.sim.vipFxSeq;
    if (animating) engine.vipStart = engine.d.anim;
  }
  if (engine.santaStart !== null && engine.d.anim - engine.santaStart > SANTA_FLIGHT_SECONDS) {
    engine.santaStart = null;
  }
  if (engine.explosions.length > 0) {
    engine.explosions = engine.explosions.filter((e) => engine.d.anim - e.start <= EXPLOSION_SECONDS);
  }
  if (engine.thiefStart !== null && engine.d.anim - engine.thiefStart > THIEF_RUN_SECONDS) {
    engine.thiefStart = null;
  }
  if (engine.treasures.length > 0) {
    engine.treasures = engine.treasures.filter((t) => engine.d.anim - t.start <= TREASURE_SECONDS);
  }
  if (engine.vipStart !== null && engine.d.anim - engine.vipStart > VIP_VISIT_SECONDS) {
    engine.vipStart = null;
  }
}

export function drawOverlay(engine: TowerEngine, ctx: CanvasRenderingContext2D): void {
  if (engine.overlayCanvas.width !== engine.viewWidth || engine.overlayCanvas.height !== engine.viewHeight) {
    engine.overlayCanvas.width = engine.viewWidth;
    engine.overlayCanvas.height = engine.viewHeight;
  }
  ctx.clearRect(0, 0, engine.viewWidth, engine.viewHeight);
  drawShaftNumbers(engine, ctx);
  drawRain(engine, ctx);
  renderBombSearch(engine, ctx);
  renderExplosions(engine, ctx);
  renderTreasures(engine, ctx);
  renderVip(engine, ctx);
  renderThief(engine, ctx);
  drawPreview(engine, ctx);
  drawSelection(engine, ctx);
  drawRuler(engine, ctx);
}

/** The countdown text: hours and minutes of game time left. */
export function bombCountdownText(minutesLeft: number): string {
  const left = Math.max(0, Math.ceil(minutesLeft));
  return `💣 Bomb search: ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")} left`;
}

/** Where a guard is at minute `now`: on the emergency stairs until
 *  `arrive`, then walking the rooms left to right until `done`. On the
 *  stairs it goes from `from` to `turn` beside the rooms it left
 *  (`fromLeft`), then from `turn` to `floor` beside the rooms it is headed
 *  for, so a guard crossing to another tower walks down to the floor they
 *  share and back up instead of climbing through the sky between them. The
 *  stairs time is split by floors. `floor` may be fractional on the stairs;
 *  `x` is in tiles. */
export function guardPosition(g: BombSearchGuard, now: number): { floor: number; x: number; climbing: boolean } {
  const part = (a: number, b: number): number => (b > a ? Math.min(1, Math.max(0, (now - a) / (b - a))) : 1);
  if (now < g.arrive) {
    const down = Math.abs(g.turn - g.from);
    const total = down + Math.abs(g.floor - g.turn);
    const along = part(g.start, g.arrive) * total;
    if (along < down) return { floor: g.from + Math.sign(g.turn - g.from) * along, x: g.fromLeft - 1, climbing: true };
    return { floor: g.turn + Math.sign(g.floor - g.turn) * (along - down), x: g.left - 1, climbing: true };
  }
  return { floor: g.floor, x: g.left + (g.right - g.left) * part(g.arrive, g.done), climbing: false };
}

/** How strong the red glow at the screen's edges is during a bomb search:
 *  one slow beat a second (in step with the tick), stronger in the last game
 *  hour. Under reduced motion it holds steady, never beating. Far below any
 *  flash threshold: one soft beat a second at low contrast. */
export function bombPulseAlpha(animSeconds: number, minutesLeft: number, reducedMotion: boolean): number {
  const peak = minutesLeft <= 60 ? 0.28 : 0.16;
  if (reducedMotion) return peak * 0.6;
  const beat = 0.5 + 0.5 * Math.cos(2 * Math.PI * animSeconds);
  return peak * (0.35 + 0.65 * beat * beat);
}

/** The size a figure walking a floor (a search guard, a thief) is drawn at:
 *  the camera zoom, as the crowd is. A {@link FLOOR}-pixel floor is taller
 *  than the figure (`FIGURE_HEIGHT` in the sprites), so it stays inside its
 *  floor at every zoom; a fixed minimum once drew guards floors tall. */
export function floorFigureScale(zoom: number): number {
  return zoom;
}

/** The bomb search: each guard climbing the emergency stairs or walking a
 *  floor's rooms (where the engine's timing says it is), the time left
 *  before the deadline, and a red glow beating at the screen's edges. Under
 *  reduced motion the glow holds still. */
function renderBombSearch(engine: TowerEngine, ctx: CanvasRenderingContext2D): void {
  const search = engine.sim.bombSearch;
  if (!search) return;
  const scale = floorFigureScale(engine.cam.zoom);
  for (const g of search.sweeping) {
    const at = guardPosition(g, engine.sim.clock.minutes);
    const x = engine.worldToScreenX(at.x);
    const y = engine.worldToScreenY(at.floor) + FLOOR * engine.cam.zoom;
    drawSearchGuard(ctx, x, y, scale);
  }
  const minutesLeft = search.deadline - engine.sim.clock.minutes;
  drawEdgeGlow(ctx, engine.viewWidth, engine.viewHeight, bombPulseAlpha(engine.d.anim, minutesLeft, engine.reducedMotion));
  const text = bombCountdownText(minutesLeft);
  ctx.save();
  ctx.font = "bold 14px sans-serif";
  const w = ctx.measureText(text).width + 16;
  const x = (engine.viewWidth - w) / 2;
  ctx.fillStyle = "rgba(120,16,16,0.85)";
  ctx.fillRect(x, 8, w, 24);
  ctx.fillStyle = "#ffffff";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x + 8, 20);
  ctx.restore();
}

/** A red glow fading in from the four screen edges. */
function drawEdgeGlow(ctx: CanvasRenderingContext2D, w: number, h: number, alpha: number): void {
  const depth = Math.min(w, h) * 0.12;
  const red = (a: number): string => `rgba(200,20,20,${a})`;
  ctx.save();
  for (const [x0, y0, x1, y1, rx, ry, rw, rh] of [
    [0, 0, 0, depth, 0, 0, w, depth],
    [0, h, 0, h - depth, 0, h - depth, w, depth],
    [0, 0, depth, 0, 0, 0, depth, h],
    [w, 0, w - depth, 0, w - depth, 0, depth, h],
  ] as const) {
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, red(alpha));
    g.addColorStop(1, red(0));
    ctx.fillStyle = g;
    ctx.fillRect(rx, ry, rw, rh);
  }
  ctx.restore();
}

/** Bomb-blast flashes at their epicenters, projected to screen (see syncEventFx). */
function renderExplosions(engine: TowerEngine, ctx: CanvasRenderingContext2D): void {
  if (engine.explosions.length === 0) return;
  for (const e of engine.explosions) {
    const p = (engine.d.anim - e.start) / EXPLOSION_SECONDS;
    if (p < 0 || p > 1) continue;
    const sx = engine.worldToScreenX(e.x);
    const sy = engine.worldToScreenY(e.floor) + (FLOOR * engine.cam.zoom) / 2;
    const radius = (24 + p * 56) * engine.cam.zoom;
    drawExplosion(ctx, sx, sy, radius, p);
  }
}

/** Gold sparkles rising from unearthed-treasure dig sites (see syncEventFx). */
function renderTreasures(engine: TowerEngine, ctx: CanvasRenderingContext2D): void {
  if (engine.treasures.length === 0) return;
  for (const t of engine.treasures) {
    const p = (engine.d.anim - t.start) / TREASURE_SECONDS;
    if (p < 0 || p > 1) continue;
    const sx = engine.worldToScreenX(t.x);
    const sy = engine.worldToScreenY(t.floor) + (FLOOR * engine.cam.zoom) / 2;
    drawTreasure(ctx, sx, sy, Math.max(0.8, engine.cam.zoom), p);
  }
}

/** The VIP limo arriving at the ground lobby: in from the left, hold, off right. */
function renderVip(engine: TowerEngine, ctx: CanvasRenderingContext2D): void {
  if (engine.vipStart === null) return;
  const p = (engine.d.anim - engine.vipStart) / VIP_VISIT_SECONDS;
  if (p < 0 || p > 1) return;
  const centerSx = engine.worldToScreenX(viewWorld().lotWidth / 2);
  const groundSy = engine.worldToScreenY(1) + FLOOR * engine.cam.zoom * 0.5;
  const off = engine.viewWidth * 0.6;
  // The limo faces right, so it drives rightward: in from the left, hold, out
  // to the right (otherwise it moon-walks).
  let x = centerSx;
  if (p < 0.25) x = centerSx - (1 - p / 0.25) * off; // arrive from the left
  else if (p > 0.75) x = centerSx + ((p - 0.75) / 0.25) * off; // depart to the right
  drawVipLimo(ctx, x, groundSy, Math.max(0.9, engine.cam.zoom));
}

/** The tile span of the rooms on `floor` (left edge, right edge), or null
 *  when it has none. Bare floor and lobby tiles do not count, the same span
 *  the bomb search's guards walk. Given `x`, only the rooms on the run of
 *  floor and lobby tiles holding that tile count: one tower's part of the
 *  floor on a lot with several. One pass over the units, made once when a
 *  thief appears (at most once a game day), never per frame. */
export function floorRoomSpan(
  units: ReadonlyArray<Pick<UnitView, "kind" | "floor" | "x" | "width">>,
  floor: number,
  x?: number,
): ThiefSpan | null {
  const run = x === undefined || !Number.isFinite(x) ? null : structuralRun(units, floor, x);
  let span: ThiefSpan | null = null;
  for (const u of units) {
    if (u.floor !== floor || u.kind === "floor" || u.kind === "lobby") continue;
    if (run && (u.x > run.right || u.x + u.width <= run.left)) continue;
    if (!span) span = { left: u.x, right: u.x + u.width };
    else span = { left: Math.min(span.left, u.x), right: Math.max(span.right, u.x + u.width) };
  }
  return span;
}

/** The run of floor and lobby tiles on `floor` that holds tile `x`, as its
 *  first and last tiles, or null when no such tile is there. */
function structuralRun(
  units: ReadonlyArray<Pick<UnitView, "kind" | "floor" | "x" | "width">>,
  floor: number,
  x: number,
): ThiefSpan | null {
  const pieces: Array<[number, number]> = [];
  for (const u of units) {
    if (u.floor === floor && (u.kind === "floor" || u.kind === "lobby")) pieces.push([u.x, u.x + u.width - 1]);
  }
  pieces.sort((a, b) => a[0] - b[0]);
  let run: ThiefSpan | null = null;
  for (const [first, last] of pieces) {
    if (run && first <= run.right + 1) run = { left: run.left, right: Math.max(run.right, last) };
    else if (run && run.left <= x && x <= run.right) return run;
    else run = { left: first, right: last };
  }
  return run && run.left <= x && x <= run.right ? run : null;
}

/** Where the thief is, in tiles, a fraction `p` of the way through his run:
 *  he comes off the emergency stairs just left of the floor's rooms (where
 *  the guards climb) and runs the rooms to their right edge. */
export function thiefX(span: ThiefSpan, p: number): number {
  const from = span.left - 1;
  return from + (span.right - from) * Math.min(1, Math.max(0, p));
}

/** A thief running along the floor he's prowling (a guard trails him if
 *  caught), in world space: feet on that floor, from the emergency stairs at
 *  the left of its rooms to their right edge, scrolling with the camera. */
function renderThief(engine: TowerEngine, ctx: CanvasRenderingContext2D): void {
  if (engine.thiefStart === null || engine.thiefSpan === null) return;
  const p = (engine.d.anim - engine.thiefStart) / THIEF_RUN_SECONDS;
  if (p < 0 || p > 1) return;
  const x = engine.worldToScreenX(thiefX(engine.thiefSpan, p));
  const y = engine.worldToScreenY(engine.thiefFloor) + FLOOR * engine.cam.zoom;
  drawThief(ctx, x, y, floorFigureScale(engine.cam.zoom), engine.thiefCaught);
}

/** Rain falls in front of the tower on rainy days (overlay layer). */
function drawRain(engine: TowerEngine, ctx: CanvasRenderingContext2D): void {
  if (engine.sim.weather !== "rain") return;
  const W = engine.viewWidth;
  const H = engine.viewHeight;
  const t = engine.d.anim;
  // A faint overcast tint over the whole scene.
  ctx.fillStyle = RAIN.tint;
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = RAIN.stroke;
  ctx.lineWidth = RAIN.lineWidth;
  ctx.beginPath();
  for (let i = 0; i < RAIN.count; i++) {
    const x = ((i * RAIN.xMul) >>> 0) % W;
    const y = (((i * RAIN.yStep) % H) + t * RAIN.speed) % H;
    ctx.moveTo(x, y);
    ctx.lineTo(x + RAIN.dx, y + RAIN.dy);
  }
  ctx.stroke();
}

/** The translucent placement ghost: gold when valid, red when not. One
 *  explicit stroke width for both ghost kinds, the old transport ghost
 *  never set its own and inherited whatever the overlay context last used
 *  (1, 1.5, or 2 depending on rain/selection), a nondeterminism this pins. */
function drawGhostRect(ctx: CanvasRenderingContext2D, sx: number, sy: number, sw: number, sh: number, valid: boolean): void {
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = valid ? "#ffd24a" : "#cc3333";
  ctx.fillRect(sx, sy, sw, sh);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = valid ? "#fff" : "#ff5555";
  ctx.lineWidth = 1.5;
  ctx.strokeRect(sx + 0.5, sy + 0.5, sw - 1, sh - 1);
}

/** The golden selection outline shared by units and shafts. */
function strokeSelection(ctx: CanvasRenderingContext2D, sx: number, sy: number, sw: number, sh: number): void {
  ctx.strokeStyle = "#ffd24a";
  ctx.lineWidth = 2;
  ctx.strokeRect(sx - 1, sy - 1, sw + 2, sh + 2);
}

function drawPreview(engine: TowerEngine, ctx: CanvasRenderingContext2D): void {
  if (engine.preview) {
    const p = engine.preview;
    const catalog = towerCatalog(engine.sim);
    const f = catalogFacility(catalog, p.kind);
    // A venue's halo shows where it reaches before it is placed (#1980).
    const hgt = f.floors;
    if (f.halo) drawHaloRings(ctx, f.halo, p.floor, hgt, catalog.world, engine);
    // Floor/lobby tools lay a multi-tile brush strip; `span` (when set) is the
    // real footprint so the shadow matches what a click actually places.
    const w = p.span ?? f.width;
    // And how far its noise carries along its floor, or how far it hears.
    drawNoiseReach(ctx, f.noise, { floor: p.floor, floors: hgt, x: p.x, width: w }, engine.sim.tower, engine);
    const sx = engine.worldToScreenX(p.x);
    const sy = engine.worldToScreenY(p.floor + hgt - 1);
    const sw = w * TILE * engine.cam.zoom;
    const sh = hgt * FLOOR * engine.cam.zoom;
    drawGhostRect(ctx, sx, sy, sw, sh, p.valid);
  }
  if (engine.transportPreview) {
    const p = engine.transportPreview;
    const w = catalogFacility(towerCatalog(engine.sim), p.kind).width;
    const sx = engine.worldToScreenX(p.x);
    const sy = engine.worldToScreenY(p.top);
    const sw = w * TILE * engine.cam.zoom;
    const sh = (p.top - p.bottom + 1) * FLOOR * engine.cam.zoom;
    drawGhostRect(ctx, sx, sy, sw, sh, p.valid);
  }
}

function drawSelection(engine: TowerEngine, ctx: CanvasRenderingContext2D): void {
  engine.arrowHit = {};
  if (engine.selectedId == null) return;
  const u = engine.sim.tower.getUnit(engine.selectedId);
  if (u) {
    const hgt = catalogFacility(towerCatalog(engine.sim), u.kind).floors;
    const sx = engine.worldToScreenX(u.x);
    const sy = engine.worldToScreenY(u.floor + hgt - 1);
    strokeSelection(ctx, sx, sy, u.width * TILE * engine.cam.zoom, hgt * FLOOR * engine.cam.zoom);
    return;
  }
  const t = engine.sim.tower.getTransport(engine.selectedId);
  if (t) drawTransportSelection(engine, ctx, t);
}

/** Outline the selected shaft and, for elevators, draw clickable extend
 *  arrows above the top and below the bottom (as in the original). */
function drawTransportSelection(engine: TowerEngine, ctx: CanvasRenderingContext2D, t: TransportView): void {
  const z = engine.cam.zoom;
  const sx = engine.worldToScreenX(t.x);
  const sw = t.width * TILE * z;
  const top = engine.worldToScreenY(t.top);
  const bottom = top + (t.top - t.bottom + 1) * FLOOR * z;
  strokeSelection(ctx, sx, top, sw, bottom - top);
  if (!isElevatorKind(t.kind)) return; // only lifts extend by a tappable arrow

  // Small, subtle tabs centered on the shaft, discoverable without dominating
  // the view. The hit rect is a touch larger than the drawn tab for easy use.
  const cx = sx + sw / 2;
  const tabW = Math.min(sw, 18);
  const tabH = 11;
  const up: ScreenRect = { x: cx - tabW / 2, y: top - tabH - 3, w: tabW, h: tabH };
  const down: ScreenRect = { x: cx - tabW / 2, y: bottom + 3, w: tabW, h: tabH };
  engine.arrowHit = {
    up: { x: up.x - 4, y: up.y - 4, w: up.w + 8, h: up.h + 8 },
    down: { x: down.x - 4, y: down.y - 4, w: down.w + 8, h: down.h + 8 },
  };
  const drawArrow = (r: ScreenRect, dir: "up" | "down") => {
    ctx.fillStyle = "rgba(20,24,32,0.6)";
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.fillStyle = "#ffd24a";
    const my = r.y + r.h / 2;
    const a = 4;
    ctx.beginPath();
    if (dir === "up") {
      ctx.moveTo(cx, my - a);
      ctx.lineTo(cx - a, my + a - 1);
      ctx.lineTo(cx + a, my + a - 1);
    } else {
      ctx.moveTo(cx, my + a);
      ctx.lineTo(cx - a, my - a + 1);
      ctx.lineTo(cx + a, my - a + 1);
    }
    ctx.closePath();
    ctx.fill();
  };
  drawArrow(up, "up");
  drawArrow(down, "down");
}

function drawRuler(engine: TowerEngine, ctx: CanvasRenderingContext2D): void {
  ctx.font = "10px monospace";
  ctx.textBaseline = "middle";
  const top = engine.screenToFloor(0) + 1;
  const bot = engine.screenToFloor(engine.viewHeight) - 1;
  for (let f = bot; f <= top; f++) {
    // worldToScreenY(f) is floor f's TOP edge; center the label on the row
    // (+half a floor). Using -half shifted every label up one floor, so the
    // ground lobby (floor 1) showed the "B1" tag and the elevator's own floor
    // numbers didn't line up with the ruler.
    const sy = engine.worldToScreenY(f) + (FLOOR * engine.cam.zoom) / 2;
    if (sy < 12 || sy > engine.viewHeight - 2) continue;
    const label = f >= 1 ? `${f}` : `B${1 - f}`;
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.fillRect(0, sy - 7, 22, 14);
    ctx.fillStyle = f === 1 || f % 15 === 0 ? "#ffd24a" : "#cfcfcf";
    ctx.fillText(label, 3, sy);
  }
  ctx.textBaseline = "alphabetic";
}
