import { NIGHT, WINDOW_MIX, intIn, oneOf, type Rng, type SaverScene } from "./saverScene";

/**
 * The three screen savers that need no tower: Skyline Starfield (flying
 * through a night city whose stars are lit windows), Express Elevators
 * (elevator cars with riders drifting across the sky) and Bulletin Marquee
 * (the tower's news scrolling across black, from lines handed in once).
 */

/** Skyline Starfield. */
export function skylineStarfield(w: number, h: number, rng: Rng = Math.random): SaverScene {
  const cx = w / 2;
  const cy = h / 2;
  const count = Math.max(40, Math.floor((w * h) / 40));
  const make = (far: boolean) => ({
    x: rng() * 2 - 1,
    y: rng() * 2 - 1,
    z: far ? 0.6 + rng() * 0.4 : 0.05 + rng() * 0.95,
    color: oneOf(rng, WINDOW_MIX),
  });
  const windows = Array.from({ length: count }, () => make(false));
  return {
    step(dt) {
      for (let i = 0; i < windows.length; i++) {
        const p = windows[i];
        p.z -= dt * 0.22;
        const sx = cx + (p.x / p.z) * cx;
        const sy = cy + (p.y / p.z) * cy;
        if (p.z <= 0.03 || sx < -4 || sx > w + 4 || sy < -4 || sy > h + 4) windows[i] = make(true);
      }
    },
    draw(c) {
      c.fillStyle = NIGHT.sky;
      c.fillRect(0, 0, w, h);
      for (const p of windows) {
        const sx = Math.round(cx + (p.x / p.z) * cx);
        const sy = Math.round(cy + (p.y / p.z) * cy);
        const size = Math.max(1, Math.round((1 - p.z) * 4));
        c.globalAlpha = Math.min(1, (1 - p.z) * 1.6);
        if (size > 2) {
          // A near window shows its frame around the light.
          c.fillStyle = NIGHT.faintStar;
          c.fillRect(sx, sy, size + 1, size);
          c.fillStyle = p.color;
          c.fillRect(sx + 1, sy + 1, size - 1, size - 2);
        } else {
          c.fillStyle = p.color;
          c.fillRect(sx, sy, size + (size > 1 ? 1 : 0), size);
        }
      }
      c.globalAlpha = 1;
    },
  };
}

/** The rider colors a drifting car may carry. */
const RIDERS = ["#ffc94a", "#ff9a6a", "#bfe0ff", "#7cff6a", "#ff6ad5"] as const;

/** Express Elevators. */
export function expressElevators(w: number, h: number, rng: Rng = Math.random): SaverScene {
  const count = Math.max(5, Math.floor((w * h) / 700));
  const make = (anywhere: boolean) => {
    const scale = oneOf(rng, [1, 1, 2, 2, 3]);
    return {
      x: anywhere ? rng() * (w + 20) : w * 0.3 + rng() * (w * 0.7 + 30),
      y: anywhere ? rng() * (h + 20) - 20 : -30 + rng() * 22,
      scale,
      speed: 5 + scale * 4,
      door: 0,
      // 0 shut and waiting, 1 opening, -1 closing.
      doorDir: 0,
      wait: 1 + rng() * 4,
      rider: oneOf(rng, RIDERS),
    };
  };
  // Small (far) cars first, so near cars draw over them.
  const cars = Array.from({ length: count }, () => make(true)).sort((a, b) => a.scale - b.scale);
  const stars = Array.from({ length: Math.floor((w * h) / 120) }, () => ({
    x: intIn(rng, 0, w - 1),
    y: intIn(rng, 0, h - 1),
  }));
  return {
    step(dt) {
      for (let i = 0; i < cars.length; i++) {
        const k = cars[i];
        k.x -= k.speed * dt;
        k.y += k.speed * dt * 0.55;
        if (k.doorDir === 0) {
          k.wait -= dt;
          if (k.wait <= 0) k.doorDir = 1;
        } else {
          k.door += k.doorDir * dt * 1.2;
          if (k.door >= 1) {
            k.door = 1;
            k.doorDir = -1;
          } else if (k.door <= 0) {
            k.door = 0;
            k.doorDir = 0;
            k.wait = 2 + rng() * 4;
          }
        }
        if (k.x < -8 * k.scale || k.y > h + 12 * k.scale) {
          cars[i] = make(false);
          cars[i].scale = k.scale; // keep the far-to-near draw order
          cars[i].speed = k.speed;
        }
      }
    },
    draw(c) {
      c.fillStyle = NIGHT.sky;
      c.fillRect(0, 0, w, h);
      c.fillStyle = NIGHT.faintStar;
      for (const s of stars) c.fillRect(s.x, s.y, 1, 1);
      for (const k of cars) drawCar(c, k);
    },
  };
}

function drawCar(
  c: CanvasRenderingContext2D,
  k: { x: number; y: number; scale: number; door: number; rider: string },
): void {
  const u = k.scale;
  const x = Math.round(k.x);
  const y = Math.round(k.y);
  const cw = 5 * u;
  const ch = 7 * u;
  c.fillStyle = "#0a0a0a";
  c.fillRect(x - 1, y - 1, cw + 2, ch + 2);
  c.fillStyle = NIGHT.car;
  c.fillRect(x, y, cw, ch);
  // The floor indicator over the doors.
  c.fillStyle = NIGHT.amber;
  c.fillRect(x + Math.floor(cw / 2) - u, y + u, 2 * u, u);
  const ix = x + u;
  const iy = y + 2 * u;
  const iw = cw - 2 * u;
  const ih = ch - 3 * u;
  c.fillStyle = NIGHT.carInside;
  c.fillRect(ix, iy, iw, ih);
  // The rider: a head and a body.
  c.fillStyle = k.rider;
  c.fillRect(ix + Math.floor(iw / 2) - Math.ceil(u / 2), iy + u, u, u);
  c.fillRect(ix + Math.floor(iw / 2) - u, iy + 2 * u, 2 * u, ih - 2 * u);
  // Two door leaves sliding apart.
  const half = iw / 2;
  const open = Math.round(half * k.door);
  c.fillStyle = NIGHT.carDoor;
  c.fillRect(ix, iy, Math.ceil(half) - open, ih);
  c.fillRect(ix + Math.floor(half) + open, iy, Math.ceil(half) - open, ih);
}

/** The colors the marquee cycles through, one per line. */
const MARQUEE_COLORS = ["#ffc94a", "#50e0ff", "#7cff6a", "#ff6ad5", "#e6dcc0"] as const;

/** Bulletin Marquee: each line crosses the screen once, right to left, at a
 *  new height and color, then the next. */
export function bulletinMarquee(w: number, h: number, lines: readonly string[], rng: Rng = Math.random): SaverScene {
  const shown = lines.length > 0 ? lines : ["Verticopolis"];
  const size = Math.max(7, Math.round(h * 0.16));
  const font = `bold ${size}px Tahoma, Verdana, sans-serif`;
  let line = 0;
  // The first line starts on screen, so a still frame (reduced motion) shows it.
  let x = Math.round(w * 0.15);
  let y = intIn(rng, size + 2, Math.max(size + 2, h - 4));
  let width = -1;
  return {
    step(dt) {
      x -= dt * Math.max(16, w * 0.22);
      if (width >= 0 && x < -width - 4) {
        line = (line + 1) % shown.length;
        x = w;
        y = intIn(rng, size + 2, Math.max(size + 2, h - 4));
        width = -1;
      }
    },
    draw(c) {
      c.fillStyle = "#000";
      c.fillRect(0, 0, w, h);
      c.font = font;
      if (width < 0) width = c.measureText(shown[line]).width;
      c.fillStyle = MARQUEE_COLORS[line % MARQUEE_COLORS.length];
      c.fillText(shown[line], Math.round(x), y);
    },
  };
}
