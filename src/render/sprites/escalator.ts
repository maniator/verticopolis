/**
 * Escalators: the one-story run, the switchback up a tall lobby (#308), and
 * the half-turn a one-story escalator beside a venue takes in Modern
 * (`../venueFlights.ts`). Static structure only: the routed riders ride over
 * it. Split out of `transport.ts`.
 */

/** An escalator up a tall lobby (#308): one run a story, each turning back
 *  the way the last came, from a steel platform at the turn held up by a
 *  post to the hall floor. The bottom run climbs left to right like a
 *  one-story escalator. Drawn strictly inside `[sx, sx + w]`. */
export function drawEscalatorSwitchback(ctx: CanvasRenderingContext2D, sx: number, w: number, topY: number, floorH: number, stories: number): void {
  const hallFloor = topY + (stories + 1) * floorH;
  for (let k = 0; k < stories; k++) {
    const bandTop = topY + (stories - k) * floorH;
    if (k % 2 === 0) {
      drawEscalatorRun(ctx, sx, w, bandTop, bandTop + floorH);
    } else {
      // Mirrored about the shaft's middle, so this run climbs right to left.
      ctx.save();
      ctx.translate(2 * sx + w, 0);
      ctx.scale(-1, 1);
      drawEscalatorRun(ctx, sx, w, bandTop, bandTop + floorH);
      ctx.restore();
    }
  }
  // A platform at each turn, on the side the run below arrives at.
  for (let k = 1; k < stories; k++) {
    drawTurnPlatform(ctx, sx, w, topY + (stories - k + 1) * floorH, k % 2 === 1, hallFloor);
  }
}

/** A one-story escalator beside a venue: two runs of half a story each, the
 *  upper one turning back from a steel landing at the turn, so it climbs
 *  left to right and then right to left. Lands at the left of the arrival deck
 *  at `bandTop`. The landing sits a pixel above the halfway line so both runs
 *  keep whole-pixel bands. Drawn strictly inside `[sx, sx + w]`. */
export function drawEscalatorHalfTurn(ctx: CanvasRenderingContext2D, sx: number, w: number, bandTop: number, bandBottom: number): void {
  const turn = halfTurnY(bandTop, bandBottom);
  drawEscalatorRun(ctx, sx, w, turn, bandBottom);
  ctx.save();
  ctx.translate(2 * sx + w, 0);
  ctx.scale(-1, 1);
  drawEscalatorRun(ctx, sx, w, bandTop, turn);
  ctx.restore();
  drawTurnPlatform(ctx, sx, w, turn, true, bandBottom);
}

/** Where a one-story half-turn escalator turns back: the band's middle,
 *  rounded up a pixel on an odd band. */
export function halfTurnY(bandTop: number, bandBottom: number): number {
  return Math.floor((bandTop + bandBottom) / 2);
}

/** The steel platform a switchback turns on, at the right or left of the
 *  shaft, whose run below arrives at `y`, held up by a post to `floorY`. */
function drawTurnPlatform(ctx: CanvasRenderingContext2D, sx: number, w: number, y: number, right: boolean, floorY: number): void {
  const pw = 14;
  const px = right ? sx + w - 2 - pw : sx + 2;
  const deck = y - 12;
  ctx.fillStyle = "#3A3E46"; // the post down to the hall floor
  ctx.fillRect(px + Math.floor(pw / 2) - 1, deck + 6, 3, floorY - deck - 6);
  ctx.fillStyle = "#6A6E76"; // steel deck
  ctx.fillRect(px, deck, pw, 6);
  ctx.fillStyle = "#8A8E96"; // lit edge
  ctx.fillRect(px, deck, pw, 1);
  ctx.fillStyle = "#2A2D33"; // shaded underside
  ctx.fillRect(px, deck + 5, pw, 1);
  ctx.fillStyle = "#1A1D24"; // guard rail along the deck
  ctx.fillRect(px, deck - 9, pw, 2);
  ctx.fillRect(right ? px + pw - 2 : px, deck - 9, 2, 9);
}

/** One escalator run: a clean inclined belt of metallic warm-gray steps with
 *  legible amber step edges, a glass side balustrade with a dark moving handrail,
 *  and comb-plate landings top and bottom. Confined to the band
 *  `[bandTop, bandBottom)` like the stair flight and drawn strictly inside
 *  `[sx, sx + w]`. Structure only, NO baked rider: the engine's routed sims ride
 *  over it, so an empty tower shows a bare, unoccupied run. Integer coordinates. */
export function drawEscalatorRun(ctx: CanvasRenderingContext2D, sx: number, w: number, bandTop: number, bandBottom: number): void {
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

