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
 * The board Santa in the sleigh seat, feet at (x, footY), sized by `s`. A
 * bespoke integer-rect port (no `person()` dependency): dark boots, a red coat
 * with edge shades, a belt and gold buckle, a fur hem, a skin face with a white
 * beard and a rosy cheek, a pom hat, and a toy sack with a poking-out gift.
 * Every rect rounds to integer device pixels after scaling. The gift is a
 * NON-reserved festive red (`#D0483E`), never the board build script's reserved
 * stress red `#C24A3A`.
 */
function drawSantaFigure(ctx: CanvasRenderingContext2D, x: number, footY: number, s: number): void {
  const px = (ax: number, ay: number, aw: number, ah: number, c: string): void => {
    ctx.fillStyle = c;
    ctx.fillRect(Math.round(x + ax * s), Math.round(footY + ay * s), Math.max(1, Math.round(aw * s)), Math.max(1, Math.round(ah * s)));
  };
  // Toy sack behind Santa, with a gift poking out the top.
  px(-6, -11, 4, 10, "#8A5A3A");
  px(-6, -11, 4, 1, "#A06E48"); // sack highlight
  px(-5, -13, 3, 2, "#D0483E"); // festive-red gift (not the reserved stress red)
  px(-4, -13, 1, 2, "#5AA85A"); // green ribbon bit
  // Boots.
  px(0, -4, 2, 4, "#2A2A2A");
  px(4, -4, 2, 4, "#2A2A2A");
  // Red coat with edge shades.
  px(0, -13, 6, 9, "#B8342E");
  px(0, -13, 1, 9, "#8A241E");
  px(5, -13, 1, 9, "#D0483E");
  // Belt with a gold buckle.
  px(0, -8, 6, 1, "#2A2A2A");
  px(2, -8, 2, 1, "#E8C14A");
  // Fur hem + white cuffs at the coat bottom.
  px(0, -5, 6, 1, "#F4F0EC");
  px(0, -5, 1, 1, "#FFFFFF");
  px(5, -5, 1, 1, "#FFFFFF");
  // Skin face, then a white beard onto the chest and a rosy cheek.
  px(1, -17, 4, 4, "#E8C9A0");
  px(1, -14, 4, 2, "#F4F0EC");
  px(4, -15, 1, 1, "#E8B090");
  // Hat: red crown with a floppy tip, a white fur brim, and a white pom.
  px(1, -18, 4, 2, "#B8342E");
  px(-1, -18, 2, 1, "#B8342E");
  px(-2, -18, 1, 1, "#FFFFFF"); // pom
  px(1, -16, 4, 1, "#FFFFFF"); // brim
}

/**
 * Santa's sleigh + team, centered at (x, y), facing right. `scale` sizes the
 * whole rig. Drawn in screen space on the sky layer. The reindeer, sleigh, and
 * reins are the preserved canon sky rig; only the rider is the enriched board
 * figure.
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

  // The board Santa in the sleigh seat (enriched rider; the rig above is canon).
  drawSantaFigure(ctx, x - 18 * s, y - 4 * s, s);

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
 * The board burglar, feet at (x, footY), sized by `s`. A bespoke integer-rect
 * port (no `person()` dependency): ink legs and a skin face under a striped
 * dark coat with edge shades and faint stripes, a cap with a brim, a mask band
 * across the eyes, a swag sack with a tie and a poking coin, tiptoe toes, and a
 * few sneaky motion dashes trailing behind. Every rect rounds to integer device
 * pixels after scaling. No `$` glyph.
 */
function drawThiefFigure(ctx: CanvasRenderingContext2D, x: number, footY: number, s: number): void {
  const px = (ax: number, ay: number, aw: number, ah: number, c: string): void => {
    ctx.fillStyle = c;
    ctx.fillRect(Math.round(x + ax * s), Math.round(footY + ay * s), Math.max(1, Math.round(aw * s)), Math.max(1, Math.round(ah * s)));
  };
  // Contact shadow, ink legs.
  px(-1, 0, 9, 1, "rgba(0,0,0,0.22)");
  px(1, -6, 2, 6, "#2A2E38");
  px(4, -6, 2, 6, "#2A2E38");
  // Dark coat with edge shades and faint burglar stripes.
  px(0, -19, 7, 13, "#232830");
  px(0, -19, 1, 13, "#14171C");
  px(6, -19, 1, 13, "#33383F");
  px(2, -17, 1, 10, "#3A4048");
  px(4, -17, 1, 10, "#3A4048");
  // Skin face, then a cap with a brim and a mask band across the eyes.
  px(1, -24, 5, 5, "#E8C9A0");
  px(0, -25, 7, 3, "#1A1D22");
  px(0, -22, 7, 1, "#33383F"); // brim
  px(1, -21, 5, 1, "#14171C"); // mask band
  // Swag sack over the shoulder, with a tie and a poking coin (no `$`).
  px(6, -16, 5, 6, "#C9B98A");
  px(6, -16, 5, 1, "#E0D2A8"); // sack highlight
  px(7, -17, 2, 1, "#8A7A54"); // tie
  px(8, -18, 1, 1, "#E8C14A"); // poking coin
  // Tiptoe toes.
  px(1, -1, 2, 1, "#14171C");
  px(4, -1, 2, 1, "#14171C");
  // Sneaky motion dashes trailing behind him.
  px(-4, -12, 2, 1, "#5A6472");
  px(-6, -8, 2, 1, "#5A6472");
  px(-3, -5, 2, 1, "#5A6472");
}

/** The security guard trailing a caught thief, feet at (x, footY), sized by `s`:
 *  a bespoke integer-rect figure in a navy uniform with a peaked cap and a
 *  flashing alert beacon (a functional caught-state cue, not decoration). */
function drawGuardFigure(ctx: CanvasRenderingContext2D, x: number, footY: number, s: number): void {
  const px = (ax: number, ay: number, aw: number, ah: number, c: string): void => {
    ctx.fillStyle = c;
    ctx.fillRect(Math.round(x + ax * s), Math.round(footY + ay * s), Math.max(1, Math.round(aw * s)), Math.max(1, Math.round(ah * s)));
  };
  px(-1, 0, 9, 1, "rgba(0,0,0,0.22)"); // contact shadow
  px(1, -6, 2, 6, "#2A2E38"); // ink legs
  px(4, -6, 2, 6, "#2A2E38");
  px(0, -19, 7, 13, "#274B8F"); // navy uniform with edge shades
  px(0, -19, 1, 13, "#1C3A6E");
  px(6, -19, 1, 13, "#3A5A8F");
  px(1, -24, 5, 5, "#E8C9A0"); // skin face
  px(0, -25, 7, 3, "#16305E"); // peaked cap
  px(0, -22, 7, 1, "#3A5A8F"); // cap band
  px(2, -29, 2, 2, "rgba(255,64,64,0.92)"); // alert beacon
}

/**
 * A masked thief slinking rightward with a swag sack, feet at (x, y). When
 * `caught`, a security guard trails close behind with an alert light. Drawn in
 * screen space on the overlay (in front of the tower).
 */
export function drawThief(ctx: CanvasRenderingContext2D, x: number, y: number, scale = 1, caught = false): void {
  const s = scale;
  ctx.save();
  if (caught) drawGuardFigure(ctx, x - 13 * s, y, s); // trailing guard, just behind (to the left)
  drawThiefFigure(ctx, x, y, s);
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
