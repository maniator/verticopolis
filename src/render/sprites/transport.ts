import { FACILITIES, isElevatorKind } from "../../engine/facilities";
import type { FacilityKind, Transport } from "../../engine/types";
import { personRider } from "../pixelSprites/common";
import type { CarArrow } from "../carIndicator";
import { shade, shadeAlpha } from "./common";

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
    // top band is just the arrival landing, so a two-floor stairway draws
    // exactly one staircase rising one floor to a landing on the second-floor
    // deck, not two stacked ones.
    for (let fl = 1; fl <= t.top - t.bottom; fl++) {
      // Each flight is confined to band `fl` (the departure floor's band); the
      // top band stays the arrival landing so a two-floor stairway never draws
      // a second stacked flight. The engine's own routed climbers ride over it.
      drawStairFlight(ctx, sx, w, topY + fl * floorH, topY + (fl + 1) * floorH);
    }
    return;
  }

  if (t.kind === "escalator") {
    // Open structure like the stairs — no solid backing, you see the tower
    // behind it. One diagonal run per floor pair, confined to the departure
    // band, rising to the second-floor landing (the top band is the landing).
    for (let fl = 1; fl <= t.top - t.bottom; fl++) {
      drawEscalatorRun(ctx, sx, w, topY + fl * floorH, topY + (fl + 1) * floorH);
    }
    return;
  }

  if (isElevatorKind(t.kind)) {
    // Shaft backing tinted by elevator type, with rails and floor stops.
    // Standard/service draw an OPAQUE dark column. The express is a see-through
    // glass shaft in the retail game (harness pixel check: the express column
    // reads statistically like the office floor behind it),
    // so its backing is a low-alpha tint the rooms and people show through. The
    // rails, stop lines, floor numbers, motor caps and car are still drawn.
    const express = t.kind === "elevatorExpress";
    if (express) {
      ctx.fillStyle = shadeAlpha(f.color, -34, 0.35); // express glass backing
    } else {
      ctx.fillStyle = shade(f.color, -34);
    }
    ctx.fillRect(sx, topY, w, height);
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(sx + 1, topY, 1, height);
    ctx.fillRect(sx + w - 2, topY, 1, height);
    // Warm inner guide rails give the opaque shafts depth. Skipped on express
    // so nothing opaque narrows the see-through glass column.
    if (!express) {
      ctx.fillStyle = "#3A3630";
      ctx.fillRect(sx + 3, topY, 2, height);
      ctx.fillRect(sx + w - 5, topY, 2, height);
    }
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
    // Machine housings cap the shaft top and bottom (where the extend-taller
    // arrows also live in the original — that interaction is a planned
    // follow-up). The board's darker motor gray.
    const mh = 5;
    for (const my of [topY, topY + height - mh]) {
      ctx.fillStyle = "#3A3E44";
      ctx.fillRect(sx, my, w, mh);
      ctx.fillStyle = "#4E545C";
      ctx.fillRect(sx, my, w, 1);
      ctx.fillStyle = "rgba(0,0,0,0.45)";
      ctx.fillRect(sx, my + mh - 1, w, 1);
      for (let bx = sx + 2; bx < sx + w - 1; bx += 4) ctx.fillRect(bx, my + 2, 1, 1); // bolts
    }
  }
}

/** One warm-tan stair flight, ported from page-05's `stairs`: bright treads
 *  over dark risers on a shaded stringer, a walnut handrail with balusters, and
 *  top and bottom landings. Confined to the band `[bandTop, bandBottom)` (the
 *  departure floor's band) so the arrival band above stays the landing, never a
 *  second stacked flight. The flight is an open structure with no solid
 *  backing; the engine's routed climbers ride over it, so no rider is baked in.
 *  Integer coordinates. */
function drawStairFlight(ctx: CanvasRenderingContext2D, sx: number, w: number, bandTop: number, bandBottom: number): void {
  const x0 = sx + 8;
  const x1 = sx + w - 20;
  if (x1 <= x0) return; // too narrow to lay a readable flight (defensive)
  // Keep every part of the flight inside the band: the handrail rises ~9px over
  // the incline and the stringer drops ~10px under it, so the incline spans
  // [bandTop + 9, bandBottom - 11].
  const yTop = bandTop + 9; // arrival end of the incline (upper deck)
  const yBot = bandBottom - 11; // departure end of the incline (lower deck)
  if (yBot <= yTop) return; // band too short for a readable flight
  const n = 6;
  const step = (x1 - x0) / n;
  const rise = (yBot - yTop) / n;
  const line = (x: number) => yBot - ((x - x0) / (x1 - x0)) * (yBot - yTop);
  // Soft drop shadow the flight casts down and to the right.
  ctx.fillStyle = "rgba(0,0,0,0.30)";
  for (let x = x0; x < x1; x++) ctx.fillRect(x + 2, Math.round(line(x)) + 3, 1, 6);
  // Stepped stringer (the solid support under the treads).
  ctx.fillStyle = "#9A8666";
  for (let x = x0; x <= x1; x++) {
    const si = Math.min(n - 1, Math.floor((x - x0) / step));
    const ty = Math.round(yBot - si * rise);
    const under = Math.round(line(x) + 9);
    ctx.fillRect(x, ty - 2, 1, Math.max(1, under - (ty - 2)));
  }
  ctx.fillStyle = "#2A2018"; // shaded stringer underside
  for (let x = x0; x <= x1; x++) ctx.fillRect(x, Math.round(line(x) + 9), 1, 1);
  // Treads (warm tan) with a lit top edge, and a dark riser at each step front.
  for (let i = 0; i < n; i++) {
    const stepX = Math.round(x0 + i * step);
    const ty = Math.round(yBot - i * rise);
    const sw = Math.ceil(step) + 1;
    ctx.fillStyle = "#EDE6D2";
    ctx.fillRect(stepX, ty - 3, sw, 3);
    ctx.fillStyle = "#F8F2E0";
    ctx.fillRect(stepX, ty - 3, sw, 1);
    const nx = Math.round(x0 + (i + 1) * step);
    ctx.fillStyle = "#241E14";
    ctx.fillRect(nx, Math.round(yBot - (i + 1) * rise) - 3, 1, Math.max(1, Math.round(rise) + 3));
  }
  // Walnut handrail riding above the flight, on balusters.
  ctx.fillStyle = "#6B4A2B";
  for (let x = x0; x < x1; x++) ctx.fillRect(x, Math.round(line(x)) - 9, 1, 2);
  ctx.fillStyle = "#5A3E28";
  for (let i = 1; i < n; i += 2) {
    const bx = Math.round(x0 + i * step);
    ctx.fillRect(bx, Math.round(yBot - i * rise) - 9, 1, 8);
  }
  // Arrival landing on the upper deck, then a short departure landing below.
  ctx.fillStyle = "#9A8666";
  ctx.fillRect(x1 - 2, yTop - 3, 22, 3);
  ctx.fillStyle = "#B49E7A";
  ctx.fillRect(x1 - 2, yTop - 3, 22, 1);
  ctx.fillStyle = "#2A2018";
  ctx.fillRect(x1 - 2, yTop, 22, 1);
  ctx.fillStyle = "#9A8666";
  ctx.fillRect(sx + 2, yBot - 2, 12, 4);
  ctx.fillStyle = "#B49E7A";
  ctx.fillRect(sx + 2, yBot - 2, 12, 1);
}

/** One escalator run, ported from page-05's `escalator`: metallic warm-gray
 *  steps, amber edge dots, a glass balustrade and handrail, and top and bottom
 *  landings. Confined to the band `[bandTop, bandBottom)` like the stair flight,
 *  so the arrival band stays the landing. Open structure, no solid backing; the
 *  engine's routed riders ride over it. Integer coordinates. */
function drawEscalatorRun(ctx: CanvasRenderingContext2D, sx: number, w: number, bandTop: number, bandBottom: number): void {
  const x0 = sx + 8;
  const x1 = sx + w - 20;
  if (x1 <= x0) return;
  const yTop = bandTop + 11; // handrail + balustrade clear the band top
  const yBot = bandBottom - 11; // steps clear the band bottom
  if (yBot <= yTop) return;
  const line = (x: number) => yBot - ((x - x0) / (x1 - x0)) * (yBot - yTop);
  ctx.fillStyle = "rgba(0,0,0,0.30)"; // drop shadow
  for (let x = x0; x < x1; x++) ctx.fillRect(x + 2, Math.round(line(x)) + 4, 1, 5);
  // Metallic step bars along the incline.
  for (let x = x0; x <= x1; x++) {
    const tt = Math.round(line(x));
    ctx.fillStyle = "#141118";
    ctx.fillRect(x, tt - 1, 1, 1);
    ctx.fillStyle = "#6E747C";
    ctx.fillRect(x, tt, 1, 8);
    ctx.fillStyle = "#9AA0A8";
    ctx.fillRect(x, tt, 1, 1);
    ctx.fillStyle = "#3A3E46";
    ctx.fillRect(x, tt + 7, 1, 2);
  }
  // Amber step-edge accents.
  for (let x = x0; x < x1; x += 4) {
    const tt = Math.round(line(x));
    ctx.fillStyle = "#3A3E46";
    ctx.fillRect(x, tt + 1, 1, 6);
    ctx.fillStyle = "#F0C24A";
    ctx.fillRect(x - 1, tt + 1, 1, 6);
  }
  // Glass balustrade + dark handrail above the steps.
  ctx.fillStyle = "rgba(191,208,224,0.20)";
  for (let x = x0; x < x1; x++) ctx.fillRect(x, Math.round(line(x)) - 9, 1, 8);
  for (let x = x0; x < x1; x++) {
    const tt = Math.round(line(x));
    ctx.fillStyle = "#1A1D24";
    ctx.fillRect(x, tt - 10, 1, 2);
    ctx.fillStyle = "#3A3E46";
    ctx.fillRect(x, tt - 10, 1, 1);
  }
  // Landings top and bottom.
  ctx.fillStyle = "#6A6E76";
  ctx.fillRect(x1 - 2, yTop - 2, 22, 5);
  ctx.fillStyle = "#8A8E96";
  ctx.fillRect(x1 - 2, yTop - 2, 22, 1);
  ctx.fillStyle = "#3A3E46";
  ctx.fillRect(x1 - 2, yTop + 3, 22, 1);
  ctx.fillStyle = "#6A6E76";
  ctx.fillRect(sx + 2, yBot - 2, 14, 5);
  ctx.fillStyle = "#8A8E96";
  ctx.fillRect(sx + 2, yBot - 2, 14, 1);
}

/** A single elevator car graphic, drawn at (0,0) into a w×floorH rect, carrying
 *  `riders` passengers. `arrow` is the direction lantern (null when idle) and
 *  `full` flags a car at capacity. `kind` dresses the cab per elevator type
 *  (anything but service/express renders the standard cab). The car is its own
 *  Excalibur Actor that the engine moves along the shaft (and swaps as it
 *  loads / changes direction). The board's warm brass-and-walnut cab. */
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
  // shaft and toolbar identity. All three cabs share the warm brass-and-walnut
  // read; the kind cue is carried by the interior tint and a distinct
  // bottom-edge band (service hazard plate, express livery), so no single
  // channel has to carry it. The top edge stays reserved for the FULL bar and
  // the direction lantern on every kind.
  const svc = kind === "elevatorService";
  const express = kind === "elevatorExpress";
  // Always a real color (unused on the standard path) so no branch can ever
  // feed shade() an empty string, which canvas would swallow silently.
  const accent = FACILITIES[kind].color;
  const cw = Math.max(1, Math.round(w));
  const midX = Math.round(cw / 2);
  // Cab frame, then the warm walnut interior with a brass ceiling rail. Service
  // reads as a grayer staff freight cab; express keeps the walnut interior but
  // wears its blue livery band below.
  ctx.fillStyle = svc ? "#54584C" : express ? "#3A4048" : "#4A4238";
  ctx.fillRect(1, 1, cw - 2, floorH - 2);
  ctx.fillStyle = express ? "#5A6472" : "#6A6E62"; // frame top rail
  ctx.fillRect(1, 1, cw - 2, 1);
  ctx.fillStyle = svc ? "#7C8072" : "#6B4A2B"; // walnut interior (gray-green for service)
  ctx.fillRect(3, 3, cw - 6, floorH - 6);
  ctx.fillStyle = "#C9A24B"; // brass ceiling rail
  ctx.fillRect(3, 3, cw - 6, 1);
  // Warm ceiling glow dot.
  ctx.fillStyle = "rgba(248,226,180,0.5)";
  ctx.fillRect(midX - 2, 3, 4, 2);
  ctx.fillStyle = "#F8E2B4";
  ctx.fillRect(midX - 1, 3, 2, 1);
  if (svc) {
    // Hazard-striped kick plate across the cab bottom: the staff-only cue.
    ctx.fillStyle = shade(accent, -16);
    ctx.fillRect(2, floorH - 5, cw - 4, 3);
    ctx.fillStyle = "#bfa04a";
    for (let r = 0; r < 3; r++) {
      // Bound each 2px stripe to the plate's right edge at x = w-2, which a
      // fractional w (the gallery's scaled cabs) would otherwise let it cross.
      for (let x = 2 + ((r + 2) % 4); x <= cw - 4; x += 4) {
        ctx.fillRect(x, floorH - 5 + r, 2, 1);
      }
    }
  } else if (express) {
    // Solid express-blue band with a light pinstripe: the shuttle livery.
    ctx.fillStyle = shade(accent, 20);
    ctx.fillRect(2, floorH - 5, cw - 4, 3);
    ctx.fillStyle = shade(accent, 120);
    ctx.fillRect(2, floorH - 5, cw - 4, 1);
  }
  // Riders stand on the cab floor as the 17px rider silhouette, packed tighter
  // as the car fills so a crowded cab reads at a glance. `riders` is the car's
  // load from the caller; the passenger FILL reconciliation is the people-system
  // spec's overlay behind the E6 seam, not redefined here.
  const rc = Math.max(0, Math.floor(riders));
  if (rc > 0) {
    const gap = Math.max(3, Math.min(7, (cw - 8) / rc));
    for (let p = 0; p < rc; p++) {
      const rx = 3 + p * gap;
      if (rx > cw - 5) break; // never overflow the cab
      personRider(ctx, rx, floorH - 3, (p * 13 + seed) | 0);
    }
  }
  // Door frames + the central seam, drawn over the riders so the cab reads as
  // an enclosed car.
  ctx.fillStyle = "rgba(40,44,54,0.24)";
  ctx.fillRect(2, 2, 1, floorH - 4);
  ctx.fillRect(cw - 3, 2, 1, floorH - 4);
  ctx.fillStyle = "rgba(40,44,54,0.5)";
  ctx.fillRect(cw / 2 - 0.5, 3, 1, floorH - 5);
  // FULL: a red bar across the top edge when the cab is at capacity.
  if (full) {
    ctx.fillStyle = "#ff4d4d";
    ctx.fillRect(2, 1, cw - 4, 2);
  }
  // Direction lantern: a bright chevron near the top, only while the car moves.
  if (arrow) {
    const cxp = cw / 2;
    const s = Math.max(1.5, Math.min(3, cw * 0.12));
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
