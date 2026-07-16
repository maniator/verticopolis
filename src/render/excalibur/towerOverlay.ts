import type { HeatmapMode } from "../../engine/Simulation";
import { GRID, facilityFloors, isElevatorKind } from "../../engine/facilities";
import type { Transport, Unit } from "../../engine/types";
import { drawExplosion, drawThief, drawTreasure, drawVipLimo } from "../sprites/events";
import { FLOOR, TILE } from "../scale";
import type { ScreenRect } from "./towerInputCamera";
import type { TowerEngine } from "./TowerEngine";

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

/** Legend copy for each stats-overlay mode. */
export const HEATMAP_LABELS: Record<HeatmapMode, { title: string; good: string; bad: string }> = {
  congestion: { title: "Congestion", good: "clear", bad: "jammed" },
  occupancy: { title: "Occupancy", good: "full", bad: "vacant" },
  satisfaction: { title: "Satisfaction", good: "happy", bad: "unhappy" },
  cleanliness: { title: "Housekeeping", good: "covered", bad: "unreached" },
};

/** The overlay modes in cycle order (a UI toggle steps Off → each → Off). */
export const HEATMAP_MODES: HeatmapMode[] = ["congestion", "occupancy", "satisfaction", "cleanliness"];

/** Heatmap ramp stops (green → chartreuse → amber → red). The chartreuse
 *  waypoint gives the green→amber leg real resolution, so the lived-in low end
 *  of a metric (e.g. a healthy tower's congestion) reads as a gradient rather
 *  than one flat green. The congestion overlay pins its amber stop (⅔) to the
 *  churn threshold, see `CONGESTION_AMBER_SEVERITY` in the engine. Module-level
 *  so the color mixer doesn't rebuild the table on every call (it runs once per
 *  visible floor per frame while an overlay is active). */
export const HEAT_STOPS: readonly (readonly [number, number, number])[] = [
  [63, 184, 90], // green (good)
  [163, 199, 71], // chartreuse
  [224, 169, 78], // amber — the congestion overlay pins churn here (see below)
  [214, 52, 47], // red (bad)
];
const HEAT_SEGS = HEAT_STOPS.length - 1;

/** Severity 0..1 → an rgba tint (green → chartreuse → amber → red) at a fixed
 *  overlay alpha. Linear segments through the evenly-spaced {@link HEAT_STOPS}
 *  so the ramp reads cleanly. Allocation-light (no per-call array/closure) since
 *  it's on the draw path.
 *
 *  Exported for the overlay test that locks the "amber = churn" invariant: the
 *  congestion ramp's `CONGESTION_AMBER_SEVERITY` (⅔) must land exactly on the
 *  amber stop, which holds only while the palette keeps amber at position
 *  ⅔, i.e. a 4-stop ramp. A test asserts that so a palette edit can't silently
 *  break the anchor. */
export function heatColor(severity: number): string {
  // Clamp to [0,1]; the `> 0` form also folds NaN to 0 so a poisoned severity
  // can never index past the palette and throw on the draw path.
  const s = severity > 0 ? (severity > 1 ? 1 : severity) : 0;
  const seg = Math.min(HEAT_SEGS - 1, Math.floor(s * HEAT_SEGS));
  const t = s * HEAT_SEGS - seg; // 0..1 within the segment
  const a = HEAT_STOPS[seg];
  const b = HEAT_STOPS[seg + 1];
  const r = Math.round(a[0] + (b[0] - a[0]) * t);
  const g = Math.round(a[1] + (b[1] - a[1]) * t);
  const bl = Math.round(a[2] + (b[2] - a[2]) * t);
  return `rgba(${r},${g},${bl},0.4)`;
}

export function setReducedMotion(engine: TowerEngine, on: boolean): void {
  engine.reducedMotion = on;
  // A frozen anim clock can't advance an event visual to completion, so drop
  // any in flight rather than leave one stuck on screen.
  if (on) {
    engine.santaStart = null;
    engine.explosions = [];
    engine.thiefStart = null;
    engine.thiefCaught = false;
    engine.treasures = [];
    engine.vipStart = null;
  }
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
    if (animating) {
      engine.thiefStart = engine.d.anim;
      engine.thiefCaught = engine.sim.thiefFx.caught;
      engine.thiefFloor = engine.sim.thiefFx.floor;
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
  drawStatsMap(engine, ctx);
  drawRain(engine, ctx);
  renderExplosions(engine, ctx);
  renderTreasures(engine, ctx);
  renderVip(engine, ctx);
  renderThief(engine, ctx);
  drawPreview(engine, ctx);
  drawSelection(engine, ctx);
  drawRuler(engine, ctx);
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
  const centerSx = engine.worldToScreenX(GRID.width / 2);
  const groundSy = engine.worldToScreenY(1) + FLOOR * engine.cam.zoom * 0.5;
  const off = engine.viewWidth * 0.6;
  // The limo faces right, so it drives rightward: in from the left, hold, out
  // to the right (otherwise it moon-walks).
  let x = centerSx;
  if (p < 0.25) x = centerSx - (1 - p / 0.25) * off; // arrive from the left
  else if (p > 0.75) x = centerSx + ((p - 0.75) / 0.25) * off; // depart to the right
  drawVipLimo(ctx, x, groundSy, Math.max(0.9, engine.cam.zoom));
}

/** A thief slinking along a tower floor (a guard trails him if caught). He
 *  sweeps left→right across the viewport, but his feet are pinned to the
 *  floor he's prowling (world-space Y, like the VIP limo), so he walks the
 *  tower and scrolls with the camera instead of floating at mid-screen. */
function renderThief(engine: TowerEngine, ctx: CanvasRenderingContext2D): void {
  if (engine.thiefStart === null) return;
  const p = (engine.d.anim - engine.thiefStart) / THIEF_RUN_SECONDS;
  if (p < 0 || p > 1) return;
  const x = -80 + p * (engine.viewWidth + 160);
  const y = engine.worldToScreenY(engine.thiefFloor) + FLOOR * engine.cam.zoom * 0.5;
  drawThief(ctx, x, y, Math.max(0.9, engine.cam.zoom), engine.thiefCaught);
}

/** The colored stats overlay: draw each heatmap cell by the active metric
 *  (green = good … red = bad) with a legend, one cell per floor for
 *  congestion/occupancy, one per present unit for satisfaction (so a floor can
 *  show several tints). The heatmap is recomputed only when its inputs change
 *  (hour / layout / mode), never per frame. */
function drawStatsMap(engine: TowerEngine, ctx: CanvasRenderingContext2D): void {
  if (!engine.overlayMode) return;
  const hour = engine.sim.clock.hour;
  // The congestion source reads live commercial customers (censusCount ->
  // customersIn), which move as meal round-trippers arrive and leave, so the
  // congestion overlay must also invalidate on the meal-overlay revision or
  // its cells and peak legend trail the traffic chip by up to an hour during
  // a meal window. The other overlay modes stay hour-and-structure keyed.
  // Two numeric fields instead of a composite string: this runs every frame
  // while an overlay is open, and per-frame string building is GC churn.
  const towerRev = engine.sim.tower.revision;
  const mealRev = engine.overlayMode === "congestion" ? engine.sim.tower.mealOverlayRevision : 0;
  if (
    engine.overlayMode !== engine.heatmapMode ||
    hour !== engine.heatmapHour ||
    towerRev !== engine.heatmapTowerRev ||
    mealRev !== engine.heatmapMealRev
  ) {
    engine.heatmap = engine.sim.floorHeatmap(engine.overlayMode);
    engine.heatmapPeakCongestion = engine.overlayMode === "congestion" ? engine.sim.peakCongestion() : 0;
    engine.heatmapMode = engine.overlayMode;
    engine.heatmapHour = hour;
    engine.heatmapTowerRev = towerRev;
    engine.heatmapMealRev = mealRev;
  }
  const z = engine.cam.zoom;
  // Visible floor band (computed once) to skip the coordinate transforms for
  // off-screen cells. The loop still visits every cell, but worldToScreenX/Y
  // each run the engine's affine transform and satisfaction can emit one cell
  // per present tenant unit, so gating those two transforms on the band avoids
  // paying them for every off-screen unit in a tall tower each frame.
  const topFloor = engine.screenToFloor(0) + 1;
  const botFloor = engine.screenToFloor(engine.viewHeight) - 1;
  for (const cell of engine.heatmap) {
    if (cell.floor < botFloor || cell.floor > topFloor) continue;
    const sx = engine.worldToScreenX(cell.minX);
    const sy = engine.worldToScreenY(cell.floor);
    const sw = (cell.maxX - cell.minX + 1) * TILE * z;
    const sh = FLOOR * z;
    // Exact per-cell cull for horizontal extent (and any residual vertical
    // slop past the floor-band margin) so partial-edge tints still draw right.
    if (sy + sh < 0 || sy > engine.viewHeight || sx + sw < 0 || sx > engine.viewWidth) continue;
    ctx.fillStyle = heatColor(cell.severity);
    ctx.fillRect(sx, sy, sw, sh);
  }
  drawHeatLegend(engine, ctx);
}

/** A compact legend for the active overlay: its name and a good→bad gradient. */
function drawHeatLegend(engine: TowerEngine, ctx: CanvasRenderingContext2D): void {
  const label = HEATMAP_LABELS[engine.overlayMode ?? "congestion"];
  const pad = 10;
  const x = 12;
  const y = 12;
  const w = 150;
  const h = 46;
  ctx.fillStyle = "rgba(16,20,28,0.8)";
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = "rgba(255,255,255,0.18)";
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  ctx.fillStyle = "#e6ecf5";
  ctx.font = "600 12px system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(label.title, x + pad, y + 17);
  // Congestion reports its busiest floor as a number so an all-green map still
  // tells the player their headroom (peak = share of a shaft's rush budget in
  // use; >100% means over the churn line). Right-aligned on the title row.
  if (engine.overlayMode === "congestion") {
    ctx.textAlign = "right";
    ctx.fillStyle = "#c7d0e0";
    ctx.font = "600 11px system-ui, sans-serif";
    ctx.fillText(`peak ${Math.round(engine.heatmapPeakCongestion * 100)}%`, x + w - pad, y + 17);
    ctx.textAlign = "left";
  }
  // Gradient bar.
  const bx = x + pad;
  const by = y + 24;
  const bw = w - pad * 2;
  const grad = ctx.createLinearGradient(bx, 0, bx + bw, 0);
  for (let i = 0; i < HEAT_STOPS.length; i++) grad.addColorStop(i / HEAT_SEGS, heatColor(i / HEAT_SEGS));
  ctx.fillStyle = grad;
  ctx.fillRect(bx, by, bw, 7);
  ctx.fillStyle = "#9aa6bd";
  ctx.font = "10px system-ui, sans-serif";
  ctx.fillText(label.good, bx, by + 18);
  ctx.textAlign = "right";
  ctx.fillText(label.bad, bx + bw, by + 18);
  ctx.textAlign = "left";
}

/** Rain falls in front of the tower on rainy days (overlay layer). */
function drawRain(engine: TowerEngine, ctx: CanvasRenderingContext2D): void {
  if (engine.sim.weather !== "rain") return;
  const W = engine.viewWidth;
  const H = engine.viewHeight;
  const t = engine.d.anim;
  // A faint overcast tint over the whole scene.
  ctx.fillStyle = "rgba(34,40,56,0.16)";
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = "rgba(200,214,236,0.45)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i < 140; i++) {
    const x = ((i * 2654435761) >>> 0) % W;
    const y = (((i * 37) % H) + t * 320) % H;
    ctx.moveTo(x, y);
    ctx.lineTo(x - 3, y + 9);
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
    const hgt = facilityFloors(p.kind);
    // Floor/lobby tools lay a multi-tile brush strip; `span` (when set) is the
    // real footprint so the shadow matches what a click actually places.
    const w = p.span ?? engine.sim.tower.facilityOf({ kind: p.kind } as Unit).width;
    const sx = engine.worldToScreenX(p.x);
    const sy = engine.worldToScreenY(p.floor + hgt - 1);
    const sw = w * TILE * engine.cam.zoom;
    const sh = hgt * FLOOR * engine.cam.zoom;
    drawGhostRect(ctx, sx, sy, sw, sh, p.valid);
  }
  if (engine.transportPreview) {
    const p = engine.transportPreview;
    const w = engine.sim.tower.facilityOf({ kind: p.kind } as Unit).width;
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
    const hgt = facilityFloors(u.kind);
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
function drawTransportSelection(engine: TowerEngine, ctx: CanvasRenderingContext2D, t: Transport): void {
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
