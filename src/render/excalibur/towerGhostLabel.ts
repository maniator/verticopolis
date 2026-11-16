/**
 * A placement ghost's price tag: a small plate centered over the ghost that
 * names what a click costs, so a whole sky bridge (Modern) shows its price
 * before the click. Drawn in screen pixels at a fixed size, so it reads at any
 * zoom; gold-edged when the click would build, red-edged when it would not.
 */

/** The tag's text size and padding, in screen pixels. */
const FONT_PX = 12;
const PAD_X = 6;
const PAD_Y = 3;
/** How far above the ghost's top edge the tag's bottom sits. */
const GAP_PX = 4;

/** Draw `text` on a plate centered at `cx`, just above a ghost whose top is at
 *  `top` (screen pixels). */
export function drawGhostLabel(ctx: CanvasRenderingContext2D, cx: number, top: number, text: string, valid: boolean): void {
  ctx.save();
  ctx.font = `bold ${FONT_PX}px "MS Sans Serif", Tahoma, sans-serif`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  const w = ctx.measureText(text).width + PAD_X * 2;
  const h = FONT_PX + PAD_Y * 2;
  const x = Math.round(cx - w / 2);
  const y = Math.round(top - GAP_PX - h);
  ctx.globalAlpha = 0.92;
  ctx.fillStyle = "#1b1f2a";
  ctx.fillRect(x, y, w, h);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = valid ? "#ffd24a" : "#ff5555";
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  ctx.fillStyle = "#fff";
  ctx.fillText(text, x + w / 2, y + h / 2 + 0.5);
  ctx.restore();
}
