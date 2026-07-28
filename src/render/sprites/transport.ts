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

/** One warm-tan stair flight: even treads over dark risers on a solid diagonal
 *  stringer, a walnut handrail on balusters ending in a newel post at each end,
 *  and a top arrival stair the flight lands on, all sitting on the floor line
 *  (the departure deck below is drawn by the floor behind the flight), confined
 *  to the band `[bandTop, bandBottom)`
 *  (the departure floor's band) so the arrival band above stays the landing,
 *  never a second stacked flight. The flight is drawn strictly inside
 *  `[sx, sx + w]` so it never overpaints a neighbor. Structure only, NO baked
 *  climber: the engine's routed sims ride over it as separate actors, so an empty
 *  tower shows a bare, unoccupied flight. Integer coordinates. */
function drawStairFlight(ctx: CanvasRenderingContext2D, sx: number, w: number, bandTop: number, bandBottom: number): void {
  const railH = 9; // handrail height above a tread
  const depth = 7; // stringer thickness under the treads
  const x0 = sx + 10; // bottom (lower) landing sits on the left
  const x1 = sx + w - 12; // top (upper) landing sits on the right
  if (x1 - x0 < 8) return; // too narrow to lay a readable flight (defensive)
  // Keep the whole flight inside the band: the stringer drops `depth` below the
  // incline, so the incline bottom clears the band bottom by that much (a flight
  // that leaked past bandBottom would paint onto the floor below).
  const yBot = bandBottom - depth - 2; // lower deck (departure), near the floor line
  // The top tread and top landing reach the arrival deck (bandTop) so the flight
  // visually connects to the second floor. The upper band is itself a landing, so
  // meeting bandTop is correct; the handrail is clamped below so nothing rises
  // past the deck into a "second flight" read.
  const yTop = bandTop + 2;
  if (yBot - yTop < 6) return; // band too short for a readable flight
  const n = 6; // steps
  const treadW = (x1 - x0) / n;
  const riseH = (yBot - yTop) / n;
  // The smooth incline line (used for the stringer underside and the handrail)
  // and the stepped top surface (flat within each tread, jumping at the front).
  const line = (x: number) => yBot - ((x - x0) / (x1 - x0)) * (yBot - yTop);
  const stepTopY = (x: number) => Math.round(yBot - Math.min(n - 1, Math.floor((x - x0) / treadW)) * riseH) - 2;
  // Soft drop shadow just under the stringer. Height 1 so the deepest column (at
  // x0, where line === yBot) ends on bandBottom - 1 and never paints the
  // bandBottom row, which belongs to the floor below.
  ctx.fillStyle = "rgba(0,0,0,0.28)";
  for (let x = x0; x < x1; x++) ctx.fillRect(x + 1, Math.round(line(x)) + depth + 1, 1, 1);
  // Solid body: from the stepped top surface down to a straight diagonal stringer
  // underside, so the treads read as steps on one continuous stringer.
  for (let x = x0; x <= x1; x++) {
    const top = stepTopY(x);
    const bot = Math.round(line(x)) + depth;
    ctx.fillStyle = "#8A7454"; // riser/stringer body
    ctx.fillRect(x, top, 1, Math.max(1, bot - top));
    ctx.fillStyle = "#2A2018"; // shaded stringer underside edge
    ctx.fillRect(x, bot, 1, 2);
  }
  // Tread caps (warm tan, lit nosing) and a dark riser face at each step front.
  for (let i = 0; i < n; i++) {
    const l = Math.round(x0 + i * treadW);
    const r = Math.round(x0 + (i + 1) * treadW);
    const ty = Math.round(yBot - i * riseH) - 2;
    ctx.fillStyle = "#EDE6D2";
    ctx.fillRect(l, ty, r - l + 1, 2);
    ctx.fillStyle = "#F8F2E0";
    ctx.fillRect(l, ty, r - l + 1, 1);
    const nty = Math.round(yBot - (i + 1) * riseH) - 2; // next tread top (higher)
    ctx.fillStyle = "#241E14";
    ctx.fillRect(r, nty, 1, Math.max(1, ty - nty));
  }
  // Walnut handrail on balusters, riding parallel above the flight. It follows
  // the incline to x1 (the front of the top stair), then runs flat across that
  // stair to a newel at its right end, so the rail terminates in a post rather
  // than in mid-air. Rising past bandTop is intended: as in the original, a
  // flight breaks the floor line it arrives at.
  const railEnd = sx + w - 3; // last column of the top stair
  const railY = (x: number) => Math.round(line(Math.min(x, x1))) - railH;
  ctx.fillStyle = "#5A3E28";
  for (let i = 1; i <= n; i++) {
    // i = n lands on x1, the joint between the top stair and the one below it.
    const bx = Math.round(x0 + i * treadW);
    const ry = railY(bx);
    ctx.fillRect(bx, ry, 1, Math.max(1, Math.round(line(bx)) - ry));
  }
  for (let x = x0; x <= railEnd; x++) {
    const ry = railY(x);
    ctx.fillStyle = "#6B4A2B";
    ctx.fillRect(x, ry, 1, 2);
    ctx.fillStyle = "#8A6440";
    ctx.fillRect(x, ry, 1, 1);
  }
  // The top stair: the tread the flight arrives on, sitting on bandTop so it
  // lands flush with the second floor. Drawn in the same colors as every other
  // step (cap, lit nosing, stringer body, shaded underside) so it reads as the
  // last stair rather than a differently shaded landing. The departure end gets
  // nothing: a stub poking out to the left of the bottom step reads as a broken
  // tread, and the deck it would sit on is already drawn by the floor behind it.
  const rlx = x1;
  const rlw = sx + w - 2 - x1;
  ctx.fillStyle = "#8A7454"; // stringer body
  ctx.fillRect(rlx, bandTop, rlw, 4);
  ctx.fillStyle = "#EDE6D2"; // tread cap
  ctx.fillRect(rlx, bandTop, rlw, 2);
  ctx.fillStyle = "#F8F2E0"; // lit nosing
  ctx.fillRect(rlx, bandTop, rlw, 1);
  ctx.fillStyle = "#2A2018"; // shaded stringer underside edge
  ctx.fillRect(rlx, bandTop + 4, rlw, 1);
  // Newel posts at both ends, drawn after the stair so they stand proud of it.
  // The baluster loop now covers i = 1..n, so the only bare ends left are the
  // foot of the rail and the far end of the top stair. Each newel runs from the
  // handrail's height at that end down into the deck it is planted in.
  const newel = (px: number, top: number, bottom: number): void => {
    ctx.fillStyle = "#5A3E28";
    ctx.fillRect(px - 1, top, 2, Math.max(1, bottom - top));
    ctx.fillStyle = "#8A6440"; // lit cap, matches the handrail highlight
    ctx.fillRect(px - 1, top, 2, 1);
  };
  newel(railEnd, railY(railEnd), bandTop + 4);
  newel(x0, railY(x0), Math.round(line(x0)) + depth);
}

/** One escalator run: a clean inclined belt of metallic warm-gray steps with
 *  legible amber step edges, a glass side balustrade with a dark moving handrail,
 *  and comb-plate landings top and bottom. Confined to the band
 *  `[bandTop, bandBottom)` like the stair flight and drawn strictly inside
 *  `[sx, sx + w]`. Structure only, NO baked rider: the engine's routed sims ride
 *  over it, so an empty tower shows a bare, unoccupied run. Integer coordinates. */
function drawEscalatorRun(ctx: CanvasRenderingContext2D, sx: number, w: number, bandTop: number, bandBottom: number): void {
  const railH = 10; // handrail height above the belt top
  const beltThk = 8; // belt thickness
  const x0 = sx + 10; // bottom landing on the left
  const x1 = sx + w - 12; // top landing on the right
  if (x1 - x0 < 8) return;
  // Keep the belt inside the band: the belt is `beltThk` thick below the incline
  // line, so its top clears the band bottom by that much (a run that leaked past
  // bandBottom would paint onto the floor below).
  const yBot = bandBottom - beltThk - 2; // belt top at the lower deck
  // The belt top and top landing reach the arrival deck (bandTop) so the run
  // connects to the second floor; the handrail is clamped below the deck.
  const yTop = bandTop + 2; // belt top at the upper deck
  if (yBot - yTop < 6) return;
  const line = (x: number) => yBot - ((x - x0) / (x1 - x0)) * (yBot - yTop);
  // Soft drop shadow under the belt. Height 1 so the deepest column (at x0, where
  // line === yBot) ends on bandBottom - 1 and never paints the bandBottom row,
  // which belongs to the floor below.
  ctx.fillStyle = "rgba(0,0,0,0.28)";
  for (let x = x0; x < x1; x++) ctx.fillRect(x + 1, Math.round(line(x)) + beltThk + 1, 1, 1);
  // The metal belt: a mid-gray band with a light top edge and a dark underside.
  for (let x = x0; x <= x1; x++) {
    const t = Math.round(line(x));
    ctx.fillStyle = "#6E747C";
    ctx.fillRect(x, t, 1, beltThk);
    ctx.fillStyle = "#9AA0A8"; // lit top edge of the belt
    ctx.fillRect(x, t, 1, 1);
    ctx.fillStyle = "#3A3E46"; // dark underside
    ctx.fillRect(x, t + beltThk - 1, 1, 1);
  }
  // Step edges: a dark groove with a bright amber nose, evenly spaced, so the
  // moving steps read at a glance.
  for (let x = x0 + 2; x < x1; x += 4) {
    const t = Math.round(line(x));
    ctx.fillStyle = "#3A3E46";
    ctx.fillRect(x, t + 1, 1, beltThk - 2);
    ctx.fillStyle = "#F0C24A";
    ctx.fillRect(x - 1, t + 1, 1, beltThk - 2);
  }
  // Glass side balustrade with a dark moving handrail on top. The rail is clamped
  // so it never rises above the arrival deck (bandTop): near the top it levels
  // onto the landing and ends in a short newel, so the run reads as reaching the
  // second floor.
  const railTop = (x: number) => Math.max(bandTop, Math.round(line(x)) - railH);
  ctx.fillStyle = "rgba(191,208,224,0.18)";
  for (let x = x0; x <= x1; x++) {
    const rt = railTop(x);
    ctx.fillRect(x, rt, 1, Math.max(1, Math.round(line(x)) - rt));
  }
  for (let x = x0; x <= x1; x++) {
    const rt = railTop(x);
    ctx.fillStyle = "#1A1D24";
    ctx.fillRect(x, rt, 1, 2);
    ctx.fillStyle = "#4A4E56"; // handrail highlight
    ctx.fillRect(x, rt, 1, 1);
  }
  // Comb-plate landings top and bottom, inside [sx, sx + w]. The top comb plate
  // sits on bandTop (the arrival deck), so the run lands flush on the second floor.
  ctx.fillStyle = "#6A6E76";
  ctx.fillRect(sx + 2, yBot - 2, x0 - sx - 2, 5);
  ctx.fillStyle = "#8A8E96";
  ctx.fillRect(sx + 2, yBot - 2, x0 - sx - 2, 1);
  const rlx = x1;
  const rlw = sx + w - 2 - x1;
  ctx.fillStyle = "#6A6E76";
  ctx.fillRect(rlx, bandTop, rlw, 5);
  ctx.fillStyle = "#8A8E96";
  ctx.fillRect(rlx, bandTop, rlw, 1);
  ctx.fillStyle = "#3A3E46";
  ctx.fillRect(rlx, bandTop + 5, rlw, 1);
  // Newel where the handrail meets the top landing, drawn AFTER the landing so it
  // stands proud of it rather than being overpainted.
  ctx.fillStyle = "#1A1D24";
  ctx.fillRect(x1 - 1, bandTop, 2, Math.min(8, yBot - bandTop));
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
