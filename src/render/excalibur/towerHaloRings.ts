import type { CatalogHalo } from "../../catalog/catalogTypes";
import { FLOOR, TILE } from "../scale";

/**
 * The range rings a venue paints while it is being placed (#1980): one band
 * across the lot for every floor its halo reaches, the venue's own stories
 * included, as strong as the engine makes it there (`max * (1 - d / floors)`,
 * from the catalog's halo, with `d` counted from the venue's nearer story),
 * then a dashed outline around the whole reach. A
 * lift paints green, a drain violet. Classic venues have no halo, so nothing
 * is painted there.
 */

/** The overlay's world-to-screen mapping, as `TowerEngine` gives it. */
export interface RingView {
  worldToScreenX(x: number): number;
  /** The screen y of the top edge of `floor`. */
  worldToScreenY(floor: number): number;
  readonly cam: { readonly zoom: number };
}

/** The lot the bands span and the floors they may cover. */
export interface RingWorld {
  readonly lotWidth: number;
  readonly minFloor: number;
  readonly maxFloor: number;
}

const LIFT_COLOR = "#4fcf86";
const DRAIN_COLOR = "#a46ad8";
/** A band's opacity on the venue's own floor; the others fade with it. */
const BAND_ALPHA = 0.3;

/** How strong `halo` is `d` floors from its venue, from 1 on its own floor
 *  to 0 at its reach, as the engine fades it. */
export function haloStrength(halo: CatalogHalo, d: number): number {
  return d < 0 || d >= halo.floors ? 0 : 1 - d / halo.floors;
}

/** How many floors `f` is from a venue whose lowest story is `floor` and
 *  that fills `stories`: 0 on any story it fills, as the engine counts it. */
export function storyDistance(f: number, floor: number, stories: number): number {
  return Math.max(floor - f, f - (floor + stories - 1), 0);
}

/** Paint `halo`'s rings around a venue placed with its lowest story on
 *  `floor`, filling `stories`. */
export function drawHaloRings(
  ctx: CanvasRenderingContext2D,
  halo: CatalogHalo,
  floor: number,
  stories: number,
  world: RingWorld,
  view: RingView,
): void {
  const color = halo.effect === "lift" ? LIFT_COLOR : DRAIN_COLOR;
  const left = view.worldToScreenX(0);
  const width = world.lotWidth * TILE * view.cam.zoom;
  const height = FLOOR * view.cam.zoom;
  const reach = Math.ceil(halo.floors) - 1;
  const top = Math.min(world.maxFloor, floor + stories - 1 + reach);
  const bottom = Math.max(world.minFloor, floor - reach);
  ctx.fillStyle = color;
  for (let f = bottom; f <= top; f++) {
    const strength = haloStrength(halo, storyDistance(f, floor, stories));
    if (strength <= 0) continue;
    ctx.globalAlpha = BAND_ALPHA * strength;
    ctx.fillRect(left, view.worldToScreenY(f), width, height);
  }
  ctx.globalAlpha = 1;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 4]);
  const y = view.worldToScreenY(top);
  ctx.strokeRect(left + 0.5, y + 0.5, width - 1, (top - bottom + 1) * height - 1);
  ctx.setLineDash([]);
}
