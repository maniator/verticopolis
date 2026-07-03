import { FACILITIES, GRID } from "./engine/facilities";
import type { FacilityKind, Transport, Unit, UnitState } from "./engine/types";
import { drawTransport, drawUnit, type DrawCtx } from "./render/sprites";

void GRID;

/** A catalog entry to render in the gallery grid. */
interface Entry {
  label: string;
  draw(d: DrawCtx, cx: number, cy: number, cw: number, ch: number): void;
}

function makeUnit(kind: FacilityKind, state: UnitState, occupants: number, id = 1): Unit {
  const f = FACILITIES[kind];
  return {
    id,
    kind,
    // Lobbies style by floor (1 = the grand ground concourse, else the sky-
    // lobby look); show the ground lobby, the one the starter tower builds.
    floor: kind === "lobby" ? 1 : 5,
    x: 0,
    width: f.width,
    state,
    satisfaction: 1,
    occupants,
    everOccupied: true,
    pendingIncome: 0,
    label: f.name,
  };
}

function roomEntry(label: string, kind: FacilityKind, state: UnitState = "occupied", occ?: number): Entry {
  const f = FACILITIES[kind];
  return {
    label,
    draw(d, cx, cy, cw, ch) {
      const tile = Math.min(9 * 2.0, (cw - 16) / f.width);
      const w = f.width * tile;
      const h = Math.min(ch - 26, 26 * (tile / 9));
      const x = cx + (cw - w) / 2;
      const y = cy + (ch - 26 - h) / 2 + 4;
      // Floor strip for context.
      const floorU = makeUnit("floor", "occupied", 0, 999);
      drawUnit(d, floorU, x - 6, y, w + 12, h);
      drawUnit(d, makeUnit(kind, state, occ ?? (state === "occupied" ? f.population : 0)), x, y, w, h);
    },
  };
}

function transportEntry(label: string, kind: FacilityKind, span = 3): Entry {
  const f = FACILITIES[kind];
  return {
    label,
    draw(d, cx, cy, cw, ch) {
      const floorH = Math.min(26 * 1.1, (ch - 26) / (span + 1));
      const w = f.width * (floorH / 26) * 9 * 1.0;
      const cars = kind.startsWith("elevator") ? 2 : 0;
      const t: Transport = {
        id: 1,
        kind,
        x: 0,
        width: f.width,
        bottom: 1,
        top: 1 + span,
        cars,
        carPositions: cars ? [1.4, 1 + span - 0.6] : [],
        carDir: cars ? [1, -1] : [],
        load: 1,
      };
      const x = cx + (cw - w) / 2;
      const topY = cy + (ch - 26 - floorH * (span + 1)) / 2 + 4;
      // Backing floors so the shaft reads in context.
      for (let i = 0; i <= span; i++) {
        drawUnit(d, makeUnit("floor", "occupied", 0, 500 + i), x - 8, topY + i * floorH, w + 16, floorH);
      }
      drawTransport(d.ctx, t, x, topY, w, floorH);
    },
  };
}

const ENTRIES: Entry[] = [
  roomEntry("Lobby", "lobby"),
  roomEntry("Floor / Corridor", "floor"),
  roomEntry("Office (occupied)", "office"),
  roomEntry("Office (vacant)", "office", "empty", 0),
  roomEntry("Condominium", "condo"),
  roomEntry("Single Room", "hotelSingle", "asleep"),
  roomEntry("Double Room (guest asleep)", "hotelDouble", "asleep"),
  roomEntry("Suite (ready)", "hotelSuite", "empty", 0),
  roomEntry("Hotel Room (needs cleaning)", "hotelDouble", "dirty", 0),
  roomEntry("Fast Food", "fastFood"),
  roomEntry("Restaurant", "restaurant"),
  roomEntry("Retail Shop", "shop"),
  roomEntry("Cinema (playing)", "cinema"),
  roomEntry("Party Hall", "partyHall"),
  roomEntry("Parking (in use)", "parking"),
  roomEntry("Parking Ramp", "parkingRamp"),
  roomEntry("Security", "security"),
  roomEntry("Medical Center", "medical"),
  roomEntry("Housekeeping", "housekeeping"),
  roomEntry("Recycling Center", "recycling"),
  roomEntry("Metro Station (train)", "metro"),
  roomEntry("Wedding Hall", "weddingHall"),
  transportEntry("Stairway", "stairs", 1),
  transportEntry("Escalator", "escalator", 1),
  transportEntry("Standard Elevator", "elevatorStandard", 3),
  transportEntry("Service Elevator", "elevatorService", 3),
  transportEntry("Express Elevator", "elevatorExpress", 3),
];

const COLS = 3;
const CELL_W = 300;
const CELL_H = 130;
const PAD = 12;

const canvas = document.getElementById("gallery") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
const rows = Math.ceil(ENTRIES.length / COLS);
const dpr = Math.min(2, window.devicePixelRatio || 1);
canvas.style.width = `${COLS * CELL_W + PAD * 2}px`;
canvas.style.height = `${rows * CELL_H + PAD * 2}px`;
canvas.width = (COLS * CELL_W + PAD * 2) * dpr;
canvas.height = (rows * CELL_H + PAD * 2) * dpr;
ctx.scale(dpr, dpr);

function frame() {
  const anim = performance.now() / 1000;
  // Mid-load garage and a two-thirds-full recycling plant, so the live-state
  // art (cars in bays, the garbage pile + gauge) actually shows in the catalog.
  const d: DrawCtx = { ctx, lit: true, anim, hour: 19, parkingUse: 0.7, recycleFill: 0.66 };
  ctx.fillStyle = "#12151d";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ENTRIES.forEach((e, i) => {
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    const cx = PAD + col * CELL_W;
    const cy = PAD + row * CELL_H;
    // Cell background.
    ctx.fillStyle = "#1a1f2b";
    ctx.fillRect(cx, cy, CELL_W - 8, CELL_H - 8);
    ctx.strokeStyle = "#2c3344";
    ctx.strokeRect(cx + 0.5, cy + 0.5, CELL_W - 9, CELL_H - 9);
    // Sprite.
    e.draw(d, cx, cy, CELL_W - 8, CELL_H - 8);
    // Label.
    ctx.fillStyle = "#cdd6e6";
    ctx.font = "12px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(e.label, cx + (CELL_W - 8) / 2, cy + CELL_H - 16);
  });
  ctx.textAlign = "left";
  requestAnimationFrame(frame);
}
frame();

// Signal readiness for screenshot tooling.
(window as unknown as { galleryReady: boolean }).galleryReady = true;
