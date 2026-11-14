import { html, render } from "lit-html";
import type { Catalog, CatalogFacility } from "./catalog/catalogTypes";
import type { FacilityKind, UnitState } from "./shared/types";
import type { DrawCtx } from "./render/sprites";
import { drawRoomPortrait, drawTransportPortrait } from "./render/roomPortrait";
import { pageShell } from "./ui/templates/pageShell";
import { takeFromGameFlag } from "./ui/fromGame";
import { injectVercelTelemetry } from "./telemetry";
import { trackAppAction } from "./analytics";
import { bindViewWorld } from "./presentation/viewWorld";
import { bindViewKinds } from "./presentation/viewKinds";
import { readCatalog } from "./engineBinding/catalog";
import { loadWasmEngine } from "./wasmhost/rustEngine";

/** The Rust engine's Modern catalog, read before the page draws. The engine is
 *  the one the game runs on, so every size, name and variant list on this page
 *  is its own. */
let catalog: Catalog | null = null;

/** A kind's catalog entry: its name, size, population and canon variants. */
function facilityOf(kind: FacilityKind): CatalogFacility {
  const f = catalog?.facilities.find((e) => e.key === kind);
  if (!f) throw new Error(`Sprite gallery: the engine's catalog has no ${kind}.`);
  return f;
}

/** A catalog entry to render in the gallery grid. */
interface Entry {
  label: string;
  draw(d: DrawCtx, cx: number, cy: number, cw: number, ch: number): void;
}

/** How much larger than the world a cell may draw. Sprites at world scale are
 *  too small to judge in a catalog cell, so the page magnifies, and a whole
 *  multiple is the only magnification that keeps every world pixel a whole
 *  block of screen pixels. Three is the most a single-floor room gets: 3 * FLOOR
 *  is 135px, inside the 186px box `CELL_H` leaves, where 4x (180px) would
 *  crowd it. A footprint that cannot take 3x in its cell steps down to 2x or
 *  1x (`fitAtGameScale`), so wide rooms and multi-floor kinds draw smaller. */
const MAG = 3;

/** Height reserved at the bottom of every cell for its caption. Rooms are fitted
 *  into what is left, so a tall footprint shrinks rather than printing over its
 *  own label. */
const CAPTION_H = 26;

function roomEntry(
  label: string,
  kind: FacilityKind,
  state: UnitState = "occupied",
  occ?: number,
  subtype?: string,
  floorOverride?: number,
): Entry {
  facilityOf(kind);
  return {
    label,
    draw: (d, cx, cy, cw, ch) => drawRoomPortrait(d, facilityOf, kind, { state, occupants: occ, subtype, floor: floorOverride }, cx, cy, cw, ch, CAPTION_H, MAG),
  };
}

/** One gallery cell per canon retail variant, labeled with its canon name so
 *  the catalog teaches the vocabulary the inspector and TDT round-trip use. */
function retailEntries(kind: FacilityKind): Entry[] {
  return (facilityOf(kind).subtypes ?? []).map((name) => roomEntry(`${facilityOf(kind).name}: ${name}`, kind, "occupied", undefined, name));
}

function transportEntry(label: string, kind: FacilityKind, span = 3): Entry {
  facilityOf(kind);
  return {
    label,
    draw: (d, cx, cy, cw, ch) => drawTransportPortrait(d, facilityOf, kind, span, cx, cy, cw, ch, CAPTION_H, MAG),
  };
}

/** The 1994 catalog, built once the engine's catalog is read. */
const buildEntries = (): Entry[] => [
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
  ...retailEntries("fastFood"),
  roomEntry("Restaurant (generic)", "restaurant"),
  ...retailEntries("restaurant"),
  roomEntry("Retail Shop (generic)", "shop"),
  ...retailEntries("shop"),
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

// Responsive grid: `COLS` and `CELL_W` are recomputed from the available width
// in `relayout()` so the gallery fits the viewport and scrolls DOWN, never
// sideways on a phone (3 columns wide, 2 on a tablet, 1 on a phone).
let COLS = 3;
let CELL_W = 300;
// The sprite box is `CELL_H - 8 - CAPTION_H`, so 220 leaves 186. That holds the
// tallest subject at the world scale or better: an elevator cell is its three
// floors of travel plus the landing, 4 * FLOOR = 180px at 1x. A single-floor
// room takes 3x (135px), a two-floor room 2x (180px), the metro 1x (135px).
// What still cannot fit at 1x is a footprint wider than the cell's 276px room
// width (the 28-tile aquatic center, the 31-tile cinema, and most rooms on a
// narrow phone), which shrinks by a fraction and draws with soft edges.
const CELL_H = 220;
const PAD = 12;
const HEADER_H = 48;
const SUBHEADER_H = 34;

/** Modern-only additions, shown in their own titled section AFTER the full 1994
 *  catalog so the canon-vs-Modern line stays clear. Each Modern kind is its own
 *  labeled sub-group, so the zone reads as a catalog (not one undifferentiated
 *  block) as the other containers (Boutique, Fitness, Clinic, Amusements) land. */
const buildModernGroups = (): { label: string; entries: Entry[] }[] => [
  {
    label: "Rental Living",
    entries: [roomEntry("Studio", "rentalStudio"), roomEntry("Apartment", "rentalApartment")],
  },
  {
    label: "Food Hall",
    entries: [roomEntry("Food Hall", "foodHall"), ...retailEntries("foodHall")],
  },
  {
    label: "Amusements",
    entries: [roomEntry("Amusements", "amusements"), ...retailEntries("amusements")],
  },
  {
    label: "Boutique Bay",
    entries: [roomEntry("Boutique Bay", "boutiqueBay"), ...retailEntries("boutiqueBay")],
  },
  {
    label: "Fitness Club",
    entries: [roomEntry("Fitness Club", "fitnessClub"), ...retailEntries("fitnessClub")],
  },
  {
    label: "Clinic",
    entries: [roomEntry("Clinic", "clinic"), ...retailEntries("clinic")],
  },
  {
    label: "Nightclub",
    entries: [roomEntry("Nightclub", "nightclub")],
  },
  {
    label: "Spa",
    entries: [roomEntry("Spa", "spa")],
  },
  {
    label: "Sky Bar",
    entries: [roomEntry("Sky Bar", "skyBar")],
  },
  {
    label: "Aquatic Center",
    entries: [roomEntry("Aquatic Center", "aquaticCenter")],
  },
  {
    label: "Daycare",
    entries: [roomEntry("Daycare", "daycare")],
  },
];

/** A full-width section title (`header`) or a lighter per-kind label
 *  (`subHeader`) drawn across the grid between groups. */
interface SectionHeader {
  header: string;
}
interface SubHeader {
  subHeader: string;
}
type GalleryItem = Entry | SectionHeader | SubHeader;
const buildItems = (): GalleryItem[] => [
  ...buildEntries(),
  { header: "Modern additions" },
  ...buildModernGroups().flatMap((g): GalleryItem[] => [{ subHeader: g.label }, ...g.entries]),
];
let ITEMS: GalleryItem[] = [];

/** Assign each item a screen cell. A header closes the current row, spans the
 *  full width in its own shorter band, and forces the next item onto a fresh
 *  row. Returns the placements and the total canvas height. */
function layoutItems(items: GalleryItem[]): { placed: Array<{ item: GalleryItem; x: number; y: number }>; height: number } {
  const placed: Array<{ item: GalleryItem; x: number; y: number }> = [];
  let col = 0;
  let y = PAD;
  for (const item of items) {
    if ("header" in item || "subHeader" in item) {
      if (col > 0) {
        y += CELL_H; // finish the open cell row
        col = 0;
      }
      placed.push({ item, x: PAD, y });
      y += "header" in item ? HEADER_H : SUBHEADER_H;
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
trackAppAction("page_gallery"); // landing on the standalone /gallery page (host-gated inside)
render(
  pageShell({
    title: "Verticopolis™: Sprite Gallery",
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
    links: [
      { href: "/help", label: "Help" },
      { href: "/help/changelog", label: "Release notes" },
    ],
    fromGame: takeFromGameFlag(location, history),
  }),
  document.getElementById("app")!,
);

const canvas = document.getElementById("gallery") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
let dpr = Math.min(2, window.devicePixelRatio || 1);

// Recompute the grid to fit the current width, relaid on resize. The cell
// shrinks to fill the row but never upscales past its design width, so a wide
// monitor keeps the 3-column catalog centered rather than stretching it.
let placed: { item: GalleryItem; x: number; y: number }[] = [];
let canvasH = 0;
function relayout(): void {
  // Recompute the device-pixel-ratio too: dragging to another monitor or an OS
  // zoom fires resize, and a stale dpr would blur the backing store.
  dpr = Math.min(2, window.devicePixelRatio || 1);
  // No lower clamp on the width: the canvas must never exceed its container, or
  // the sideways scroll this whole function exists to kill would come back on a
  // very narrow screen. The sprites scale to whatever cell width results.
  const avail = Math.max(1, (canvas.parentElement?.clientWidth ?? window.innerWidth) - PAD * 2);
  if (avail >= 860) COLS = 3;
  else if (avail >= 560) COLS = 2;
  else COLS = 1;
  CELL_W = Math.min(300, Math.floor(avail / COLS));
  const laid = layoutItems(ITEMS);
  placed = laid.placed;
  canvasH = laid.height;
  const cssW = COLS * CELL_W + PAD * 2;
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${canvasH}px`;
  canvas.width = cssW * dpr;
  canvas.height = canvasH * dpr;
  // Resizing the backing store clears the context transform, so re-apply the dpr scale.
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
let resizePending = 0;
window.addEventListener("resize", () => {
  if (resizePending) return;
  resizePending = requestAnimationFrame(() => {
    resizePending = 0;
    relayout();
  });
});

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
    if ("subHeader" in item) {
      // A lighter per-kind label within the Modern section.
      ctx.fillStyle = "#cdd6e6";
      ctx.font = "600 14px system-ui, sans-serif";
      ctx.textAlign = "left";
      ctx.fillText(item.subHeader, cx + 4, cy + SUBHEADER_H - 12);
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

/** Read the engine's catalog, then draw. A package that cannot be loaded leaves
 *  the page saying so and never signals readiness: there is no second source
 *  for the sizes. */
async function start(): Promise<void> {
  try {
    catalog = readCatalog(await loadWasmEngine(), "modern");
    // A tooling page draws sprites without a tower, so it binds the catalog's
    // world for the view (the lot geometry the sprites hash on).
    bindViewWorld(catalog.world);
    bindViewKinds(catalog);
    ITEMS = buildItems();
  } catch (e) {
    console.error("Sprite gallery: the Rust engine's catalog is unavailable.", e);
    document.querySelector(".gallery-scroll")?.replaceChildren("The sprite gallery needs the game engine, and it did not load. Reload the page to try again.");
    return;
  }
  relayout();
  frame();
  // Signal readiness for screenshot tooling.
  (window as unknown as { galleryReady: boolean }).galleryReady = true;
}
void start();
