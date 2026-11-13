/**
 * The wooden revolving door between two lobby halls of different heights
 * (#2068). Four wooden wings with glass in the upper panels turn on a center
 * post inside a drum, under a wooden canopy with brass trim. The drum straddles
 * the wall between the halls; the wall runs from the taller hall's ceiling down
 * to the canopy.
 *
 * The door turns one way only: seen from the street side, its front half moves
 * to the right. So a person walking right passes through the front of the drum
 * and a person walking left passes through the back, and two people can cross
 * in opposite directions at the same time, each in their own compartment.
 *
 * Draw order, so each person sits in the right compartment:
 * 1. `drawRevolvingDoorBack`: the wall, the drum's back, the back wings.
 * 2. The people walking left (they pass behind the center post).
 * 3. `drawRevolvingDoorMiddle`: the center post and the front wings.
 * 4. The people walking right.
 * 5. `drawRevolvingDoorFront`: the drum's front glass, its posts and canopy.
 *
 * Every piece keys on `angle` and `lit` only. Integer pixels.
 */


/** The drum's radius in world pixels: wide enough for one walker (7 px) per
 *  compartment with room to push. */
export const DOOR_RADIUS = 12;
/** The height of the wings and the drum, under the canopy. */
export const DOOR_HEIGHT = 30;
/** The canopy's thickness above the drum. */
const CANOPY = 4;
/** A quarter turn: four wings, so the door looks the same every quarter. */
export const QUARTER_TURN = Math.PI / 2;

interface DoorColors {
  inside: string;
  woodFront: string;
  woodFace: string;
  woodBack: string;
  glassFront: string;
  glassBack: string;
  canopy: string;
  brass: string;
  wall: string;
  wallEdge: string;
  drumGlass: string;
}

const DAY: DoorColors = {
  inside: "#3A2614",
  woodFront: "#74492A",
  woodFace: "#8A5A34",
  woodBack: "#4E3220",
  glassFront: "rgba(190,215,225,0.55)",
  glassBack: "rgba(120,140,150,0.55)",
  canopy: "#6B4426",
  brass: "#C9A24B",
  wall: "#D8CDB6",
  wallEdge: "#A89878",
  drumGlass: "rgba(205,228,238,0.16)",
};

const NIGHT: DoorColors = {
  inside: "#4A3018",
  woodFront: "#6A4024",
  woodFace: "#7E5230",
  woodBack: "#3E2818",
  glassFront: "rgba(255,214,150,0.38)",
  glassBack: "rgba(150,120,80,0.45)",
  canopy: "#5E3A20",
  brass: "#E2BC5C",
  wall: "#C8BBA0",
  wallEdge: "#968766",
  drumGlass: "rgba(255,220,160,0.12)",
};

function colors(lit: boolean): DoorColors {
  return lit ? NIGHT : DAY;
}

interface Wing {
  /** The wing tip's x offset from the center post. */
  tipX: number;
  /** Toward the viewer (positive) or away (negative), from -1 to 1. */
  depth: number;
}

/** The four wings at `angle`. Angle 0 points a wing straight at the viewer;
 *  a rising angle moves the front wing to the right. */
function wings(angle: number): Wing[] {
  const out: Wing[] = [];
  for (let k = 0; k < 4; k++) {
    const a = angle + k * QUARTER_TURN;
    out.push({ tipX: Math.sin(a) * DOOR_RADIUS, depth: Math.cos(a) });
  }
  return out.sort((p, q) => p.depth - q.depth);
}

/** One wing, seen from the side: a panel from the center post out to its tip,
 *  wood below, glass above, a brass push bar across the middle. A wing that
 *  points at the viewer (or away) shows only its edge. */
function drawWing(ctx: CanvasRenderingContext2D, cx: number, top: number, w: Wing, c: DoorColors): void {
  const front = w.depth >= 0;
  const tip = Math.round(cx + w.tipX);
  const x0 = Math.min(cx, tip);
  const span = Math.abs(tip - cx);
  const h = DOOR_HEIGHT - 2;
  const y = top + 1;
  // A near wing turned broadside to the viewer catches the light on its face.
  const broadside = Math.abs(w.tipX) > DOOR_RADIUS * 0.7;
  let wood = c.woodBack;
  if (front) wood = broadside ? c.woodFace : c.woodFront;
  if (span < 2) {
    ctx.fillStyle = wood; // edge on: just the stile
    ctx.fillRect(tip, y, 1, h);
    return;
  }
  const glassH = Math.round(h * 0.42);
  ctx.fillStyle = wood;
  ctx.fillRect(x0, y, span + 1, 2); // top rail
  ctx.fillStyle = front ? c.glassFront : c.glassBack;
  ctx.fillRect(x0, y + 2, span + 1, glassH); // glass in the upper panel
  ctx.fillStyle = wood;
  ctx.fillRect(x0, y + 2 + glassH, span + 1, h - 2 - glassH); // wooden lower panel
  ctx.fillRect(tip, y, 1, h); // the stile at the tip
  if (front) {
    ctx.fillStyle = c.brass; // push bar
    ctx.fillRect(x0 + 1, y + 2 + glassH + 2, Math.max(1, span - 1), 1);
  }
}

/** Where the shorter hall's ceiling meets the wall: above `y` the wall
 *  stands on the taller hall's side alone (`side` -1 left, 1 right), so it
 *  never covers what is built over the shorter hall. */
export interface WallStep {
  y: number;
  side: -1 | 1;
}

/** One stretch of the marble wall, `w` wide from `x0`, with darker edges. */
function wallStrip(ctx: CanvasRenderingContext2D, c: DoorColors, x0: number, w: number, y0: number, y1: number): void {
  if (y1 <= y0) return;
  ctx.fillStyle = c.wall;
  ctx.fillRect(x0, y0, w, y1 - y0);
  ctx.fillStyle = c.wallEdge;
  ctx.fillRect(x0, y0, 1, y1 - y0);
  ctx.fillRect(x0 + w - 1, y0, 1, y1 - y0);
}

/** The wall over the door, the drum's dark back and floor plate, and the
 *  wings on the far side of the center post. `wallTop` is the taller hall's
 *  ceiling; `foot` is the line people stand on; `step`, where the halls'
 *  ceilings differ, is the shorter one's. */
export function drawRevolvingDoorBack(
  ctx: CanvasRenderingContext2D,
  cx: number,
  foot: number,
  wallTop: number,
  angle: number,
  lit: boolean,
  step?: WallStep,
): void {
  const c = colors(lit);
  const x = Math.round(cx);
  const top = Math.round(foot) - DOOR_HEIGHT;
  const wallBottom = top - CANOPY;
  const stepY = step ? Math.max(Math.round(wallTop), Math.min(wallBottom, Math.round(step.y))) : Math.round(wallTop);
  if (step) wallStrip(ctx, c, step.side < 0 ? x - 2 : x, 3, Math.round(wallTop), stepY); // the taller hall's side
  wallStrip(ctx, c, x - 2, 5, stepY, wallBottom); // marble wall between the halls
  ctx.fillStyle = c.inside; // the dark inside of the drum
  ctx.fillRect(x - DOOR_RADIUS, top, 2 * DOOR_RADIUS + 1, DOOR_HEIGHT);
  ctx.fillStyle = c.canopy; // the round floor plate
  ctx.fillRect(x - DOOR_RADIUS, Math.round(foot) - 1, 2 * DOOR_RADIUS + 1, 1);
  for (const w of wings(angle)) if (w.depth < 0) drawWing(ctx, x, top, w, c);
}

/** The center post and the wings on the near side of it. People walking left
 *  are drawn before this, people walking right after it. */
export function drawRevolvingDoorMiddle(ctx: CanvasRenderingContext2D, cx: number, foot: number, angle: number, lit: boolean): void {
  const c = colors(lit);
  const x = Math.round(cx);
  const top = Math.round(foot) - DOOR_HEIGHT;
  ctx.fillStyle = "#2A1C10"; // center post
  ctx.fillRect(x, top, 1, DOOR_HEIGHT);
  for (const w of wings(angle)) if (w.depth >= 0) drawWing(ctx, x, top, w, c);
}

/** The drum's curved front glass, its two wooden posts, and the wooden
 *  canopy with its brass trim. */
export function drawRevolvingDoorFront(ctx: CanvasRenderingContext2D, cx: number, foot: number, lit: boolean): void {
  const c = colors(lit);
  const x = Math.round(cx);
  const top = Math.round(foot) - DOOR_HEIGHT;
  const left = x - DOOR_RADIUS - 1;
  const width = 2 * DOOR_RADIUS + 3;
  ctx.fillStyle = c.drumGlass; // the curved glass, with one highlight where it turns
  ctx.fillRect(x - DOOR_RADIUS, top, 2 * DOOR_RADIUS + 1, DOOR_HEIGHT);
  ctx.fillStyle = "rgba(255,255,255,0.18)";
  ctx.fillRect(x - DOOR_RADIUS + 3, top + 2, 1, DOOR_HEIGHT - 6);
  ctx.fillStyle = c.canopy;
  ctx.fillRect(left, top - CANOPY, width, CANOPY); // wooden canopy
  ctx.fillRect(left, top, 1, DOOR_HEIGHT); // drum posts
  ctx.fillRect(left + width - 1, top, 1, DOOR_HEIGHT);
  ctx.fillStyle = c.brass;
  ctx.fillRect(left, top - CANOPY, width, 1); // brass trim, top and bottom of the canopy
  ctx.fillRect(left, top - 1, width, 1);
  ctx.fillRect(left, Math.round(foot) - 1, 1, 1); // brass shoes on the posts
  ctx.fillRect(left + width - 1, Math.round(foot) - 1, 1, 1);
}

/** True while a person standing at `personX` (their left edge, `width` wide)
 *  is inside the drum centered at `cx`. */
export function insideDrum(cx: number, personX: number, width: number): boolean {
  const mid = personX + width / 2;
  return Math.abs(mid - cx) <= DOOR_RADIUS;
}

/** The door's next angle. It turns only while someone is inside, at the pace
 *  of a person walking `speed` world pixels a second pushing a wing at its
 *  tip, always the same way, and stops the moment the drum is empty. */
export function turnDoor(angle: number, occupied: boolean, speed: number, dt: number): number {
  if (!occupied) return angle;
  return (angle + (Math.abs(speed) * dt) / DOOR_RADIUS) % (4 * QUARTER_TURN);
}
