import { zipSync, strToU8, type Zippable } from "fflate";
import type { BakeResult, ImageRef } from "./bake";
import { variantPlacements, roomKinds, ORIGIN_SEEDED, RECYCLE_STEPS, PARKING_CAR_COLORS } from "./catalog";
import { CAR_SEEDS, SKYLINE_FILLS, SKY_COLUMNS, STREET_CAR_SEEDS, BUILDS } from "./catalogExtras";
import { pack, type PackedSlice } from "./pack";
import { blank, crop, over, sameImage, type Image } from "./pixels";
import { encodePng } from "./png";
import { blit, scaleNearest } from "./raster";
import {
  ATLAS_PADDING,
  ATLAS_PAGE_BASE,
  ATLAS_SCALES,
  ATLAS_SCHEMA_VERSION,
  type AtlasManifest,
  type FrameRecord,
  type LayerRef,
  type Placed,
} from "./schema";
import { FLOOR, TILE } from "../scale";
import { skyColor } from "../sprites/sky";
import { SHIRTS } from "../pixelSprites/common";

/**
 * Turns a bake into the release archive: packs the unique images into 1x
 * pages, derives the 2x and 4x pages by nearest-neighbor scaling, generates a
 * normal map per page, writes the manifest, and zips it all with the license
 * attribution. Deterministic: the same bake gives the same bytes.
 */

export interface ArchiveInfo {
  version: string;
  commit: string;
  /** The suggested attribution line from ASSETS-LICENSE.md. */
  attribution: string;
  /** ASSETS-LICENSE.md itself, shipped verbatim. */
  licenseText: string;
}

export const ARCHIVE_ROOT = "verticopolis-atlas";

/** Fixed zip timestamp (built from local fields, which is how the zip format
 *  stores it), so the archive bytes never depend on the clock. */
const ZIP_TIME = new Date(1980, 0, 2, 0, 0, 0);

export function signature(): AtlasManifest["signature"] {
  return {
    baked: ["kind", "state", "subtype", "width", "lit", "hours", "late", "presence", "variant"],
    composed: ["visibleOccupants", "riders", "recyclingFill", "parkingCar", "deadParking"],
    animated: ["fire", "construction", "entranceDoorman", "crane"],
    sampled: ["variant"],
    rules: {
      hours: "open or closed by the kind's business hours at the current hour; 'always' for kinds without hours",
      late: "condo, studio and apartment: 'late' from 23:00 to 06:00, else 'notlate'; 'any' for every other kind. The game's re-bake does not yet flip the two rentals at 23:00 and 06:00 (issue #916), so on screen they can keep their earlier look until something else repaints them",
      presence: "'home' when the unit's occupants is above 0, else 'away'; kinds whose art ignores occupants (the garage, ramp, services, recycling, metro) carry no presence segment",
      width: "frames exist for each kind's catalog width only; a room imported at another width has no frame",
      subtype: "a subtype the engine does not list for the kind draws the default look, the '-' frame",
      visibleOccupants: "occupants minus outForMeal, rounded up and clamped at 0; draw chain steps 1..min(n, max) over the 'home' frame. Chains cover every count the engine produces (population, venue attendance, the largest household)",
      riders: "the cab's rider indicator (0..4, the game's load quantized to quarters); draw chain steps 1..min(n, max) over the car frame",
      recyclingFill: `round(fill * ${RECYCLE_STEPS}) for the tower's recycling fill in 0..1; draw chain steps over the frame. The web re-bakes on the same eighths but paints the exact fill, so a pile between steps can differ by a bag or a gauge pixel`,
      parkingCar: `overlay 'car<i>' with i = unit id % ${PARKING_CAR_COLORS} when the space holds a car; never on a dead space. The game re-paints a space when the garage's use crosses a sixth, so its cars can trail the live use slightly`,
      deadParking: "overlay 'dead' when the space is not chained to a ramp (not on a burning or unbuilt space)",
      fire: "state 'fire' plays the animation fire/<kind>",
      construction: "state 'construction' plays the animation construction/<kind>",
      variant: "the web seeds room variety from the room's floor, column and id; the atlas ships a fixed sample (see 'variants'), pick one per room and keep it",
      sky: "sky/gradient has one column per quarter hour from 00:00; the web's color is a cosine blend, t = cos((hour - 13) / 24 * 2 * pi) * 0.5 + 0.5, from #1c2246 (t 0) to #82afe0 (t 1) per channel, rounded",
      parkingRoll: "a space holds a car when hash(int32(id * 31)) < parkingUse, where hash(n) is: x = int32(n * 2654435761) with the product taken as a float64 (IEEE double) multiply; x = imul32(x ^ (x >>> 15), 0x2c1b3c6d); x = imul32(x ^ (x >>> 13), 0x297a2d39); (x ^ (x >>> 16)) as unsigned / 2^32. int32(v) truncates v toward zero and wraps it modulo 2^32 to a signed 32-bit integer (JavaScript's v | 0); imul32 is a 32-bit integer multiply; ^ is a 32-bit xor and >>> a logical (zero-filling) right shift on the 32-bit pattern, so a negative x shifts in zeros. The first step is not imul32: the two can differ once the product's magnitude passes 2^53",
      cinema: "the cinema's marquee and screen read the animation clock; the web keeps whatever phase its last re-bake caught, the atlas bakes phase 0",
      originSeeded: `${[...ORIGIN_SEEDED].join(", ")}: a few details (staff shirts, skyline windows, climbing holds) follow the web's draw origin; the atlas carries the per-unit look at origin 0, 0`,
      layers: "a room frame may carry 'layers' for drawing with depth: draw the 'shell' parts, then the 'furniture' parts source-over, and the two give back the frame's own parts exactly; draw its chains and overlays on top as usual. A frame without 'layers' (vacancy, closed and gutted rooms, and the kinds whose art marks no split) is drawn flat",
    },
  };
}

function placedOf(ref: ImageRef, slices: PackedSlice[]): Placed[] {
  return slices.map((s) => ({ rect: s.rect, dx: ref.dx + s.sx, dy: ref.dy }));
}

function layerOf(ref: ImageRef | null, placements: PackedSlice[][]): LayerRef {
  if (!ref) return null;
  const parts = placedOf(ref, placements[ref.id]);
  if (parts.length !== 1) throw new Error(`layer image ${ref.id} needs ${parts.length} slices; layers must fit one page`);
  return parts[0];
}

export interface Archive {
  manifest: AtlasManifest;
  /** The 1x color and normal pages, for checks before encoding. */
  pages: Image[];
  normalPages: Image[];
  /** Where each image id was packed. */
  placements: PackedSlice[][];
  /** Paths inside the zip (under {@link ARCHIVE_ROOT}) to bytes. */
  files: Record<string, Uint8Array>;
  zip: Uint8Array;
}

/**
 * Pack the frame images, then the depth layers' own images on pages of their
 * own after them. The frame images pack exactly as they would in a bake with
 * no layers, so adding layers never moves a frame's part or changes a byte of
 * its pages.
 */
function packGroups(bake: BakeResult, pageSize: number): { pages: number; placements: PackedSlice[][] } {
  const split = bake.frameImages ?? bake.images.length;
  if (!(Number.isInteger(split) && split >= 0 && split <= bake.images.length)) throw new Error(`frameImages ${split} is outside 0..${bake.images.length}`);
  const group = (from: number, to: number) => pack(
    bake.images.slice(from, to).map((img, i) => ({ id: from + i, w: img.w, h: img.h })),
    pageSize,
    ATLAS_PADDING,
  );
  const framesPacked = group(0, split);
  const layersPacked = group(split, bake.images.length);
  const shifted = layersPacked.placements.map((list) => list.map((sl) => ({ ...sl, rect: { ...sl.rect, page: sl.rect.page + framesPacked.pages } })));
  return { pages: framesPacked.pages + layersPacked.pages, placements: [...framesPacked.placements, ...shifted] };
}

export function buildArchive(
  bake: BakeResult,
  info: ArchiveInfo,
  onProgress?: (msg: string) => void,
  pageSize: number = ATLAS_PAGE_BASE,
): Archive {
  const packed = packGroups(bake, pageSize);
  onProgress?.(`packed ${bake.images.length} images into ${packed.pages} pages`);
  const pages: Image[] = Array.from({ length: packed.pages }, () => blank(pageSize, pageSize));
  const normalPages: Image[] = Array.from({ length: packed.pages }, () => flatNormals(pageSize));
  bake.images.forEach((img, id) => {
    for (const s of packed.placements[id]) {
      blit(pages[s.rect.page], img, s.sx, 0, s.rect.w, s.rect.h, s.rect.x, s.rect.y);
      blit(normalPages[s.rect.page], bake.normals[id], s.sx, 0, s.rect.w, s.rect.h, s.rect.x, s.rect.y);
    }
  });

  const frames: Record<string, FrameRecord> = {};
  for (const f of bake.frames) {
    const rec: FrameRecord = { w: f.w, h: f.h, anchor: f.anchor, parts: f.image ? placedOf(f.image, packed.placements[f.image.id]) : [], keys: f.keys };
    if (f.chains) {
      rec.chains = {};
      for (const [k, c] of Object.entries(f.chains)) {
        rec.chains[k] = { input: c.input, max: c.steps.length - 1, steps: c.steps.map((s) => layerOf(s, packed.placements)) };
      }
    }
    if (f.overlays) {
      rec.overlays = {};
      for (const [k, o] of Object.entries(f.overlays)) rec.overlays[k] = layerOf(o, packed.placements);
    }
    if (f.layers) {
      const parts = (ref: ImageRef | null): Placed[] => (ref ? placedOf(ref, packed.placements[ref.id]) : []);
      rec.layers = { shell: parts(f.layers.shell), furniture: parts(f.layers.furniture) };
    }
    frames[f.name] = rec;
  }

  const files: Record<string, Uint8Array> = {};
  const pageFiles: AtlasManifest["pages"] = [];
  pages.forEach((page, i) => {
    const normal = normalPages[i];
    const entry: AtlasManifest["pages"][number] = { index: i, files: {} };
    for (const s of ATLAS_SCALES) {
      const stem = `${s}x/page-${String(i).padStart(3, "0")}`;
      files[`${stem}.png`] = encodePng(scaleNearest(page, s));
      files[`${stem}.normal.png`] = encodePng(scaleNearest(normal, s));
      entry.files[`${s}x`] = { color: `${stem}.png`, normal: `${stem}.normal.png` };
    }
    pageFiles.push(entry);
    onProgress?.(`encoded page ${i + 1}/${pages.length}`);
  });

  const variants: AtlasManifest["variants"] = {};
  for (const k of roomKinds()) variants[k] = variantPlacements(k);
  const manifest: AtlasManifest = {
    schema: ATLAS_SCHEMA_VERSION,
    game: { version: info.version, commit: info.commit },
    license: { name: "CC BY 4.0", url: "https://creativecommons.org/licenses/by/4.0/", attribution: info.attribution },
    tile: { w: TILE, h: FLOOR },
    scales: [...ATLAS_SCALES],
    pageSize,
    padding: ATLAS_PADDING,
    pages: pageFiles,
    signature: signature(),
    variants,
    frames,
    animations: Object.fromEntries(bake.animations.map((a) => [a.name, { frames: a.frames, dt: a.dt, loop: a.loop, keys: a.keys }])),
    data: {
      skyColors: Array.from({ length: SKY_COLUMNS }, (_, c) => skyColor((c * 24) / SKY_COLUMNS)),
      skylineFills: SKYLINE_FILLS,
      shirts: SHIRTS,
      personBuilds: BUILDS,
      carSeeds: CAR_SEEDS,
      streetCarSeeds: STREET_CAR_SEEDS,
    },
  };
  files["manifest.json"] = strToU8(JSON.stringify(manifest) + "\n");
  files["ATTRIBUTION.txt"] = strToU8(attributionText(info));
  files["ASSETS-LICENSE.md"] = strToU8(info.licenseText);

  const zippable: Zippable = {};
  for (const path of Object.keys(files).sort()) {
    zippable[`${ARCHIVE_ROOT}/${path}`] = [files[path], { level: path.endsWith(".png") ? 0 : 9, mtime: ZIP_TIME }];
  }
  return { manifest, pages, normalPages, placements: packed.placements, files, zip: zipSync(zippable) };
}

/** Ids of images whose color or normal pixels do not come back out of the
 *  pages at their packed slices; empty when every image does. */
export function checkPages(bake: Pick<BakeResult, "images" | "normals">, archive: Pick<Archive, "pages" | "normalPages" | "placements">): number[] {
  const matches = (id: number, s: PackedSlice): boolean => {
    const img = bake.images[id];
    const normal = bake.normals[id];
    const page = archive.pages[s.rect.page];
    const normalPage = archive.normalPages[s.rect.page];
    for (let y = 0; y < s.rect.h; y++) {
      for (let x = 0; x < s.rect.w; x++) {
        const src = (y * img.w + s.sx + x) * 4;
        const dst = ((s.rect.y + y) * page.w + s.rect.x + x) * 4;
        for (let c = 0; c < 4; c++) {
          if (page.data[dst + c] !== img.data[src + c] || normalPage.data[dst + c] !== normal.data[src + c]) return false;
        }
      }
    }
    return true;
  };
  const bad: number[] = [];
  archive.placements.forEach((list, id) => {
    if (list.length === 0 || !list.every((s) => matches(id, s))) bad.push(id);
  });
  return bad;
}

/** Draw `parts` from the 1x `pages` onto `dst` source-over. */
function drawParts(dst: Image, pages: readonly Image[], parts: readonly Placed[]): void {
  for (const p of parts) over(dst, crop(pages[p.rect.page], p.rect.x, p.rect.y, p.rect.w, p.rect.h), p.dx, p.dy);
}

/** Names of the frames whose depth layers, read back out of the packed pages
 *  through the manifest the way a frontend reads them, do not give back the
 *  frame's own pixels; empty when every layered frame does. */
export function checkLayers(archive: Pick<Archive, "manifest" | "pages">): string[] {
  const bad: string[] = [];
  for (const [name, rec] of Object.entries(archive.manifest.frames)) {
    if (!rec.layers) continue;
    const flat = blank(rec.w, rec.h);
    drawParts(flat, archive.pages, rec.parts);
    const split = blank(rec.w, rec.h);
    drawParts(split, archive.pages, rec.layers.shell);
    drawParts(split, archive.pages, rec.layers.furniture);
    if (!sameImage(flat, split)) bad.push(name);
  }
  return bad;
}

/** A transparent page whose pixels still decode as the flat normal. */
function flatNormals(size: number): Image {
  const img = blank(size, size);
  for (let i = 0; i < img.data.length; i += 4) img.data.set([128, 128, 255, 0], i);
  return img;
}

export function attributionText(info: ArchiveInfo): string {
  return [
    info.attribution,
    "",
    "These sprites are the Verticopolis art, baked once at the game's canonical",
    "size and scaled up by nearest neighbor. If you change them, say so.",
    "License: https://creativecommons.org/licenses/by/4.0/",
    `Built from Verticopolis ${info.version} (${info.commit}).`,
    "",
  ].join("\n");
}
