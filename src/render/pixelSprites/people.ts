
/**
 * The cast of people the web draws (#2097): a dozen varied builds of office
 * workers, residents, hotel guests and shoppers, plus the staff and the thief,
 * each with a skin tone, a hair color and style, an outfit and sometimes
 * something in hand. A figure faces right in a three-quarter view; a caller
 * mirrors it for one walking left.
 *
 * Two looks share the drawing:
 * - flat (Classic, and every figure baked into a room): solid fills, as the
 *   1994 game drew its people;
 * - lit (Modern's moving people): lit from the upper left, with a highlight
 *   edge, a shadow edge, a darker back leg and a soft contact shadow.
 *
 * The mood colors stay on the top: amber for impatient and the reserved
 * stress red for fed up, so a waiting crowd still reads at a glance. No outfit
 * uses either color (`people.test.ts` keeps them apart).
 *
 * Everything draws at integer pixels with `fillRect`, like `personFigure`.
 */

export type HairStyle = "short" | "crop" | "long" | "bob" | "bun" | "curly" | "bald" | "cap" | "guardCap" | "beanie" | "hardhat";
export type TopKind = "suit" | "blouse" | "tee" | "sweater" | "uniform";
export type Carry = "none" | "briefcase" | "bag" | "suitcase" | "coffee" | "cart" | "flashlight" | "vacuum" | "sack";
export type Build = "slim" | "average" | "broad";
export type Height = "short" | "average" | "tall";

/** One person's look. */
export interface Look {
  readonly skin: string;
  readonly hair: string;
  readonly hairStyle: HairStyle;
  readonly top: string;
  readonly topKind: TopKind;
  readonly bottom: string;
  readonly skirt?: boolean;
  readonly shoe: string;
  readonly build: Build;
  readonly height: Height;
  readonly carry: Carry;
  readonly carryColor?: string;
  readonly tie?: string;
  readonly hiVis?: boolean;
  readonly badge?: boolean;
}

/** What the arms (and sometimes the whole body) are doing. */
export type Pose =
  | "walk" // arms swing with the stride
  | "stand" // arms at the sides
  | "watch" // checks the time while waiting
  | "hips" // hands on hips: impatient
  | "armsUp" // both arms thrown up: fed up
  | "climb" // on the emergency stairs
  | "push" // pushing a cart or a vacuum
  | "bend" // leaning over a bed
  | "run" // a longer stride (the thief)
  | "caught"; // hands up, caught

export type Mood = "content" | "impatient" | "fedUp";

/** The two reserved mood colors (the same as `moodTint` in common.ts). */
export const MOOD_TOP: Record<Exclude<Mood, "content">, string> = { impatient: "#E8862A", fedUp: "#C24A3A" };

export interface DrawOptions {
  readonly lit: boolean;
  /** Walk frame, 0 to 3: 0 and 2 are the two contact frames, 1 and 3 the
   *  passing ones. A flat walk uses only 0 and 2. */
  readonly frame?: number;
  readonly pose?: Pose;
  readonly mood?: Mood;
  /** Leave the carried thing out (inside a room, or in a car). */
  readonly empty?: boolean;
  /** Override the leg, torso and head heights, to fit a room's builds. */
  readonly dims?: Dims;
  /** Size, for a figure drawn on the overlay at the camera's zoom; every rect still lands on whole pixels. */
  readonly scale?: number;
  /** A sleeper on their back, head left, face up: upright cell (col, row) lands at (row, -col - 1), no shadow. */
  readonly lying?: boolean;
}

export interface Dims {
  readonly legs: number;
  readonly torso: number;
  readonly head: number;
  readonly seated?: boolean;
  /** The torso's width, for a room's tightly packed figures; the arms add a
   *  pixel on each side. */
  readonly width?: number;
}

export const SKIN_TONES = ["#F1D3B3", "#E8C9A0", "#D2A57A", "#B07F55", "#8A5A3A", "#5E3B26"] as const;
export const HAIR_COLORS = { black: "#1E1A1A", brown: "#5A3A26", blonde: "#D8B860", red: "#A0482A", gray: "#B8B4B0", auburn: "#7A3A2A" } as const;

const EYE = "#2A2228";
/** The ink the shared sprites use for wheels and suitcase feet (`INK`). */
const INK = "#2A2E38";

/** A color `amt` lighter (or darker, when negative) on every channel, as
 *  #RRGGBB so the lit look can shade an already-shaded color. A color that is
 *  not #RRGGBB comes back unchanged. */
function shade(hex: string, amt: number): string {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return hex;
  const n = parseInt(hex.slice(1), 16);
  const c = (v: number) => Math.max(0, Math.min(255, v + amt)).toString(16).padStart(2, "0");
  return `#${c((n >> 16) & 255)}${c((n >> 8) & 255)}${c(n & 255)}`;
}
const SHIRT_WHITE = "#EDEBE6";
const GOLD = "#C9A24B";

/** How many walk frames each look has: the flat look keeps 1994's two. */
export const WALK_FRAMES = { flat: 2, lit: 4 } as const;
/** The walk frames a flat figure steps through (the two contact frames). */
const FLAT_FRAMES = [0, 2] as const;

/** The frame a look shows at step `step` of its walk. */
export function walkFrame(lit: boolean, step: number): number {
  const n = lit ? WALK_FRAMES.lit : WALK_FRAMES.flat;
  const i = ((step % n) + n) % n;
  return lit ? i : FLAT_FRAMES[i];
}

/** The civilian cast. Index 0 to 9 are drawn for tenants and visitors. */
export const CAST: readonly Look[] = [
  { skin: SKIN_TONES[1], hair: HAIR_COLORS.brown, hairStyle: "short", top: "#3E4654", topKind: "suit", bottom: "#3E4654", shoe: "#1E1A1A", build: "average", height: "tall", carry: "briefcase", tie: "#B03A3A" },
  { skin: SKIN_TONES[3], hair: HAIR_COLORS.black, hairStyle: "bun", top: "#E8E2D6", topKind: "blouse", bottom: "#5A6E8C", skirt: true, shoe: "#2A2E38", build: "slim", height: "average", carry: "coffee" },
  { skin: SKIN_TONES[5], hair: HAIR_COLORS.black, hairStyle: "crop", top: "#5A6E8C", topKind: "suit", bottom: "#3E4654", shoe: "#1E1A1A", build: "broad", height: "tall", carry: "none", tie: "#3F6E8C" },
  { skin: SKIN_TONES[0], hair: HAIR_COLORS.red, hairStyle: "long", top: "#3F8C84", topKind: "tee", bottom: "#3E5A8A", shoe: "#E8E4DA", build: "slim", height: "average", carry: "none" },
  { skin: SKIN_TONES[2], hair: HAIR_COLORS.gray, hairStyle: "bald", top: "#6E5A4A", topKind: "sweater", bottom: "#5A5048", shoe: "#3A2E28", build: "broad", height: "short", carry: "none" },
  { skin: SKIN_TONES[4], hair: HAIR_COLORS.black, hairStyle: "curly", top: "#D8B05A", topKind: "tee", bottom: "#3E5A8A", shoe: "#E8E4DA", build: "average", height: "average", carry: "bag", carryColor: "#E8E4DA" },
  { skin: SKIN_TONES[1], hair: HAIR_COLORS.blonde, hairStyle: "bob", top: "#9A5FB0", topKind: "tee", bottom: "#3E4654", shoe: "#2A2E38", build: "slim", height: "average", carry: "suitcase" },
  { skin: SKIN_TONES[3], hair: HAIR_COLORS.brown, hairStyle: "cap", top: "#4FA0C8", topKind: "tee", bottom: "#6E5A4A", shoe: "#E8E4DA", build: "average", height: "tall", carry: "suitcase", carryColor: "#6E4A30" },
  { skin: SKIN_TONES[2], hair: HAIR_COLORS.auburn, hairStyle: "long", top: "#5AA85A", topKind: "blouse", bottom: "#3E4654", skirt: true, shoe: "#3A2E28", build: "slim", height: "short", carry: "bag", carryColor: "#3F8C84" },
  { skin: SKIN_TONES[5], hair: HAIR_COLORS.black, hairStyle: "short", top: "#C8C0B0", topKind: "tee", bottom: "#2A2E38", shoe: "#E8E4DA", build: "average", height: "average", carry: "coffee" },
];

/** The staff and the thief. */
export const STAFF_LOOK = {
  housekeeper: { skin: SKIN_TONES[4], hair: HAIR_COLORS.black, hairStyle: "bun", top: "#E8E4DA", topKind: "uniform", bottom: "#5A6E8C", shoe: "#2A2E38", build: "average", height: "average", carry: "cart" },
  security: { skin: SKIN_TONES[2], hair: HAIR_COLORS.brown, hairStyle: "guardCap", top: "#2E3A5A", topKind: "uniform", badge: true, bottom: "#1E2638", shoe: "#1E1A1A", build: "broad", height: "tall", carry: "flashlight" },
  maintenance: { skin: SKIN_TONES[2], hair: HAIR_COLORS.brown, hairStyle: "hardhat", top: "#3F5A7A", topKind: "uniform", hiVis: true, bottom: "#3E5A8A", shoe: "#3A2E28", build: "broad", height: "tall", carry: "none" },
  thief: { skin: SKIN_TONES[1], hair: "#1E1A1A", hairStyle: "beanie", top: "#3A3448", topKind: "tee", bottom: "#2A2E38", shoe: "#E8E4DA", build: "slim", height: "average", carry: "sack" },
} as const satisfies Record<string, Look>;

/** The cast member for a seed, as an index into `LOOKS`. */
export function castIndex(seed: number): number {
  return Math.abs(seed) % CAST.length;
}

/** The housekeeping crew: one uniform, different people, so a crew lined up
 *  for the elevator reads as a crew rather than one figure stamped out. */
const CREW_FACES: readonly Pick<Look, "skin" | "hair" | "hairStyle" | "build" | "height">[] = [
  { skin: SKIN_TONES[4], hair: HAIR_COLORS.black, hairStyle: "bun", build: "average", height: "average" },
  { skin: SKIN_TONES[1], hair: HAIR_COLORS.brown, hairStyle: "short", build: "broad", height: "tall" },
  { skin: SKIN_TONES[2], hair: HAIR_COLORS.black, hairStyle: "long", build: "slim", height: "short" },
  { skin: SKIN_TONES[5], hair: HAIR_COLORS.black, hairStyle: "crop", build: "average", height: "tall" },
  { skin: SKIN_TONES[0], hair: HAIR_COLORS.blonde, hairStyle: "bob", build: "slim", height: "average" },
  { skin: SKIN_TONES[3], hair: HAIR_COLORS.gray, hairStyle: "curly", build: "broad", height: "short" },
];
const CREW = CREW_FACES.map((face) => ({ ...STAFF_LOOK.housekeeper, ...face }));

/** Every look a moving figure can wear: the civilian cast first, then the
 *  housekeeping crew with carts, the same crew with vacuums, and the other
 *  staff, so a figure names its look by one index. */
export const LOOKS: readonly Look[] = [
  ...CAST,
  ...CREW,
  ...CREW.map((h) => ({ ...h, carry: "vacuum" as const })),
  STAFF_LOOK.security,
  STAFF_LOOK.maintenance,
  STAFF_LOOK.thief,
];

/** The staff looks' indexes into `LOOKS` (a housekeeper's first crew face). */
export const LOOK = {
  housekeeper: CAST.length,
  housekeeperCleaning: CAST.length + CREW.length,
  security: CAST.length + 2 * CREW.length,
  maintenance: CAST.length + 2 * CREW.length + 1,
  thief: CAST.length + 2 * CREW.length + 2,
} as const;

/** The housekeeper look for a seed, pushing a cart or, at work, a vacuum. */
export function crewIndex(seed: number, cleaning: boolean): number {
  return (cleaning ? LOOK.housekeeperCleaning : LOOK.housekeeper) + (Math.abs(seed) % CREW.length);
}

/** Every outfit color a look can wear, for the palette guard. */
export function outfitColors(look: Look): string[] {
  return [look.top, look.bottom, look.shoe, ...(look.carryColor ? [look.carryColor] : []), ...(look.tie ? [look.tie] : [])];
}

const TORSO_W: Record<Build, number> = { slim: 5, average: 6, broad: 7 };
const LEGS_H: Record<Height, number> = { short: 6, average: 7, tall: 8 };

/** A figure's full height in pixels above its foot line, for sizing a bake. */
export function figureHeight(look: Look, dims?: Dims): number {
  const legs = dims?.seated ? 0 : (dims?.legs ?? LEGS_H[look.height]);
  const torso = dims?.torso ?? (look.height === "short" ? 8 : 9);
  return legs + torso + 1 + (dims?.head ?? 6) + 2;
}

/**
 * Draw one person with the foot line at `foot` and the left edge near `x`
 * (the back arm and a carried suitcase reach a few pixels left of it).
 */
export function drawPerson(ctx: CanvasRenderingContext2D, x: number, foot: number, look: Look, o: DrawOptions): void {
  const X = Math.round(x);
  const F = Math.round(foot);
  const s = o.scale ?? 1;
  const at = (d: number) => Math.round(d * s);
  const size = (d: number) => Math.max(1, Math.round(d * s));
  const px = (c: string, dx: number, dy: number, w = 1, h = 1) => {
    ctx.fillStyle = c;
    if (o.lying) ctx.fillRect(X + at(dy), F - at(dx) - size(w), size(h), size(w));
    else ctx.fillRect(X + at(dx), F + at(dy), size(w), size(h));
  };
  const lit = o.lit;
  const frame = o.frame ?? 1;
  const pose = o.pose ?? "walk";
  const hi = (c: string) => (lit ? shade(c, 34) : c);
  const lo = (c: string) => (lit ? shade(c, -42) : c);
  const W = o.dims?.width ?? TORSO_W[look.build];
  const seated = o.dims?.seated === true;
  const legsH = seated ? 0 : (o.dims?.legs ?? LEGS_H[look.height]);
  const torsoH = o.dims?.torso ?? (look.height === "short" ? 8 : 9);
  const headH = o.dims?.head ?? 6;
  const top = o.mood && o.mood !== "content" ? MOOD_TOP[o.mood] : look.top;
  const ox = 1; // room for the back arm on the left

  // Contact shadow: one hard row when flat, a soft two-row pool when lit.
  if (!o.lying && lit) {
    px("rgba(0,0,0,0.18)", -1, 0, W + 4, 1);
    px("rgba(0,0,0,0.10)", -2, 0, W + 6, 1);
    px("rgba(0,0,0,0.10)", 0, 1, W + 2, 1);
  } else if (!o.lying) {
    px("rgba(0,0,0,0.24)", -1, 0, W + 3, 1);
  }

  // Legs: the stride moves the back leg left and the front leg right on frame
  // 0, the other way on frame 2, and together on the passing frames.
  const still = pose === "climb" || pose === "stand" || pose === "watch" || pose === "hips" || pose === "armsUp" || pose === "caught" || pose === "bend";
  const reach = pose === "run" ? 1 : 0;
  const swing = still ? 0 : strideSwing(frame);
  const inset = Math.floor((W - 4) / 2);
  const backLeg = ox + inset - swing * (2 + reach) + (swing < 0 ? 1 : 0);
  // A torso narrower than five (a room's packed figures) keeps a pixel of
  // daylight between the legs by setting the front one under the arm.
  const legGap = W < 5 ? 1 : 0;
  const frontLeg = ox + W - 2 - inset + legGap + swing * (2 + reach);
  const legTop = seated ? -1 : -legsH;
  const legColor = look.skirt ? look.skin : look.bottom;
  if (seated) {
    px(look.bottom, ox, -1, W + 2, 1);
    if (lit) px(lo(look.bottom), ox, 0, W + 2, 1);
  } else {
    px(lo(shade(legColor, -14)), backLeg, legTop, 2, legsH); // the back leg sits in shadow
    px(legColor, frontLeg, legTop, 2, legsH);
    if (lit) px(hi(legColor), frontLeg, legTop, 1, legsH);
    px(look.shoe, backLeg, -1, 3, 1);
    px(look.shoe, frontLeg, -1, 3, 1);
    if (look.skirt && legsH >= 6) {
      px(look.bottom, ox - 1, legTop, W + 2, 3);
      px(look.bottom, ox, legTop + 3, W, 1);
      if (lit) {
        px(hi(look.bottom), ox - 1, legTop, 1, 3);
        px(lo(look.bottom), ox + W, legTop, 1, 3);
      }
    }
  }

  // Torso, with rounded shoulders (the top row stops short of both corners,
  // never cleared, so a figure drawn over other art leaves no holes in it),
  // then the outfit's detail.
  const tt = legTop - torsoH + (pose === "bend" ? 3 : 0);
  px(top, ox + 1, tt, W - 2, 1);
  px(top, ox, tt + 1, W, torsoH - 1);
  if (lit) {
    px(hi(top), ox, tt + 1, 1, torsoH - 1);
    px(lo(top), ox + W - 1, tt + 1, 1, torsoH - 1);
    px(lo(top), ox, tt + torsoH - 1, W, 1);
    px(hi(top), ox + 1, tt, W - 2, 1);
  } else {
    px(shade(top, -18), ox, tt + torsoH - 1, W, 1);
  }
  const mid = ox + Math.floor(W / 2);
  if (look.topKind === "suit") {
    px(SHIRT_WHITE, mid - 1, tt, 2, 2);
    px(SHIRT_WHITE, mid, tt + 2, 1, 1);
    px(look.tie ?? "#B03A3A", mid, tt + 1, 1, 4);
  } else if (look.topKind === "uniform") {
    px(shade(top, -40), ox, tt + Math.floor(torsoH / 2), W, 1); // belt line
    if (look.hiVis) px("#F4D24A", ox, tt + 3, W, 1);
    if (look.badge) px(GOLD, ox + 1, tt + 2, 1, 1);
  } else if (look.topKind === "tee") {
    px(shade(top, -22), ox + 1, tt, W - 2, 1); // neckline
  }

  // Arms: the back arm on the left, darker; the front arm on the right edge.
  const back = lo(shade(top, -20));
  const front = lit ? lo(top) : shade(top, -10);
  const ax = ox + W;
  const armH = torsoH - 2;
  const armSwing = swing;
  if (pose === "armsUp" || pose === "caught") {
    px(back, ox - 1, tt - 3, 1, 4);
    px(lo(look.skin), ox - 1, tt - 4, 1, 1);
    px(front, ax, tt - 3, 1, 4);
    px(look.skin, ax, tt - 4, 1, 1);
  } else if (pose === "watch") {
    px(back, ox - 1, tt + 1, 1, armH - 1);
    px(lo(look.skin), ox - 1, tt + armH, 1, 1);
    px(front, ax, tt + 1, 1, 3);
    px(front, ax - 2, tt + 3, 2, 1);
    px(look.skin, ax - 3, tt + 3, 1, 1);
    px(GOLD, ax - 2, tt + 3, 1, 1); // the watch
  } else if (pose === "hips") {
    px(back, ox - 2, tt + 1, 1, 3);
    px(lo(look.skin), ox - 1, tt + 4, 1, 1);
    px(front, ax + 1, tt + 1, 1, 3);
    px(look.skin, ax, tt + 4, 1, 1);
  } else if (pose === "climb") {
    const up = frame % 2 === 0;
    px(back, ox - 1, tt - (up ? 3 : 1), 1, 4);
    px(front, ax, tt - (up ? 1 : 3), 1, 4);
    px(look.skin, ox - 1, tt - (up ? 4 : 2), 1, 1);
    px(look.skin, ax, tt - (up ? 2 : 4), 1, 1);
  } else if (pose === "push" || pose === "bend") {
    px(back, ox - 1, tt + 1, 1, 3);
    px(front, ax, tt + 1, 1, 3);
    px(front, ax + 1, tt + 3, 2, 1);
    px(look.skin, ax + 3, tt + 3, 1, 1);
  } else {
    px(back, ox - 1, tt + 1 + (armSwing < 0 ? 1 : 0), 1, armH - 1);
    px(lo(look.skin), ox - 1, tt + armH + (armSwing < 0 ? 1 : 0), 1, 1);
    px(front, ax, tt + 1 + (armSwing > 0 ? 1 : 0), 1, armH - 1);
    px(look.skin, ax + (armSwing > 0 ? 1 : 0), tt + armH + (armSwing > 0 ? 1 : 0), 1, 1);
  }

  // A cart is drawn only while it is pushed: a housekeeper standing in a line
  // or riding leaves it out of the picture.
  const parked = look.carry === "cart" && pose !== "push";
  if (!o.empty && !parked) drawCarry(px, look, o, { ox, ax, tt, hand: tt + armH + 1 + (armSwing > 0 ? 1 : 0), frame });

  // Neck and head: five wide, rounded, facing right, with an eye and a nose.
  const nt = tt - 1;
  px(lo(look.skin), mid - 1, nt, 2, 1);
  const lean = pose === "bend" || pose === "run" ? 1 : 0;
  const hx = ox + Math.floor((W - 5) / 2) + 1 + lean;
  const ht = nt - headH;
  // A rounded head: the top row and the chin stop short of the corners.
  px(look.skin, hx + 1, ht, 3, 1);
  px(look.skin, hx, ht + 1, 5, headH - 2);
  px(look.skin, hx + 1, ht + headH - 1, 4, 1);
  if (lit) {
    px(hi(look.skin), hx + 1, ht + 1, 1, 2);
    px(lo(look.skin), hx + 1, ht + headH - 1, 3, 1);
    px(shade(look.skin, -22), hx + 4, ht + 2, 1, headH - 3);
  }
  const ey = headH >= 6 ? 3 : 2;
  px(EYE, hx + 3, ht + ey, 1, 1);
  px(lo(look.skin), hx + 5, ht + ey, 1, 1);
  drawHair(px, look, hx, ht, lit);
}

/** Which way a walk frame throws the legs and arms: forward on the first
 *  contact frame, back on the second, together while passing. */
function strideSwing(frame: number): number {
  if (frame === 0) return 1;
  if (frame === 2) return -1;
  return 0;
}

type Px = (c: string, dx: number, dy: number, w?: number, h?: number) => void;

function drawCarry(px: Px, look: Look, o: DrawOptions, at: { ox: number; ax: number; tt: number; hand: number; frame: number }): void {
  const { ox, ax, tt, hand } = at;
  const lit = o.lit;
  const pose = o.pose ?? "walk";
  const color = look.carryColor;
  switch (look.carry) {
    case "briefcase":
      px(color ?? "#4A3426", ax, hand, 3, 3);
      if (lit) px(shade(color ?? "#4A3426", 25), ax, hand, 3, 1);
      return;
    case "bag":
      px(color ?? "#D84A7A", ax, hand, 3, 4);
      px("#F4F0E8", ax + 1, hand - 1, 1, 1);
      return;
    case "suitcase":
      px(color ?? "#3F6E8C", ox - 4, -9, 3, 8);
      px(INK, ox - 4, -1, 1, 1);
      px(INK, ox - 2, -1, 1, 1);
      px("#8A8A8A", ox - 3, -11, 1, 2);
      return;
    case "coffee":
      px("#F4F0E8", ax, hand - 1, 2, 2);
      px("#6E4A30", ax, hand - 1, 2, 1);
      return;
    case "cart": {
      if (pose === "bend" || pose === "stand") return; // parked while making a bed
      const cx = ax + 4;
      px("#8A8E96", cx, -2, 7, 1);
      px("#5A6E8C", cx, -8, 7, 6);
      px("#E8E4DA", cx + 1, -7, 2, 2);
      px("#4FA0C8", cx + 4, -7, 2, 3);
      px(INK, cx, -1, 1, 1);
      px(INK, cx + 6, -1, 1, 1);
      px("#8A8E96", ax + 2, tt + 3, 2, 1);
      if (lit) px(shade("#5A6E8C", 30), cx, -8, 7, 1);
      return;
    }
    case "vacuum": {
      const vx = ax + 2;
      px("#3A3E48", vx, tt + 3, 1, 1);
      px("#3A3E48", vx + 1, tt + 4, 1, 3);
      px("#3A3E48", vx + 2, tt + 7, 1, -tt - 9);
      px("#B03A6A", vx + 1, -8, 3, 5);
      px(INK, vx + 1, -3, 5, 2);
      if (at.frame % 2 === 0) {
        px("rgba(200,190,170,0.6)", vx + 6, -2, 1, 1); // a puff of dust
        px("rgba(200,190,170,0.6)", vx + 7, -3, 1, 1);
      }
      return;
    }
    case "flashlight":
      px("#3A3E48", ax, hand - 1, 2, 1);
      return;
    case "sack":
      px("#8A6A3A", ox - 4, tt - 1, 4, 6);
      px("#6E5230", ox - 4, tt + 4, 4, 1);
      px("#E8C77A", ox - 3, tt, 1, 1);
      return;
    case "none":
      return;
  }
}

function drawHair(px: Px, look: Look, hx: number, ht: number, lit: boolean): void {
  const H = look.hair;
  switch (look.hairStyle) {
    case "short":
      px(H, hx + 1, ht, 3, 2);
      px(H, hx + 1, ht - 1, 3, 1);
      px(H, hx, ht + 1, 1, 3);
      break;
    case "crop":
      px(H, hx + 1, ht, 3, 1);
      px(H, hx, ht + 1, 4, 1);
      px(H, hx, ht + 2, 1, 1);
      break;
    case "long":
      px(H, hx, ht - 1, 4, 1);
      px(H, hx - 1, ht, 5, 2);
      px(H, hx - 1, ht + 2, 2, 5);
      px(H, hx + 4, ht + 1, 1, 1);
      break;
    case "bob":
      px(H, hx, ht - 1, 4, 1);
      px(H, hx - 1, ht, 6, 2);
      px(H, hx - 1, ht + 2, 2, 3);
      break;
    case "bun":
      px(H, hx - 1, ht - 2, 2, 2);
      px(H, hx, ht, 5, 1);
      px(H, hx, ht + 1, 2, 1);
      px(H, hx - 1, ht + 1, 1, 3);
      break;
    case "curly":
      px(H, hx - 1, ht - 1, 6, 3);
      px(H, hx - 1, ht + 2, 2, 2);
      px(H, hx + 1, ht - 2, 1, 1);
      px(H, hx + 3, ht - 2, 1, 1);
      break;
    case "bald":
      px(H, hx, ht + 2, 1, 2);
      return;
    case "cap":
      px(H, hx, ht - 1, 5, 2);
      px(H, hx + 4, ht + 1, 2, 1);
      break;
    case "guardCap":
      px("#1E2638", hx - 1, ht, 7, 1);
      px("#2E3A5A", hx, ht - 2, 5, 2);
      px(GOLD, hx + 2, ht - 1, 1, 1);
      px(H, hx, ht + 1, 1, 2);
      break;
    case "beanie":
      px("#1E1A1A", hx - 1, ht - 1, 6, 3);
      px("#1E1A1A", hx, ht - 2, 4, 1);
      px("#1E1A1A", hx, ht + 2, 6, 1); // the mask band across the eyes
      px("#E8E4DA", hx + 3, ht + 2, 1, 1);
      break;
    case "hardhat":
      px("#F4D24A", hx - 1, ht, 7, 1);
      px("#F4D24A", hx, ht - 1, 5, 1);
      return;
  }
  if (lit) px(shade(H, 30), hx + 1, ht - 1, 1, 1);
}
