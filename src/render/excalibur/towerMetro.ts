import * as ex from "excalibur";
import { Z } from "../depthPlanes";
import { viewWorld } from "../../presentation/viewWorld";
import type { UnitView } from "../../simport/view";
import { FLOOR, TILE } from "../scale";
import { METRO_TUNNEL_TILE, drawMetroTunnel } from "../sprites/facilities";
import { METRO_PORTAL_W, METRO_TRAIN_H, drawMetroPortal, drawMetroTrain } from "../sprites/facilities/vehicles";
import type { TowerEngine } from "./TowerEngine";

/**
 * The metro's moving and tunnel parts: each station's train and the portals
 * where it disappears, and the tunnel row along the stations' bottom story.
 * Friend functions taking the engine, like the rest of `towerCrowd`.
 */

/** Every station's train and portals, and one tunnel along their row. A Modern
 *  tower may run several stations on one line, so the tunnel is laid once, in
 *  the gaps the stations leave. */
export function addMetros(engine: TowerEngine, stations: readonly UnitView[]): void {
  for (const u of stations) addMetro(engine, u);
  const rows = new Map<number, UnitView[]>();
  for (const u of stations) rows.set(u.floor, [...(rows.get(u.floor) ?? []), u]);
  for (const [floor, onRow] of rows) addTunnel(engine, floor, tunnelSpans(onRow, viewWorld().lotWidth));
}

/** The tile spans `[from, to)` of a station row the tunnel fills: the whole lot
 *  less every station's footprint. SimTower lays the tunnel on both sides of its
 *  one station out to the lot's edges. */
export function tunnelSpans(stations: readonly { x: number; width: number }[], lotWidth: number): [number, number][] {
  const spans: [number, number][] = [];
  let from = 0;
  for (const u of [...stations].sort((a, b) => a.x - b.x)) {
    if (u.x > from) spans.push([from, u.x]);
    from = Math.max(from, u.x + u.width);
  }
  if (from < lotWidth) spans.push([from, lotWidth]);
  return spans;
}

/** The station's train and portals. The car sits on the track just below the
 *  platform edge: its base is 3px off the station floor and it stands
 *  METRO_TRAIN_H tall. */
function addMetro(engine: TowerEngine, u: UnitView): void {
  const w = u.width * TILE - 6;
  const trainY = engine.worldYTop(u.floor) + FLOOR - 3 - METRO_TRAIN_H;
  // The consist is baked once; the actor stays on the station and its canvas
  // clips the train to the station footprint. The portals at both ends hide the
  // cut, so the train slides out of and back into the tunnel.
  const bake = document.createElement("canvas");
  bake.width = w;
  bake.height = METRO_TRAIN_H;
  drawMetroTrain(bake.getContext("2d")!, w, true);
  let offset = 0;
  const cv = new ex.Canvas({ width: w, height: METRO_TRAIN_H, cache: true, draw: (ctx) => ctx.drawImage(bake, Math.round(offset), 0) });
  const a = new ex.Actor({ pos: ex.vec(engine.worldX(u.x) + 3, trainY), width: w, height: METRO_TRAIN_H, anchor: ex.vec(0, 0), z: Z.vehicle });
  a.graphics.use(cv);
  engine.engine.add(a);
  const shift = (next: number): void => {
    if (next === offset) return;
    offset = next;
    cv.flagDirty();
  };
  engine.trainActors.push({ actor: a, u, w, shift });
  addPortals(engine, u, trainY);
}

/** The tunnel along the stations' bottom story, over the tile `spans` from
 *  `tunnelSpans`. Tiles are phase-aligned to the world x so every span carries
 *  the same pattern, each under the texture-size limit. */
function addTunnel(engine: TowerEngine, floor: number, spans: readonly [number, number][]): void {
  const y = engine.worldYTop(floor);
  for (const [fromTile, toTile] of spans) {
    const [from, to] = [engine.worldX(fromTile), engine.worldX(toTile)];
    for (let x = from; x < to; ) {
      const tileStart = Math.floor(x / METRO_TUNNEL_TILE) * METRO_TUNNEL_TILE;
      const end = Math.min(tileStart + METRO_TUNNEL_TILE, to);
      const w = end - x;
      const phase = x - tileStart;
      const cv = new ex.Canvas({
        width: w,
        height: FLOOR,
        cache: true,
        draw: (ctx) => {
          ctx.translate(-phase, 0);
          drawMetroTunnel(ctx);
        },
      });
      const a = new ex.Actor({ pos: ex.vec(x, y), width: w, height: FLOOR, anchor: ex.vec(0, 0), z: Z.structure });
      a.graphics.use(cv);
      engine.engine.add(a);
      engine.tunnelActors.push(a);
      x = end;
    }
  }
}

/** A dark mouth at each end of the station, drawn over the train: the train
 *  comes out of the dark and goes back into it. */
function addPortals(engine: TowerEngine, u: UnitView, trainY: number): void {
  const h = METRO_TRAIN_H + 3;
  for (const side of ["left", "right"] as const) {
    const x = side === "left" ? engine.worldX(u.x) : engine.worldX(u.x + u.width) - METRO_PORTAL_W;
    const cv = new ex.Canvas({ width: METRO_PORTAL_W, height: h, cache: true, draw: (ctx) => drawMetroPortal(ctx, METRO_PORTAL_W, h, side) });
    const a = new ex.Actor({ pos: ex.vec(x, trainY), width: METRO_PORTAL_W, height: h, anchor: ex.vec(0, 0), z: Z.vehicle + 0.05 });
    a.graphics.use(cv);
    engine.engine.add(a);
    engine.tunnelActors.push(a);
  }
}
