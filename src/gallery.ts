import { html, render } from "lit-html";
import { FACILITIES, GRID } from "./engine/facilities";
import { FASTFOOD_SUBTYPES, FOODHALL_SUBTYPES, RESTAURANT_SUBTYPES, SHOP_SUBTYPES } from "./engine/retailSubtypes";
import type { FacilityKind, Transport, Unit, UnitState } from "./engine/types";
import { drawCar, drawTransport, drawUnit, type DrawCtx } from "./render/sprites";
import { pageShell } from "./ui/templates/pageShell";
import { injectVercelTelemetry } from "./telemetry";

void GRID;

/** A catalog entry to render in the gallery grid. */
interface Entry {
  label: string;
  draw(d: DrawCtx, cx: number, cy: number, cw: number, ch: number): void;
}

function makeUnit(kind: FacilityKind, state: UnitState, occupants: number, id = 1, subtype?: string, floorOverride?: number): Unit {
  const f = FACILITIES[kind];
  return {
    id,
    kind,
    // Lobbies style by floor (1 = the grand ground concourse, else the sky-
    // lobby look). Default to the ground lobby, the one the starter tower
    // builds; `floorOverride` lets the catalog show the sky-lobby variant too.
    floor: floorOverride ?? (kind === "lobby" ? 1 : 5),
    x: 0,
    width: f.width,
    state,
    satisfaction: 1,
    occupants,
    everOccupied: true,
    pendingIncome: 0,
    label: f.name,
    subtype,
  };
}

function roomEntry(
  label: string,
  kind: FacilityKind,
  state: UnitState = "occupied",
  occ?: number,
  subtype?: string,
  floorOverride?: number,
): Entry {
  const f = FACILITIES[kind];
  return {
    label,
    draw(d, cx, cy, cw, ch) {
      // Size the cell by the facility's own floor count so a genuinely multi-
      // floor kind (cinema, party hall, metro) shows at its true proportion
      // instead of squished into one floor. Scale the width down to preserve
      // aspect if the full height would overflow the cell.
      const floors = f.floors ?? 1;
      const tile = Math.min(9 * 2.0, (cw - 16) / f.width);
      let w = f.width * tile;
      let h = 26 * (tile / 9) * floors;
      const maxH = ch - 26;
      if (h > maxH) {
        w *= maxH / h;
        h = maxH;
      }
      const x = cx + (cw - w) / 2;
      const y = cy + (ch - 26 - h) / 2 + 4;
      // Floor strip for context.
      const floorU = makeUnit("floor", "occupied", 0, 999);
      drawUnit(d, floorU, x - 6, y, w + 12, h);
      drawUnit(d, makeUnit(kind, state, occ ?? (state === "occupied" ? f.population : 0), 1, subtype, floorOverride), x, y, w, h);
    },
  };
}

/** One gallery cell per canon retail variant, labeled with its canon name so
 *  the catalog teaches the vocabulary the inspector and TDT round-trip use. */
function retailEntries(kind: FacilityKind, names: readonly string[]): Entry[] {
  return names.map((name) => roomEntry(`${FACILITIES[kind].name}: ${name}`, kind, "occupied", undefined, name));
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
      // Elevator entries also show their cars so the per-kind cab dressing
      // (standard / service / express) is visible in the catalog.
      for (let i = 0; i < cars; i++) {
        d.ctx.save();
        // Integer translate so the cab's 1px dressing rows (hazard stripes,
        // livery pinstripe) land on whole pixels instead of antialiasing.
        d.ctx.translate(Math.round(x), Math.round(topY + (t.top - t.carPositions[i]) * floorH));
        drawCar(d.ctx, i * 7 + 1, w, floorH, i === 0 ? 2 : 0, i === 0 ? "up" : "down", false, kind);
        d.ctx.restore();
      }
    },
  };
}

const ENTRIES: Entry[] = [
  roomEntry("Lobby (ground)", "lobby"),
  roomEntry("Sky Lobby", "lobby", "occupied", undefined, undefined, 5),
  roomEntry("Floor / Corridor", "floor"),
  roomEntry("Office (occupied)", "office"),
  roomEntry("Office (vacant)", "office", "empty", 0),
  roomEntry("Condominium", "condo"),
  roomEntry("Single Room", "hotelSingle", "asleep"),
  roomEntry("Double Room (guest asleep)", "hotelDouble", "asleep"),
  roomEntry("Suite (ready)", "hotelSuite", "empty", 0),
  roomEntry("Single Room (needs cleaning)", "hotelSingle", "dirty", 0),
  roomEntry("Double Room (needs cleaning)", "hotelDouble", "dirty", 0),
  roomEntry("Suite (needs cleaning)", "hotelSuite", "dirty", 0),
  roomEntry("Single Room (cockroaches)", "hotelSingle", "infested", 0),
  roomEntry("Double Room (cockroaches)", "hotelDouble", "infested", 0),
  roomEntry("Suite (cockroaches)", "hotelSuite", "infested", 0),
  roomEntry("Fast Food (generic)", "fastFood"),
  ...retailEntries("fastFood", FASTFOOD_SUBTYPES),
  roomEntry("Restaurant (generic)", "restaurant"),
  ...retailEntries("restaurant", RESTAURANT_SUBTYPES),
  roomEntry("Retail Shop (generic)", "shop"),
  ...retailEntries("shop", SHOP_SUBTYPES),
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
// Tall enough that even the tallest kind renders at its TRUE proportion, never
// shrunk to fit: a three-floor metro at full tile is 26 * 2 * 3 = 156px, and the
// sprite box is `CELL_H - 8 - 26`, so this clears it (200 - 34 = 166 >= 156). The
// two-floor kinds (cinema, party hall) and every single-floor room sit inside the
// same box with headroom, so no cell is vertically compressed next to another.
const CELL_H = 200;
const PAD = 12;
const HEADER_H = 48;

/** Modern-only additions, shown in their own titled section AFTER the full 1994
 *  catalog, so the canon-vs-Modern line the game is careful about stays clear in
 *  the gallery too. The other containers (Boutique, Fitness, Clinic, Amusements)
 *  will fall in here as they land. */
const MODERN_ENTRIES: Entry[] = [
  roomEntry("Food Hall", "foodHall"),
  ...retailEntries("foodHall", FOODHALL_SUBTYPES),
];

/** A full-width section title drawn across the grid between groups. */
interface SectionHeader {
  header: string;
}
type GalleryItem = Entry | SectionHeader;
const ITEMS: GalleryItem[] = [...ENTRIES, { header: "Modern additions" }, ...MODERN_ENTRIES];

/** Assign each item a screen cell. A header closes the current row, spans the
 *  full width in its own shorter band, and forces the next item onto a fresh
 *  row. Returns the placements and the total canvas height. */
function layoutItems(items: GalleryItem[]): { placed: Array<{ item: GalleryItem; x: number; y: number }>; height: number } {
  const placed: Array<{ item: GalleryItem; x: number; y: number }> = [];
  let col = 0;
  let y = PAD;
  for (const item of items) {
    if ("header" in item) {
      if (col > 0) {
        y += CELL_H; // finish the open cell row
        col = 0;
      }
      placed.push({ item, x: PAD, y });
      y += HEADER_H;
    } else {
      placed.push({ item, x: PAD + col * CELL_W, y });
      col++;
      if (col >= COLS) {
        y += CELL_H;
        col = 0;
      }
    }
  }
  if (col > 0) y += CELL_H; // close a trailing partial row
  return { placed, height: y + PAD };
}

// Render the shared retro page shell (title bar, Back to game, sibling nav) and
// report the same host-gated telemetry the game and /help report, then draw the
// catalog into the shell's canvas.
injectVercelTelemetry();
render(
  pageShell({
    title: "Verticopolis: Sprite Gallery",
    backHref: "/",
    main: html`
      <div class="page-lede">
        <h1>Sprite Gallery</h1>
        <p class="sub">
          Every facility, transport, and special state, drawn procedurally at game scale (evening lighting). Animated:
          elevators, cinema, metro.
        </p>
      </div>
      <div class="gallery-scroll"><canvas id="gallery"></canvas></div>
    `,
    links: [{ href: "/help", label: "Help" }],
  }),
  document.getElementById("app")!,
);

const canvas = document.getElementById("gallery") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
const { placed, height: canvasH } = layoutItems(ITEMS);
const dpr = Math.min(2, window.devicePixelRatio || 1);
canvas.style.width = `${COLS * CELL_W + PAD * 2}px`;
canvas.style.height = `${canvasH}px`;
canvas.width = (COLS * CELL_W + PAD * 2) * dpr;
canvas.height = canvasH * dpr;
ctx.scale(dpr, dpr);

function frame() {
  const anim = performance.now() / 1000;
  // Mid-load garage and a two-thirds-full recycling plant, so the live-state
  // art (cars in bays, the garbage pile + gauge) actually shows in the catalog.
  const d: DrawCtx = { ctx, lit: true, anim, hour: 19, parkingUse: 0.7, recycleFill: 0.66 };
  ctx.fillStyle = "#12151d";
  // ctx is scaled by dpr, so fill in LOGICAL (CSS) pixels, not the device-pixel
  // canvas.width/height (which would overdraw by dpr^2 every frame).
  ctx.fillRect(0, 0, COLS * CELL_W + PAD * 2, canvasH);
  placed.forEach(({ item, x: cx, y: cy }) => {
    if ("header" in item) {
      // Full-width section divider: a title with a rule under it.
      ctx.fillStyle = "#e0965a";
      ctx.font = "bold 18px system-ui, sans-serif";
      ctx.textAlign = "left";
      ctx.fillText(item.header, cx + 2, cy + HEADER_H - 18);
      ctx.strokeStyle = "#3a4456";
      ctx.beginPath();
      ctx.moveTo(cx, cy + HEADER_H - 6.5);
      ctx.lineTo(cx + COLS * CELL_W - 8, cy + HEADER_H - 6.5);
      ctx.stroke();
      return;
    }
    // Cell background.
    ctx.fillStyle = "#1a1f2b";
    ctx.fillRect(cx, cy, CELL_W - 8, CELL_H - 8);
    ctx.strokeStyle = "#2c3344";
    ctx.strokeRect(cx + 0.5, cy + 0.5, CELL_W - 9, CELL_H - 9);
    // Sprite.
    item.draw(d, cx, cy, CELL_W - 8, CELL_H - 8);
    // Label.
    ctx.fillStyle = "#cdd6e6";
    ctx.font = "12px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(item.label, cx + (CELL_W - 8) / 2, cy + CELL_H - 16);
  });
  ctx.textAlign = "left";
  requestAnimationFrame(frame);
}
frame();

// Signal readiness for screenshot tooling.
(window as unknown as { galleryReady: boolean }).galleryReady = true;
