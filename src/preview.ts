import { FACILITIES } from "./engine/facilities";
import type { FacilityKind, Unit, UnitState } from "./engine/types";
import { fitAtGameScale } from "./render/catalogScale";
import { drawRoom, type RoomCtx } from "./render/pixelSprites";

interface Entry {
  label: string;
  kind: FacilityKind;
  state: UnitState;
  occ: number;
  hour: number;
}

const ENTRIES: Entry[] = [
  { label: "Office: busy", kind: "office", state: "occupied", occ: 6, hour: 11 },
  { label: "Office: vacant", kind: "office", state: "empty", occ: 0, hour: 11 },
  { label: "Condominium: evening", kind: "condo", state: "occupied", occ: 3, hour: 20 },
  { label: "Single Room: ready", kind: "hotelSingle", state: "empty", occ: 0, hour: 20 },
  { label: "Single Room: asleep", kind: "hotelSingle", state: "asleep", occ: 1, hour: 1 },
  { label: "Double Room: asleep", kind: "hotelDouble", state: "asleep", occ: 2, hour: 1 },
  { label: "Suite: ready", kind: "hotelSuite", state: "empty", occ: 0, hour: 20 },
  { label: "Hotel: needs cleaning", kind: "hotelDouble", state: "dirty", occ: 0, hour: 10 },
  { label: "Fast Food: lunch", kind: "fastFood", state: "occupied", occ: 5, hour: 12 },
  { label: "Restaurant: dinner", kind: "restaurant", state: "occupied", occ: 6, hour: 19 },
  { label: "Retail Shop: open", kind: "shop", state: "occupied", occ: 2, hour: 14 },
  { label: "Retail Shop: closed", kind: "shop", state: "occupied", occ: 0, hour: 23 },
  { label: "Cinema: showing", kind: "cinema", state: "occupied", occ: 0, hour: 20 },
];

function makeUnit(e: Entry): Unit {
  return {
    id: e.label.length * 13 + e.kind.length,
    kind: e.kind,
    floor: 5,
    x: 0,
    width: FACILITIES[e.kind].width,
    state: e.state,
    satisfaction: 1,
    occupants: e.occ,
    everOccupied: true,
    pendingIncome: 0,
    label: "",
  };
}

const COLS = 2;
const CELL_W = 440;
const CELL_H = 110;
const PAD = 14;
// Rooms draw at the world's own scale, so the page shows what the game shows and
// any two cells can be compared by eye. A whole multiple of it would be legible
// but does not fit this row: a cell has to hold the room, the slab under it, and
// the caption inside CELL_H, and even 2x is taller than the whole cell.
const MAG = 1;
/** Where the room box starts inside its cell, and what has to clear underneath
 *  it: the floor slab, then the caption band. Together these are the room's
 *  height budget, so a room too tall for them shrinks instead of overprinting
 *  its own label. */
const ROOM_TOP = 14;
const SLAB_H = 4;
const CAPTION_H = 24;

const canvas = document.getElementById("preview") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
const rows = Math.ceil(ENTRIES.length / COLS);
const dpr = Math.min(2, window.devicePixelRatio || 1);
canvas.style.width = `${COLS * CELL_W + PAD * 2}px`;
canvas.style.height = `${rows * CELL_H + PAD * 2}px`;
canvas.width = (COLS * CELL_W + PAD * 2) * dpr;
canvas.height = (rows * CELL_H + PAD * 2) * dpr;
ctx.scale(dpr, dpr);
ctx.imageSmoothingEnabled = false;

function frame() {
  const anim = performance.now() / 1000;
  ctx.fillStyle = "#12151d";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ENTRIES.forEach((e, i) => {
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    const cx = PAD + col * CELL_W;
    const cy = PAD + row * CELL_H;
    ctx.fillStyle = "#1a1f2b";
    ctx.fillRect(cx, cy, CELL_W - 8, CELL_H - 8);
    ctx.strokeStyle = "#2c3344";
    ctx.strokeRect(cx + 0.5, cy + 0.5, CELL_W - 9, CELL_H - 9);

    const u = makeUnit(e);
    const lit = e.hour >= 17 || e.hour < 6;
    const d: RoomCtx = { ctx, lit, anim, hour: e.hour };
    // Size by the facility's own footprint, its floor count included: a cinema
    // is two floors tall, and drawing it one floor tall squashed art the game
    // never squashes.
    const { w, h } = fitAtGameScale(u.width, FACILITIES[e.kind].floors ?? 1, CELL_W - 28, CELL_H - ROOM_TOP - SLAB_H - CAPTION_H, MAG);
    const rx = cx + (CELL_W - 8 - w) / 2;
    const ry = cy + ROOM_TOP;
    // Floor slab under the room for context.
    ctx.fillStyle = "#9a9483";
    ctx.fillRect(rx - 6, ry + h, w + 12, SLAB_H);
    drawRoom(d, u, rx, ry, w, h);

    ctx.fillStyle = "#cdd6e6";
    ctx.font = "12px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(e.label, cx + (CELL_W - 8) / 2, cy + CELL_H - CAPTION_H + 10);
    ctx.textAlign = "left";
  });
  requestAnimationFrame(frame);
}
frame();
(window as unknown as { previewReady: boolean }).previewReady = true;
