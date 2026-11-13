/**
 * The spiral staircase that climbs a tall lobby (#308). A stair flight out of
 * a two- or three-story lobby climbs the whole hall; a straight flight that
 * tall reads as a ladder, so it winds around a newel pole instead, one turn a
 * story. Static structure only: the routed climbers ride over it.
 */

/** The radius of the helix a spiral `w` pixels wide winds on. */
export function spiralRadius(w: number): number {
  return Math.max(6, Math.min(Math.floor(w / 2) - 4, 22));
}

/** The helix's angle at `t`, 0 at the foot and 1 at the landing, for a
 *  spiral `stories` high: it starts at the front left, turns once a story,
 *  and a last half turn brings it to the landing on the right. */
export function spiralAngle(t: number, stories: number): number {
  return -Math.PI / 2 + (2 * stories + 1) * Math.PI * t;
}

/** A spiral staircase up a tall lobby (#308): treads wound around a walnut
 *  newel pole, one turn a story, with a brass-capped pole, balusters and a
 *  handrail that follows the helix. The far half of each turn is drawn first
 *  and darker, then the pole, then the near half, so the stair reads as
 *  winding around it. Lands on the arrival deck at `bandTop` on the right.
 *  Drawn strictly inside `[sx, sx + w]`. Integer coordinates. */
export function drawSpiralStair(ctx: CanvasRenderingContext2D, sx: number, w: number, bandTop: number, bandBottom: number, stories: number): void {
  const cx = Math.round(sx + w / 2);
  const r = spiralRadius(w);
  const treadsPerTurn = 10;
  const n = treadsPerTurn * stories;
  const yBot = bandBottom - 4;
  const yTop = bandTop + 2;
  const rise = (yBot - yTop) / n;
  const railH = 9;
  const angle = (i: number) => spiralAngle(i / n, stories);
  const tread = (i: number) => {
    const a = angle(i);
    return { x: Math.round(cx + r * Math.sin(a)), y: Math.round(yBot - i * rise), front: Math.cos(a) >= 0 };
  };
  const drawTread = (i: number, far: boolean) => {
    const t = tread(i);
    const l = Math.min(cx, t.x);
    const wd = Math.max(2, Math.abs(t.x - cx));
    ctx.fillStyle = far ? "#6E5C42" : "#8A7454"; // tread body
    ctx.fillRect(l, t.y - 1, wd, 2);
    ctx.fillStyle = far ? "#BDB49E" : "#EDE6D2"; // tread cap
    ctx.fillRect(l, t.y - 2, wd, 1);
    if (!far) {
      ctx.fillStyle = "#F8F2E0"; // lit nosing on the near treads
      ctx.fillRect(l, t.y - 2, wd, 1);
      ctx.fillStyle = "#2A2018";
      ctx.fillRect(l, t.y + 1, wd, 1);
    }
    // A baluster from the tread's outer end up to the rail.
    ctx.fillStyle = far ? "#3E2C1C" : "#5A3E28";
    ctx.fillRect(t.x, t.y - 2 - railH, 1, railH);
  };
  // The handrail traced along the helix, each sample joined to the last so
  // the rail stays one unbroken line where it turns steeply at the sides.
  const drawRail = (far: boolean) => {
    let prev: { x: number; y: number } | null = null;
    for (let k = 0; k <= n * 6; k++) {
      const i = k / 6;
      const a = angle(i);
      const x = Math.round(cx + r * Math.sin(a));
      const y = Math.round(yBot - i * rise) - 2 - railH;
      if ((Math.cos(a) >= 0) === far) {
        prev = null;
        continue;
      }
      const top = prev ? Math.min(prev.y, y) : y;
      const h = prev && prev.x === x ? Math.abs(prev.y - y) + 2 : 2;
      ctx.fillStyle = far ? "#4A3420" : "#6B4A2B";
      ctx.fillRect(x, top, 1, h);
      if (!far) {
        ctx.fillStyle = "#8A6440";
        ctx.fillRect(x, y, 1, 1);
      }
      prev = { x, y };
    }
  };
  // The far side first, darker, behind the pole.
  for (let i = 0; i < n; i++) if (!tread(i).front) drawTread(i, true);
  drawRail(true);
  // The newel pole, the full height of the hall, with a brass cap.
  ctx.fillStyle = "#4A3420";
  ctx.fillRect(cx - 1, yTop - railH, 3, yBot - yTop + railH + 2);
  ctx.fillStyle = "#6B4A2B";
  ctx.fillRect(cx - 1, yTop - railH, 1, yBot - yTop + railH + 2);
  ctx.fillStyle = "#C9A24B";
  ctx.fillRect(cx - 2, yTop - railH - 2, 5, 2);
  // The near side over the pole.
  for (let i = 0; i < n; i++) if (tread(i).front) drawTread(i, false);
  drawRail(false);
  // The arrival landing on the deck above, from the last tread to the right.
  const last = tread(n - 1);
  const lx = Math.min(last.x, cx);
  const lw = sx + w - 2 - lx;
  ctx.fillStyle = "#8A7454";
  ctx.fillRect(lx, bandTop, lw, 4);
  ctx.fillStyle = "#EDE6D2";
  ctx.fillRect(lx, bandTop, lw, 2);
  ctx.fillStyle = "#F8F2E0";
  ctx.fillRect(lx, bandTop, lw, 1);
  ctx.fillStyle = "#2A2018";
  ctx.fillRect(lx, bandTop + 4, lw, 1);
}
