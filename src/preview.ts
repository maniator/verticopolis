import { FACILITIES } from "./engine/facilities";
import type { FacilityKind, Unit, UnitState } from "./engine/types";
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

const TILE = 12; // on-screen px per tile, matching the game scale feel
const COLS = 2;
const CELL_W = 440;
const CELL_H = 110;
const PAD = 14;

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
    const w = Math.min(CELL_W - 28, u.width * TILE);
    const h = 44;
    const rx = cx + (CELL_W - 8 - w) / 2;
    const ry = cy + 14;
    // Floor slab under the room for context.
    ctx.fillStyle = "#9a9483";
    ctx.fillRect(rx - 6, ry + h, w + 12, 4);
    drawRoom(d, u, rx, ry, w, h);

    ctx.fillStyle = "#cdd6e6";
    ctx.font = "12px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(e.label, cx + (CELL_W - 8) / 2, cy + CELL_H - 14);
    ctx.textAlign = "left";
  });
  requestAnimationFrame(frame);
}
frame();
(window as unknown as { previewReady: boolean }).previewReady = true;
