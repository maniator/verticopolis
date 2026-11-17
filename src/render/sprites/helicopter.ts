/**
 * The Fire Rescue helicopter (#1889): a red rescue helicopter, drawn on the
 * overlay in screen space, and the water it sprays on a fire. Original art
 * for Verticopolis, drawn with canvas paths like the other event sprites.
 */

/** The helicopter centered at (x, y), facing left, sized by `s`. `rotor` is
 *  the blade's turn from 0 to 1 (held at 0 under reduced motion). */
export function drawHelicopter(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, rotor: number): void {
  ctx.save();
  // Tail boom and tail rotor.
  ctx.fillStyle = "#b51f1f";
  ctx.fillRect(x + 6 * s, y - 2 * s, 16 * s, 3 * s);
  ctx.fillStyle = "#3a3a3a";
  ctx.fillRect(x + 21 * s, y - 6 * s, 2 * s, 9 * s);
  // Cabin.
  ctx.fillStyle = "#d42a2a";
  ctx.beginPath();
  ctx.ellipse(x, y, 10 * s, 6 * s, 0, 0, Math.PI * 2);
  ctx.fill();
  // Window.
  ctx.fillStyle = "#9fd4f2";
  ctx.beginPath();
  ctx.ellipse(x - 4 * s, y - 1.5 * s, 4 * s, 3 * s, 0, 0, Math.PI * 2);
  ctx.fill();
  // White rescue stripe.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(x - 2 * s, y + 2 * s, 10 * s, 1.5 * s);
  // Skids.
  ctx.fillStyle = "#3a3a3a";
  ctx.fillRect(x - 9 * s, y + 8 * s, 18 * s, 1.5 * s);
  ctx.fillRect(x - 5 * s, y + 5 * s, 1.5 * s, 3 * s);
  ctx.fillRect(x + 4 * s, y + 5 * s, 1.5 * s, 3 * s);
  // Mast and main rotor: the blade's span narrows and widens as it turns.
  ctx.fillRect(x - 0.75 * s, y - 9 * s, 1.5 * s, 3 * s);
  const span = 18 * s * Math.max(0.15, Math.abs(Math.cos(rotor * Math.PI * 2)));
  ctx.fillRect(x - span, y - 10 * s, span * 2, 1.5 * s);
  ctx.restore();
}

/** Water falling from (x, fromY) to the fire at footY, as a few streaks
 *  that drift with `phase` (0 to 1, held still under reduced motion). */
export function drawWaterSpray(ctx: CanvasRenderingContext2D, x: number, fromY: number, footY: number, s: number, phase: number): void {
  if (footY <= fromY) return;
  ctx.save();
  ctx.strokeStyle = "rgba(120,180,255,0.75)";
  ctx.lineWidth = Math.max(1, s);
  const drop = footY - fromY;
  for (let i = 0; i < 5; i++) {
    const dx = (i - 2) * 4 * s;
    const start = ((phase + i * 0.2) % 1) * drop * 0.4;
    ctx.beginPath();
    ctx.moveTo(x + dx * 0.4, fromY + start);
    ctx.lineTo(x + dx, footY);
    ctx.stroke();
  }
  ctx.restore();
}
