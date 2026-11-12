// Draws every room picture on a help page with the game's own painters
// (src/render/roomPortrait.ts, the code the sprite gallery used), so a room
// looks here exactly as it does in a tower. Each picture is a
// <canvas data-sprite> that src/components/Sprite.astro writes; the catalog
// comes from /help/catalog.json (src/pages/catalog.json.ts).
import type { Catalog, CatalogFacility } from "../../../src/catalog/catalogTypes";
import { bindViewKinds } from "../../../src/presentation/viewKinds";
import { bindViewWorld } from "../../../src/presentation/viewWorld";
import { drawRoomPortrait, drawTransportPortrait } from "../../../src/render/roomPortrait";
import type { DrawCtx } from "../../../src/render/sprites";
import type { FacilityKind, UnitState } from "../../../src/shared/types";

/** The most a picture magnifies the world: three whole game pixels per CSS
 *  pixel, as the gallery did, stepping down for a room too big for its box. */
const MAG = 3;
const BACKGROUND = "#12151d";

interface Picture {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  /** Paints into a w by h box of device pixels, magnifying at most `mag`. */
  draw(d: DrawCtx, w: number, h: number, mag: number): void;
  /** The hour the picture shows. */
  hour: number;
  visible: boolean;
}

/** Evening is when every room has something going on, so each picture shows
 *  7 PM, or the first hour after it that the room is open (a nightclub opens
 *  at 8), so no room is drawn behind its shutter. */
const EVENING = 19;
function openHourFor(open: readonly boolean[] | null | undefined): number {
  if (!open) return EVENING;
  for (let i = 0; i < 24; i++) {
    const hour = (EVENING + i) % 24;
    if (open[hour]) return hour;
  }
  return EVENING;
}

function pictureOf(canvas: HTMLCanvasElement, facts: (k: FacilityKind) => CatalogFacility): Picture | null {
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const kind = canvas.dataset.sprite as FacilityKind;
  // A floor or lobby is drawn as a run of `data-tiles` tiles (Sprite.astro).
  const tiles = canvas.dataset.tiles ? Number(canvas.dataset.tiles) : null;
  const factsOf = tiles ? (k: FacilityKind): CatalogFacility => (k === kind ? { ...facts(k), width: tiles } : facts(k)) : facts;
  const hour = openHourFor(facts(kind).openHours);
  const span = canvas.dataset.span ? Number(canvas.dataset.span) : null;
  const pose = {
    state: (canvas.dataset.state as UnitState | undefined) ?? "occupied",
    occupants: canvas.dataset.occupants ? Number(canvas.dataset.occupants) : undefined,
    subtype: canvas.dataset.subtype,
    floor: canvas.dataset.floor ? Number(canvas.dataset.floor) : undefined,
  };
  const draw =
    span !== null
      ? (d: DrawCtx, w: number, h: number, mag: number) => drawTransportPortrait(d, factsOf, kind, span, 0, 0, w, h, 0, mag)
      : (d: DrawCtx, w: number, h: number, mag: number) => drawRoomPortrait(d, factsOf, kind, pose, 0, 0, w, h, 0, mag);
  return { canvas, ctx, draw, hour, visible: false };
}

function paint(p: Picture, anim: number): void {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.round(p.canvas.clientWidth * dpr);
  const h = Math.round(p.canvas.clientHeight * dpr);
  if (w < 1 || h < 1) return;
  if (p.canvas.width !== w || p.canvas.height !== h) {
    p.canvas.width = w;
    p.canvas.height = h;
  }
  // The painters magnify by whole steps, so they work in device pixels here:
  // on a sharp screen a wide room that would drop to one game pixel per CSS
  // pixel can still take three device pixels (1.5 CSS pixels), and fill its
  // box instead of sitting small in the middle of it.
  p.ctx.setTransform(1, 0, 0, 1, 0, 0);
  p.ctx.fillStyle = BACKGROUND;
  p.ctx.fillRect(0, 0, w, h);
  // Lights on, a garage two-thirds full and a recycling plant filling up, at
  // an hour the room is open.
  p.draw({ ctx: p.ctx, lit: true, anim, hour: p.hour, parkingUse: 0.7, recycleFill: 0.66 }, w, h, Math.round(MAG * dpr));
}

async function start(): Promise<void> {
  const canvases = [...document.querySelectorAll<HTMLCanvasElement>("canvas[data-sprite]")];
  if (canvases.length === 0) return;
  let catalog: Catalog;
  try {
    const res = await fetch(canvases[0].dataset.catalog ?? "/help/catalog.json");
    catalog = (await res.json()) as Catalog;
    bindViewWorld(catalog.world);
    bindViewKinds(catalog);
  } catch (e) {
    console.error("Help: the room pictures could not read the catalog.", e);
    return;
  }
  const byKind = new Map(catalog.facilities.map((f) => [f.key, f]));
  const facts = (k: FacilityKind): CatalogFacility => {
    const f = byKind.get(k);
    if (!f) throw new Error(`the catalog lists no ${k}`);
    return f;
  };
  const pictures: Picture[] = [];
  for (const c of canvases) {
    try {
      const p = pictureOf(c, facts);
      if (p) pictures.push(p);
    } catch (e) {
      console.error("Help: a room picture could not be drawn.", e);
    }
  }
  const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  for (const p of pictures) paint(p, 0);
  if (still) return;
  // Animate only the pictures on screen, so a long page costs nothing for the
  // rooms scrolled out of view.
  const seen = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const p = pictures.find((q) => q.canvas === e.target);
      if (p) p.visible = e.isIntersecting;
    }
  });
  for (const p of pictures) seen.observe(p.canvas);
  const frame = (): void => {
    const anim = performance.now() / 1000;
    for (const p of pictures) if (p.visible) paint(p, anim);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

void start();
