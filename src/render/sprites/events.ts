/**
 * One-off EVENT visuals drawn in immediate mode on the sky/overlay canvases —
 * deliberately NOT Excalibur actors, so there is no actor to leak or tear down
 * (the class of bug PR #105 had to fix). Both are pure `(ctx, …)` draws the
 * TowerEngine calls each frame while an event is playing; when the play-out
 * window closes the engine simply stops calling them.
 *
 *  - {@link drawSanta}: the holiday cameo — Santa's sleigh and reindeer crossing
 *    the sky (canon: "Santa Claus and his reindeer fly across the tower").
 *  - {@link drawExplosion}: the bomb-detonation flash at the blast epicenter,
 *    a fading starburst over the rooms it guts.
 */

/** One reindeer facing right: body, head, antlers, legs, a red nose. */
function drawReindeer(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  ctx.fillStyle = "#7a5230";
  ctx.fillRect(x - 7 * s, y - 4 * s, 12 * s, 5 * s); // body
  ctx.fillRect(x + 4 * s, y - 8 * s, 4 * s, 5 * s); // head/neck
  // legs
  ctx.fillRect(x - 5 * s, y + 1 * s, 1.5 * s, 5 * s);
  ctx.fillRect(x + 2 * s, y + 1 * s, 1.5 * s, 5 * s);
  // antlers
  ctx.strokeStyle = "#5a3c22";
  ctx.lineWidth = 1 * s;
  ctx.beginPath();
  ctx.moveTo(x + 6 * s, y - 8 * s);
  ctx.lineTo(x + 4 * s, y - 12 * s);
  ctx.moveTo(x + 7 * s, y - 8 * s);
  ctx.lineTo(x + 10 * s, y - 12 * s);
  ctx.stroke();
  // Rudolph's nose
  ctx.fillStyle = "#ff5252";
  ctx.beginPath();
  ctx.arc(x + 8 * s, y - 5 * s, 1.4 * s, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * Santa's sleigh + team, centered at (x, y), facing right. `scale` sizes the
 * whole rig. Drawn in screen space on the sky layer.
 */
export function drawSanta(ctx: CanvasRenderingContext2D, x: number, y: number, scale = 1): void {
  const s = scale;
  ctx.save();
  // Rein line from the sleigh to the lead reindeer.
  ctx.strokeStyle = "rgba(120,90,60,0.85)";
  ctx.lineWidth = 1.4 * s;
  ctx.beginPath();
  ctx.moveTo(x - 20 * s, y - 2 * s);
  ctx.lineTo(x + 46 * s, y - 3 * s);
  ctx.stroke();

  // Two reindeer leading (to the right).
  drawReindeer(ctx, x + 22 * s, y, s);
  drawReindeer(ctx, x + 40 * s, y, s);

  // Sleigh body with a curled front runner.
  ctx.fillStyle = "#c0331f";
  ctx.fillRect(x - 24 * s, y - 6 * s, 22 * s, 8 * s);
  ctx.beginPath();
  ctx.moveTo(x - 2 * s, y + 2 * s);
  ctx.quadraticCurveTo(x + 6 * s, y + 2 * s, x + 4 * s, y - 5 * s); // curled prow
  ctx.lineTo(x - 2 * s, y - 5 * s);
  ctx.closePath();
  ctx.fill();
  // Gold trim + runner.
  ctx.strokeStyle = "#f0c14b";
  ctx.lineWidth = 1.2 * s;
  ctx.beginPath();
  ctx.moveTo(x - 26 * s, y + 3 * s);
  ctx.lineTo(x + 4 * s, y + 3 * s);
  ctx.stroke();

  // Santa: red body, white beard, red hat with a white bobble.
  ctx.fillStyle = "#d94322";
  ctx.fillRect(x - 20 * s, y - 13 * s, 9 * s, 8 * s); // torso
  ctx.fillStyle = "#fde7d2";
  ctx.beginPath(); // face
  ctx.arc(x - 15 * s, y - 15 * s, 3.2 * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#f6f6f6";
  ctx.fillRect(x - 18 * s, y - 13 * s, 6 * s, 2 * s); // beard
  ctx.fillStyle = "#d94322";
  ctx.beginPath(); // hat
  ctx.moveTo(x - 18 * s, y - 17 * s);
  ctx.lineTo(x - 12 * s, y - 17 * s);
  ctx.lineTo(x - 13 * s, y - 21 * s);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(x - 13 * s, y - 21 * s, 1.3 * s, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

/**
 * A bomb-blast starburst centered at (x, y), expanding to `radius`. `phase`
 * runs 0→1 over the flash's lifetime; the whole thing fades as it grows.
 */
export function drawExplosion(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, phase: number): void {
  const alpha = Math.max(0, 1 - phase);
  if (alpha <= 0 || radius <= 0) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  // Soft outer glow.
  ctx.fillStyle = "rgba(255,140,0,0.5)";
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
  // Jagged starburst.
  ctx.fillStyle = "#ffcf3a";
  const spikes = 10;
  ctx.beginPath();
  for (let i = 0; i < spikes * 2; i++) {
    const ang = (Math.PI * i) / spikes;
    const rr = i % 2 === 0 ? radius : radius * 0.5;
    const px = x + Math.cos(ang) * rr;
    const py = y + Math.sin(ang) * rr;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
  // Hot core.
  ctx.fillStyle = "#fff6d5";
  ctx.beginPath();
  ctx.arc(x, y, radius * 0.34, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
