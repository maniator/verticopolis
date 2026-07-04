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
 *  - {@link drawThief}: a masked thief slinking across a floor with a loot sack;
 *    a security guard trails him when he's caught.
 *  - {@link drawTreasure}: a gold sparkle + coins rising from an unearthed find.
 *  - {@link drawVipLimo}: the VIP's limousine, arriving at the lobby for a review.
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

/**
 * A masked thief slinking rightward with a money sack, feet at (x, y). When
 * `caught`, a security guard trails close behind with an alert light. Drawn in
 * screen space on the overlay (in front of the tower).
 */
export function drawThief(ctx: CanvasRenderingContext2D, x: number, y: number, scale = 1, caught = false): void {
  const s = scale;
  ctx.save();
  if (caught) {
    // Security guard just behind (to the left): blue uniform, cap, alert light.
    const gx = x - 13 * s;
    ctx.fillStyle = "#274b8f";
    ctx.fillRect(gx - 4 * s, y - 15 * s, 8 * s, 15 * s);
    ctx.beginPath();
    ctx.arc(gx, y - 17 * s, 3.6 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#16305e";
    ctx.fillRect(gx - 4.5 * s, y - 20 * s, 9 * s, 2.4 * s); // cap
    ctx.fillStyle = "rgba(255,60,60,0.9)";
    ctx.beginPath();
    ctx.arc(gx, y - 24 * s, 2 * s, 0, Math.PI * 2);
    ctx.fill();
  }
  // Thief: dark hooded figure.
  ctx.fillStyle = "#2b2f38";
  ctx.fillRect(x - 4 * s, y - 15 * s, 8 * s, 15 * s); // body
  ctx.beginPath();
  ctx.arc(x, y - 17 * s, 4 * s, 0, Math.PI * 2); // hood
  ctx.fill();
  ctx.fillStyle = "#e8e8e8"; // eye-mask stripe
  ctx.fillRect(x - 3 * s, y - 18 * s, 6 * s, 1.6 * s);
  // Loot sack over the shoulder, marked $.
  ctx.fillStyle = "#d9c27a";
  ctx.beginPath();
  ctx.arc(x + 6 * s, y - 11 * s, 4 * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#7a5a1e";
  ctx.font = `${5 * s}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("$", x + 6 * s, y - 11 * s);
  ctx.restore();
}

/**
 * A gold sparkle + coins rising from an unearthed treasure, centered at (x, y).
 * `phase` runs 0→1: the sparkle grows and drifts up as it fades.
 */
export function drawTreasure(ctx: CanvasRenderingContext2D, x: number, y: number, scale = 1, phase = 0): void {
  const alpha = Math.max(0, 1 - phase);
  if (alpha <= 0) return;
  const s = scale;
  const rise = phase * 12 * s;
  ctx.save();
  ctx.globalAlpha = alpha;
  // Coins.
  ctx.fillStyle = "#f2c14e";
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.arc(x + (i - 1) * 5 * s, y - rise - i * 2 * s, 2.5 * s, 0, Math.PI * 2);
    ctx.fill();
  }
  // Four-point sparkle.
  ctx.fillStyle = "#fff7cc";
  const cy = y - rise;
  const R = (4 + phase * 4) * s;
  const r = R * 0.38;
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const ang = (Math.PI * i) / 4;
    const rr = i % 2 === 0 ? R : r;
    const px = x + Math.cos(ang) * rr;
    const py = cy + Math.sin(ang) * rr;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** A black VIP limousine facing right, its wheels resting on the line y. */
export function drawVipLimo(ctx: CanvasRenderingContext2D, x: number, y: number, scale = 1): void {
  const s = scale;
  const w = 44 * s;
  const h = 9 * s;
  ctx.save();
  // Body + cabin.
  ctx.fillStyle = "#15171c";
  ctx.fillRect(x - w / 2, y - h, w, h);
  ctx.fillRect(x - w / 2 + 8 * s, y - h - 5 * s, w - 18 * s, 6 * s);
  // Tinted windows.
  ctx.fillStyle = "#6ea0d8";
  ctx.fillRect(x - w / 2 + 10 * s, y - h - 3.5 * s, 10 * s, 3 * s);
  ctx.fillRect(x + 2 * s, y - h - 3.5 * s, 10 * s, 3 * s);
  // Wheels with hubs.
  ctx.fillStyle = "#0a0b0e";
  for (const wx of [x - w / 2 + 9 * s, x + w / 2 - 9 * s]) {
    ctx.beginPath();
    ctx.arc(wx, y, 3.2 * s, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = "#cfd3da";
  for (const wx of [x - w / 2 + 9 * s, x + w / 2 - 9 * s]) {
    ctx.beginPath();
    ctx.arc(wx, y, 1.3 * s, 0, Math.PI * 2);
    ctx.fill();
  }
  // Little gold pennant on the hood.
  ctx.strokeStyle = "#c9a227";
  ctx.lineWidth = 1 * s;
  ctx.beginPath();
  ctx.moveTo(x + w / 2 - 2 * s, y - h);
  ctx.lineTo(x + w / 2 - 2 * s, y - h - 8 * s);
  ctx.stroke();
  ctx.fillStyle = "#c9a227";
  ctx.beginPath();
  ctx.moveTo(x + w / 2 - 2 * s, y - h - 8 * s);
  ctx.lineTo(x + w / 2 + 4 * s, y - h - 6 * s);
  ctx.lineTo(x + w / 2 - 2 * s, y - h - 4 * s);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}
