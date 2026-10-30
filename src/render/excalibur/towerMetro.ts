import * as ex from "excalibur";
import { Z } from "../depthPlanes";
import { viewWorld } from "../../presentation/viewWorld";
import type { UnitView } from "../../simport/view";
import { FLOOR, TILE } from "../scale";
import { METRO_TUNNEL_TILE, drawMetroTunnel } from "../sprites/facilities";
import { METRO_PORTAL_W, METRO_TRAIN_H, drawMetroPortal, drawMetroTrain } from "../sprites/facilities/vehicles";
import type { TowerEngine } from "./TowerEngine";

/**
 * The metro's moving and tunnel parts: the train, the tunnel row either side of
 * the 30-wide station, and the portals where the train disappears into it.
 * Friend functions taking the engine, like the rest of `towerCrowd`.
 */

/** The station's train, tunnel row and portals. The car sits on the track just
 *  below the platform edge: its base is 3px off the station floor and it stands
 *  METRO_TRAIN_H tall. */
export function addMetro(engine: TowerEngine, u: UnitView): void {
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
  addTunnel(engine, u);
  addPortals(engine, u, trainY);
}

/** SimTower lays the tunnel along the station's bottom story on both sides, out
 *  to the lot's edges. Tiles are phase-aligned to the world x so every span
 *  carries the same pattern, each under the texture-size limit. */
function addTunnel(engine: TowerEngine, u: UnitView): void {
  const y = engine.worldYTop(u.floor);
  const lotEnd = viewWorld().lotWidth * TILE;
  const sides: [number, number][] = [[0, engine.worldX(u.x)], [engine.worldX(u.x + u.width), lotEnd]];
  for (const [from, to] of sides) {
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
