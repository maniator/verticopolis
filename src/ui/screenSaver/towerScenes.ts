import { NIGHT, WINDOW, WINDOW_MIX, intIn, oneOf, type Rng, type SaverScene } from "./saverScene";

/**
 * The two screen savers that draw a tower: Night Shift (the player's own
 * tower at night, from a snapshot read once when the saver starts) and
 * Endless Tower (a crane building made-up towers floor by floor).
 */

/** The player's tower as Night Shift draws it: tile columns and floors, read
 *  once from the view when the saver starts (`screenSaverWiring.ts`). */
export interface TowerSnapshot {
  /** Floor and lobby runs: the tower's outline. `width` is in tiles. */
  readonly structure: ReadonlyArray<{ readonly floor: number; readonly x: number; readonly width: number }>;
  /** Rooms, with the window color their kind lights and whether anyone is in. */
  readonly rooms: ReadonlyArray<{
    readonly floor: number;
    readonly x: number;
    readonly width: number;
    readonly color: string;
    readonly lit: boolean;
  }>;
  /** Elevator shafts, each with the floors it spans. */
  readonly shafts: ReadonlyArray<{
    readonly x: number;
    readonly width: number;
    readonly bottom: number;
    readonly top: number;
  }>;
}

/** A room's place and light on the scene's canvas. */
interface Pane {
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  lit: boolean;
}

/** A shaft and its one gliding car, in canvas pixels. */
interface Lift {
  x: number;
  w: number;
  bottom: number;
  top: number;
  pos: number;
  target: number;
  wait: number;
}

/** Fit a snapshot to the canvas: tiles to pixels, floors to rows. */
function layout(t: TowerSnapshot, w: number, h: number) {
  let minX = Infinity;
  let maxX = -Infinity;
  let low = Infinity;
  let high = -Infinity;
  for (const r of t.structure) {
    minX = Math.min(minX, r.x);
    maxX = Math.max(maxX, r.x + r.width);
    low = Math.min(low, r.floor);
    high = Math.max(high, r.floor);
  }
  const ground = h - 3;
  const floors = high - low + 1;
  const rowH = Math.max(1, Math.min(4, Math.floor((h * 0.8) / floors)));
  const scale = Math.min(2, (w * 0.86) / Math.max(1, maxX - minX));
  const left = Math.floor((w - (maxX - minX) * scale) / 2);
  return {
    ground,
    rowH,
    px: (x: number) => left + Math.floor((x - minX) * scale),
    span: (x: number, width: number) =>
      Math.max(1, Math.floor((x - minX + width) * scale) - Math.floor((x - minX) * scale)),
    py: (floor: number) => ground - (floor - low + 1) * rowH,
  };
}

/** A made-up tower for a player with no rooms yet, so Night Shift never shows
 *  an empty lot. */
export function madeUpTower(rng: Rng): TowerSnapshot {
  const floors = intIn(rng, 30, 60);
  const structure: { floor: number; x: number; width: number }[] = [];
  const rooms: { floor: number; x: number; width: number; color: string; lit: boolean }[] = [];
  let l = 0;
  let r = intIn(rng, 60, 90);
  for (let f = 0; f < floors; f++) {
    if (f > 2 && rng() < 0.12 && r - l > 20) {
      if (rng() < 0.5) l += intIn(rng, 3, 8);
      else r -= intIn(rng, 3, 8);
    }
    structure.push({ floor: f, x: l, width: r - l });
    for (let x = l; x < r;) {
      const width = Math.min(r - x, intIn(rng, 3, 9));
      rooms.push({
        floor: f,
        x,
        width,
        color: f === 0 ? WINDOW.lobby : oneOf(rng, WINDOW_MIX),
        lit: f === 0 || rng() < 0.55,
      });
      x += width + 1;
    }
  }
  const mid = Math.floor(r / 2);
  return {
    structure,
    rooms,
    shafts: [
      { x: mid - 12, width: 4, bottom: 0, top: floors - 1 },
      { x: mid + 10, width: 4, bottom: 0, top: Math.floor(floors * 0.6) },
    ],
  };
}

/** Night Shift: the tower at night, windows switching on and off, a car
 *  gliding in each shaft, a moon crossing. The rooms paint once onto a layer
 *  canvas when the page can make one, and each frame copies it, so a frame
 *  costs the same for a big tower as for a small one. */
export function nightShift(
  w: number,
  h: number,
  tower: TowerSnapshot | null,
  rng: Rng = Math.random,
  makeLayer: () => CanvasRenderingContext2D | null = () => null,
): SaverScene {
  const t = tower && tower.rooms.length > 0 ? tower : madeUpTower(rng);
  const at = layout(t, w, h);
  const paneH = at.rowH > 1 ? at.rowH - 1 : 1;
  const panes: Pane[] = t.rooms.map((r) => ({
    x: at.px(r.x),
    y: at.py(r.floor),
    w: at.span(r.x, r.width),
    h: paneH,
    color: r.color,
    lit: r.lit,
  }));
  const lifts: Lift[] = t.shafts.map((s) => {
    const bottom = at.py(s.bottom);
    const top = at.py(s.top);
    return {
      x: at.px(s.x),
      w: Math.max(1, at.span(s.x, s.width)),
      bottom,
      top,
      pos: bottom,
      target: top + Math.floor(rng() * (bottom - top + 1)),
      wait: rng() * 2,
    };
  });
  const stars = Array.from({ length: Math.floor((w * h) / 90) }, () => ({
    x: intIn(rng, 0, w - 1),
    y: intIn(rng, 0, Math.floor(h * 0.75)),
    phase: rng() * 6.28,
    rate: 0.3 + rng() * 0.6,
  }));
  const layer = makeLayer();
  if (layer) {
    // A new canvas starts at 300 by 150; the layer is the scene's size.
    layer.canvas.width = w;
    layer.canvas.height = h;
  }
  const paint = (c: CanvasRenderingContext2D, p: Pane) => {
    c.fillStyle = p.lit ? p.color : NIGHT.darkRoom;
    c.fillRect(p.x, p.y, p.w, p.h);
  };
  const paintTower = (c: CanvasRenderingContext2D) => {
    c.clearRect(0, 0, w, h);
    c.fillStyle = NIGHT.slab;
    for (const r of t.structure) c.fillRect(at.px(r.x), at.py(r.floor), at.span(r.x, r.width), at.rowH);
    for (const p of panes) paint(c, p);
    c.fillStyle = NIGHT.shaft;
    for (const l of lifts) c.fillRect(l.x, l.top, l.w, l.bottom - l.top + at.rowH);
  };
  if (layer) paintTower(layer);
  // About one window in thirty switches each second, never a strobe.
  const switchesPerSecond = Math.max(1, Math.min(60, panes.length / 30));
  let time = 0;
  let owed = 0;
  // The sky's gradient is the same every frame: made on the first one.
  let sky: CanvasGradient | null = null;
  return {
    step(dt) {
      time += dt;
      owed += dt * switchesPerSecond;
      while (owed >= 1 && panes.length > 0) {
        owed -= 1;
        const p = panes[Math.floor(rng() * panes.length)];
        p.lit = !p.lit;
        if (layer) paint(layer, p);
      }
      for (const l of lifts) {
        if (l.wait > 0) {
          l.wait -= dt;
          continue;
        }
        const d = l.target - l.pos;
        const v = 6 * at.rowH * dt;
        if (Math.abs(d) <= v) {
          l.pos = l.target;
          l.wait = 0.6 + rng() * 1.6;
          l.target = l.top + Math.floor(rng() * (l.bottom - l.top + 1));
        } else l.pos += Math.sign(d) * v;
      }
    },
    draw(c) {
      if (!sky) {
        sky = c.createLinearGradient(0, 0, 0, h);
        sky.addColorStop(0, NIGHT.sky);
        sky.addColorStop(1, NIGHT.skyLow);
      }
      c.fillStyle = sky;
      c.fillRect(0, 0, w, h);
      c.fillStyle = NIGHT.star;
      for (const s of stars) {
        // A slow twinkle: well under three changes a second.
        c.globalAlpha = 0.45 + 0.4 * Math.sin(time * s.rate + s.phase);
        c.fillRect(s.x, s.y, 1, 1);
      }
      c.globalAlpha = 1;
      const mx = Math.floor(((time * 1.5) % (w + 20)) - 10);
      const my = Math.floor(h * 0.12);
      c.fillStyle = NIGHT.moon;
      c.fillRect(mx, my, 4, 4);
      c.fillRect(mx + 1, my - 1, 2, 6);
      c.fillRect(mx - 1, my + 1, 6, 2);
      c.fillStyle = NIGHT.ground;
      c.fillRect(0, at.ground, w, h - at.ground);
      if (layer) c.drawImage(layer.canvas, 0, 0);
      else paintTower(c);
      c.fillStyle = NIGHT.car;
      for (const l of lifts) c.fillRect(l.x, Math.round(l.pos), l.w, paneH);
    },
  };
}

/** Endless Tower: a crane lays rooms floor by floor, shafts climbing with the
 *  floors, until the tower reaches the top. It holds, fades, and starts a new
 *  one. Each room and slab paints once onto a layer canvas as it is laid,
 *  when the page can make one, and each frame copies the layer, so a frame
 *  costs the same however tall the tower has grown. */
export function endlessTower(
  w: number,
  h: number,
  rng: Rng = Math.random,
  makeLayer: () => CanvasRenderingContext2D | null = () => null,
): SaverScene {
  const rowH = 3;
  const ground = h - 3;
  type Room = { x: number; w: number; color: string };
  type Row = { y: number; l: number; r: number; rooms: Room[] };
  const layer = makeLayer();
  if (layer) {
    layer.canvas.width = w;
    layer.canvas.height = h;
  }
  const paintSlab = (c: CanvasRenderingContext2D, row: Row) => {
    c.fillStyle = NIGHT.slab;
    c.fillRect(row.l, row.y + rowH - 1, row.r - row.l, 1);
  };
  const paintRoom = (c: CanvasRenderingContext2D, row: Row, room: Room) => {
    c.fillStyle = room.color;
    c.fillRect(room.x, row.y, room.w, rowH - 1);
  };
  /** Start a floor: kept, and its slab painted onto the layer. */
  const addRow = (row: Row) => {
    rows.push(row);
    if (layer) paintSlab(layer, row);
  };
  let rows: Row[] = [];
  let shafts: number[] = [];
  let x = 0;
  let color: string = WINDOW.lobby;
  let hold = 0;
  let fade = 0;
  let owed = 0;
  const reset = () => {
    const base = Math.max(18, Math.floor((0.4 + rng() * 0.3) * w));
    const l = Math.floor(4 + rng() * Math.max(1, w - base - 8));
    rows = [];
    layer?.clearRect(0, 0, w, h);
    addRow({ y: ground - rowH, l, r: l + base, rooms: [] });
    const n = Math.max(1, Math.floor(base / 22));
    shafts = Array.from({ length: n }, (_, i) => l + Math.floor(((i + 1) * base) / (n + 1)));
    x = l;
    color = WINDOW.lobby;
    hold = 0;
    fade = 0;
    owed = 0;
  };
  reset();
  const top = () => rows[rows.length - 1];
  return {
    step(dt) {
      if (hold > 0) {
        hold -= dt;
        if (hold <= 0) fade = 1;
        return;
      }
      if (fade > 0) {
        fade -= dt * 0.8;
        if (fade <= 0) reset();
        return;
      }
      // Eighteen rooms a second.
      owed += dt * 18;
      while (owed >= 1 && hold <= 0) {
        owed -= 1;
        const row = top();
        if (x >= row.r) {
          const y = row.y - rowH;
          if (y < 6) {
            hold = 2.5;
            break;
          }
          let { l, r } = row;
          if (rows.length > 2 && rng() < 0.15 && r - l > 12) {
            if (rng() < 0.5) l += intIn(rng, 2, 4);
            else r -= intIn(rng, 2, 4);
          }
          addRow({ y, l, r, rooms: [] });
          x = l;
          color = oneOf(rng, WINDOW_MIX);
          continue;
        }
        const width = Math.min(row.r - x, intIn(rng, 2, 6));
        const room = { x, w: width, color: rng() < 0.7 ? color : oneOf(rng, WINDOW_MIX) };
        row.rooms.push(room);
        if (layer) paintRoom(layer, row, room);
        x += width + 1;
      }
    },
    draw(c) {
      c.fillStyle = NIGHT.sky;
      c.fillRect(0, 0, w, h);
      c.fillStyle = NIGHT.ground;
      c.fillRect(0, ground, w, h - ground);
      if (layer) c.drawImage(layer.canvas, 0, 0);
      else {
        for (const row of rows) {
          paintSlab(c, row);
          for (const room of row.rooms) paintRoom(c, row, room);
        }
      }
      const t = top();
      c.fillStyle = NIGHT.shaft;
      for (const sx of shafts) if (sx >= t.l && sx < t.r) c.fillRect(sx, t.y, 2, ground - t.y);
      if (hold <= 0 && fade <= 0) {
        // The crane: a mast on the top floor's middle, its jib, and the hook
        // line over the room being laid.
        const mast = t.l + Math.floor((t.r - t.l) / 2);
        const my = Math.max(1, t.y - 12);
        c.fillStyle = NIGHT.amber;
        c.fillRect(mast, my, 1, t.y - my);
        c.fillRect(mast - 10, my, 22, 1);
        c.fillStyle = NIGHT.star;
        c.fillRect(Math.max(mast - 10, Math.min(mast + 11, x)), my + 1, 1, Math.max(1, t.y - my - 3));
      }
      if (fade > 0) {
        c.globalAlpha = 1 - fade;
        c.fillStyle = "#000";
        c.fillRect(0, 0, w, h);
        c.globalAlpha = 1;
      }
    },
  };
}
