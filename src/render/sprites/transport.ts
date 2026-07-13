import { FACILITIES, isElevatorKind } from "../../engine/facilities";
import type { FacilityKind, Transport } from "../../engine/types";
import { person } from "../pixelSprites";
import type { CarArrow } from "../carIndicator";
import { shade } from "./common";

// ---- Transport ----------------------------------------------------------

export function drawTransport(
  ctx: CanvasRenderingContext2D,
  t: Transport,
  sx: number,
  topY: number,
  w: number,
  floorH: number,
): void {
  const f = FACILITIES[t.kind];
  const height = (t.top - t.bottom + 1) * floorH;

  // NOTE: this draws only the *static* structure. Everything that moves
  // (elevator cars, stair/escalator climbers) is a separate Excalibur Actor
  // positioned by the engine — see TowerEngine's dynamic layer.

  if (t.kind === "stairs") {
    // No solid background — as in the original, stairs are an open structure you
    // see the tower *through*; only the treads/handrail are drawn (in front of
    // rooms via the engine's z-order). One FLIGHT per connected floor pair: the
    // top band is just the arrival landing, so it stays empty — a two-floor
    // stairway draws exactly one staircase, not two stacked ones.
    for (let fl = 1; fl <= t.top - t.bottom; fl++) {
      const fy = topY + fl * floorH;
      const steps = 5;
      const stepW = (w - 2) / steps;
      const stepH = (floorH - 3) / steps;
      for (let s = 0; s < steps; s++) {
        const sxS = sx + 1 + s * stepW;
        const syS = fy + floorH - 2 - (s + 1) * stepH;
        ctx.fillStyle = "#a9a290";
        ctx.fillRect(sxS, syS, stepW + 1, stepH + 1);
        ctx.fillStyle = "rgba(0,0,0,0.18)";
        ctx.fillRect(sxS, syS, stepW + 1, 1);
      }
    }
    return;
  }

  if (t.kind === "escalator") {
    // Open structure like the stairs — no solid backing, you see the tower
    // behind it. Just the diagonal belt and step ridges, rising from the
    // BOTTOM band up to the arrival floor (the top band is the landing).
    const by = topY + (t.top - t.bottom) * floorH;
    ctx.strokeStyle = "#cfd4dc"; // belt
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(sx + 1, by + floorH - 1);
    ctx.lineTo(sx + w - 1, by + 1);
    ctx.stroke();
    ctx.strokeStyle = "rgba(0,0,0,0.28)"; // step ridges
    ctx.lineWidth = 1;
    for (let s = 2; s < w; s += 4) {
      const yy = by + floorH - (s / w) * floorH;
      ctx.beginPath();
      ctx.moveTo(sx + s, yy);
      ctx.lineTo(sx + s + 1, yy);
      ctx.stroke();
    }
    return;
  }

  if (isElevatorKind(t.kind)) {
    // Dark shaft tinted by elevator type, with rails and floor stops.
    ctx.fillStyle = shade(f.color, -34);
    ctx.fillRect(sx, topY, w, height);
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(sx + 1, topY, 1, height);
    ctx.fillRect(sx + w - 2, topY, 1, height);
    // Floor numbers painted on the shaft backing, as in the original — the car
    // (a separate actor) rides over them, so only the empty shaft shows them.
    // (fillStyle is set per-element inside the loop below.)
    ctx.font = `bold ${Math.min(floorH - 4, 8)}px "MS Sans Serif", monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    // Express elevators skip floors; like the original, a floor the car doesn't
    // stop at shows no stop line and no number — the shaft just passes through.
    const skip = t.skipFloors && t.skipFloors.length ? new Set(t.skipFloors) : null;
    for (let fl = 0; fl <= t.top - t.bottom; fl++) {
      const num = t.top - fl; // band fl counts down from the top floor
      if (skip && skip.has(num)) continue; // not a stop — leave the shaft blank here
      const fy = topY + fl * floorH;
      ctx.fillStyle = "rgba(255,255,255,0.05)";
      ctx.fillRect(sx + 1, fy, w - 2, 1); // per-floor stop line
      const label = num >= 1 ? String(num) : `B${1 - num}`;
      const lx = sx + w / 2;
      const ly = fy + floorH / 2;
      // A dark drop-shadow behind a brighter glyph so the number reads on any
      // shaft tint (standard/service/express all darken to near-black, where a
      // faint fill washed out at the small font a tall tower uses).
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillText(label, lx + 1, ly + 1);
      ctx.fillStyle = "rgba(255,255,255,0.62)";
      ctx.fillText(label, lx, ly);
    }
    // Motor/machinery housings cap the shaft top and bottom, as in the original
    // (where the extend-taller arrows also live — that interaction is a planned
    // follow-up).
    const mh = 5;
    for (const my of [topY, topY + height - mh]) {
      ctx.fillStyle = "#6b6f78";
      ctx.fillRect(sx, my, w, mh);
      ctx.fillStyle = "rgba(255,255,255,0.25)";
      ctx.fillRect(sx, my, w, 1);
      ctx.fillStyle = "rgba(0,0,0,0.45)";
      ctx.fillRect(sx, my + mh - 1, w, 1);
      for (let bx = sx + 2; bx < sx + w - 1; bx += 4) ctx.fillRect(bx, my + 2, 1, 1); // bolts
    }
  }
}

/** A single elevator car graphic, drawn at (0,0) into a w×floorH rect, carrying
 *  `riders` passengers. `arrow` is the direction lantern (null when idle) and
 *  `full` flags a car at capacity. `kind` dresses the cab per elevator type
 *  (anything but service/express renders the standard cab). The car is its own
 *  Excalibur Actor that the engine moves along the shaft (and swaps as it
 *  loads / changes direction). */
export function drawCar(
  ctx: CanvasRenderingContext2D,
  seed: number,
  w: number,
  floorH: number,
  riders: number,
  arrow: CarArrow = null,
  full = false,
  kind: FacilityKind = "elevatorStandard",
): void {
  // Per-kind cab dressing, keyed to the catalog palette so the cab echoes its
  // shaft and toolbar identity. The standard cab keeps its original literals;
  // the kind cue is triple-encoded (brightness, bottom-edge pattern, hue) so
  // no single channel has to carry it. The top edge stays reserved for the
  // FULL bar and the direction lantern on every kind.
  const svc = kind === "elevatorService";
  const express = kind === "elevatorExpress";
  // Always a real color (unused on the standard path) so no branch can ever
  // feed shade() an empty string, which canvas would swallow silently.
  const accent = FACILITIES[kind].color;
  // Cab frame, then the lit interior inset within it. Service reads as a dark
  // flat staff freight cab; express as the bright liveried shuttle. Shade
  // amounts stay low enough that the catalog hue survives the 0..255 clamp.
  ctx.fillStyle = svc ? shade(accent, 30) : express ? shade(accent, 70) : "#8e94a0";
  ctx.fillRect(1, 1, w - 2, floorH - 2);
  ctx.fillStyle = svc ? shade(accent, 95) : express ? shade(accent, 160) : "#d8dce2";
  ctx.fillRect(2, 2, w - 4, floorH - 4);
  // Ceiling light strip (dim in the service cab, brightest in the express).
  ctx.fillStyle = svc ? shade(accent, 130) : express ? shade(accent, 190) : "#f3f6fa";
  ctx.fillRect(3, 2, w - 6, 2);
  if (svc) {
    // Hazard-striped kick plate across the cab bottom: the staff-only cue.
    ctx.fillStyle = shade(accent, -16);
    ctx.fillRect(2, floorH - 5, w - 4, 3);
    ctx.fillStyle = "#bfa04a";
    for (let r = 0; r < 3; r++) {
      // Bound each 2px stripe to the plate's right edge at x = w-2, which a
      // fractional w (the gallery's scaled cabs) would otherwise let it cross.
      for (let x = 2 + ((r + 2) % 4); x <= w - 4; x += 4) {
        ctx.fillRect(x, floorH - 5 + r, 2, 1);
      }
    }
  }
  if (express) {
    // Solid express-blue band with a light pinstripe: the shuttle livery.
    ctx.fillStyle = shade(accent, 20);
    ctx.fillRect(2, floorH - 5, w - 4, 3);
    ctx.fillStyle = shade(accent, 120);
    ctx.fillRect(2, floorH - 5, w - 4, 1);
  }
  // Riders stand on the cab floor.
  for (let p = 0; p < riders; p++) {
    person(ctx, 3 + p * 3.5, floorH - 3, 1.0, (p * 13 + seed) | 0);
  }
  // Door frames + the central seam, drawn over the riders so the cab reads as
  // an enclosed car.
  ctx.fillStyle = "rgba(40,44,54,0.22)";
  ctx.fillRect(2, 2, 1, floorH - 4);
  ctx.fillRect(w - 3, 2, 1, floorH - 4);
  ctx.fillStyle = "rgba(40,44,54,0.5)";
  ctx.fillRect(w / 2 - 0.5, 3, 1, floorH - 5);
  // FULL: a red bar across the top edge when the cab is at capacity.
  if (full) {
    ctx.fillStyle = "#ff4d4d";
    ctx.fillRect(2, 1, w - 4, 2);
  }
  // Direction lantern: a bright chevron near the top, only while the car moves.
  if (arrow) {
    const cxp = w / 2;
    const s = Math.max(1.5, Math.min(3, w * 0.12));
    const ty = full ? 4 : 2.5; // sit below the FULL bar when both show
    ctx.fillStyle = arrow === "up" ? "#7be88a" : "#ffab5e";
    ctx.beginPath();
    if (arrow === "up") {
      ctx.moveTo(cxp, ty);
      ctx.lineTo(cxp - s, ty + s);
      ctx.lineTo(cxp + s, ty + s);
    } else {
      ctx.moveTo(cxp, ty + s);
      ctx.lineTo(cxp - s, ty);
      ctx.lineTo(cxp + s, ty);
    }
    ctx.closePath();
    ctx.fill();
  }
}
