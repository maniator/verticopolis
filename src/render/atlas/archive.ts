import { zipSync, strToU8, type Zippable } from "fflate";
import type { BakeResult, ImageRef } from "./bake";
import { variantPlacements, roomKinds, ORIGIN_SEEDED, RECYCLE_BREAKS, RECYCLE_STEPS, PARKING_CAR_COLORS } from "./catalog";
import { CINEMA_CYCLES } from "./cycles";
import { CAR_SEEDS, SKYLINE_FILLS, SKY_COLUMNS, STREET_CAR_SEEDS, BUILDS } from "./catalogExtras";
import { pack, type PackedSlice } from "./pack";
import { depthData, sceneryData, skyData } from "./scenery";
import { blank, crop, over, sameImage, type Image } from "./pixels";
import { encodePng } from "./png";
import { blit, scaleNearest } from "./raster";
import {
  ATLAS_PADDING,
  ATLAS_PAGE_BASE,
  ATLAS_SCALES,
  ATLAS_SCHEMA_VERSION,
  type AtlasManifest,
  type DepthLayerChain,
  type DepthLayers,
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
  /** The app icon files, shipped under `icon/` by name. */
  icons?: Record<string, Uint8Array>;
}

export const ARCHIVE_ROOT = "verticopolis-atlas";

/** Fixed zip timestamp (built from local fields, which is how the zip format
 *  stores it), so the archive bytes never depend on the clock. */
const ZIP_TIME = new Date(1980, 0, 2, 0, 0, 0);

export function signature(): AtlasManifest["signature"] {
  return {
    baked: ["kind", "state", "subtype", "width", "lit", "hours", "late", "presence", "variant"],
    composed: ["visibleOccupants", "riders", "recyclingFill", "parkingCar", "deadParking", "recyclingFillExact"],
    animated: ["fire", "construction", "entranceDoorman", "crane", "cinema"],
    sampled: ["variant"],
    rules: {
      hours: "open or closed by the kind's business hours at the current hour; 'always' for kinds without hours",
      late: "condo, studio and apartment: 'late' from 23:00 to 06:00, else 'notlate'; 'any' for every other kind",
      presence: "'home' when the unit's occupants is above 0, else 'away'; kinds whose art ignores occupants (the garage, ramp, services, recycling, metro) carry no presence segment",
      width: "room frames exist for each kind's catalog width only. A room at another width (a TDT import or an old save keeps its original width) uses the catalog-width frame or animation, composed as usual, then scaled horizontally to its real width, nearest neighbor from the left edge (the reference reader's stretchTo); it approximates the web game, which redraws the room at its real width. Legacy shaft widths (stairs and escalators 4, standard elevator 3, express 4) have frames of their own, named with a w<tiles> segment after the kind; a shaft at any other width stretches its catalog frames the same way",
      subtype: "a subtype the engine does not list for the kind draws the default look, the '-' frame",
      visibleOccupants: "occupants minus outForMeal, rounded up and clamped at 0. Read outForMeal as between 0 and occupants: a negative or non-finite value is nobody out, and a value over occupants is everybody out; a non-finite occupants is nobody. Draw chain steps 1..min(n, max) over the 'home' frame. Chains cover every count the engine produces (population, venue attendance, the largest household)",
      riders: "the cab's rider indicator (0..4, the game's load quantized to quarters); draw chain steps 1..min(n, max) over the car frame",
      recyclingFill: `round(fill * ${RECYCLE_STEPS}) for the tower's recycling fill in 0..1; draw chain steps over the frame. The web re-bakes on the same eighths but paints the exact fill, so a pile between steps can differ by a bag or a gauge pixel`,
      recyclingFillExact: "the 'fillExact' chain, drawn instead of 'fill' (never with it): n is how many entries of data.recyclingFillBreaks are at or below the fill, read as the game reads it (clamped to 0..1, a non-finite fill as 0). Each break is a fill where the picture changes (a bag, a gauge row, the second row past 0.5, amber past 0.7, red and FULL at 1), so every fill matches the game's paint exactly",
      parkingCar: `overlay 'car<i>' with i = unit id % ${PARKING_CAR_COLORS} when the space holds a car; never on a dead space. The game re-paints a space when the garage's use crosses a sixth, so its cars can trail the live use slightly`,
      deadParking: "overlay 'dead' when the space is not chained to a ramp (not on a burning or unbuilt space)",
      fire: "state 'fire' plays the animation fire/<kind>",
      construction: "state 'construction' plays the animation construction/<kind>",
      variant: "the web seeds room variety from the room's floor, column and id; the atlas ships a fixed sample (see 'variants'), pick one per room and keep it",
      sky: "sky/gradient has one column per quarter hour from 00:00; the web's color is a cosine blend, t = cos((hour - 13) / 24 * 2 * pi) * 0.5 + 0.5, from #1c2246 (t 0) to #82afe0 (t 1) per channel, rounded",
      parkingRoll: "a space holds a car when hash(int32(id * 31)) < parkingUse, where hash(n) is: x = int32(n * 2654435761) with the product taken as a float64 (IEEE double) multiply; x = imul32(x ^ (x >>> 15), 0x2c1b3c6d); x = imul32(x ^ (x >>> 13), 0x297a2d39); (x ^ (x >>> 16)) as unsigned / 2^32. int32(v) truncates v toward zero and wraps it modulo 2^32 to a signed 32-bit integer (JavaScript's v | 0); imul32 is a 32-bit integer multiply; ^ is a 32-bit xor and >>> a logical (zero-filling) right shift on the 32-bit pattern, so a negative x shifts in zeros. The first step is not imul32: the two can differ once the product's magnitude passes 2^53",
      cinema: `the cinema's marquee and screen read the animation clock. Its frames are baked at clock 0 and carry 'cycles': at t seconds draw ${Object.entries(CINEMA_CYCLES)
        .map(([k, c]) => `'${k}' step floor(t * ${c.rate}) % ${c.frames}`)
        .join(" and ")} (a cycle a frame does not carry never changes it); this matches the game's paint except within rounding of a screen step, where the game adds the room's seed before rounding down. The web itself keeps whatever moment its last re-bake caught`,
      originSeeded: `${[...ORIGIN_SEEDED].join(", ")}: a few details (staff shirts, skyline windows, climbing holds) follow the web's draw origin; the atlas carries the per-unit look at origin 0, 0`,
      layers: "a room frame, a lobby tile, an entrance frame, an elevator cab or the metro train may carry 'layers' for drawing with depth. To draw it with its chain at n (the frame's one chain, if any: 'occupants', 'riders' or 'fill', or the chain marked 'alternativeTo' it, drawn instead), draw the 'shell' parts and the chain's 'shell' steps 1..min(n, len - 1), then any 'cycles' steps, then the 'furniture' parts and the chain's 'furniture' steps the same way, then any overlay the frame shows (a parking space's car or dead mark), each source-over; an elevator cab or the metro train also has a 'front' picture (and, for the cab's riders, 'front' chain steps), drawn after the furniture and before any overlay; the result equals the frame's parts, its chain steps 1..n and the overlay exactly. 'soft' (with the chain's 'soft' steps) is an optional furniture picture that keeps glows and soft shadows translucent; over the shell it rounds a step or two away from the frame's parts. A frame without 'layers' (vacancy, closed and gutted rooms, and every family outside the ones named here) is drawn flat",
      depth: "data.depth names the game's draw planes back to front ('z', higher in front; equal planes draw in the order the game adds their actors) and the frame families on each",
      skyMotion: "data.sky gives the sun's arc and each cloud's drift in the game's own terms; both are screen-space, sized to the view",
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
 * own after them, then the added images (`BakeResult.addedImages`) after
 * those. The frame images pack exactly as they would in a bake with no
 * layers, so adding layers never moves a frame's part or changes a byte of
 * its pages, and the added images move nothing at all.
 */
function packGroups(bake: BakeResult, pageSize: number): { pages: number; placements: PackedSlice[][] } {
  const split = bake.frameImages ?? bake.images.length;
  if (!(Number.isInteger(split) && split >= 0 && split <= bake.images.length)) throw new Error(`frameImages ${split} is outside 0..${bake.images.length}`);
  const starts = bake.groups ?? [];
  if (starts.some((s, i) => !Number.isInteger(s) || s < (starts[i - 1] ?? 0) || s > split)) throw new Error(`groups ${starts.join(", ")} are outside 0..${split} or out of order`);
  const addedFrom = bake.addedImages ?? bake.images.length;
  if (!(Number.isInteger(addedFrom) && addedFrom >= split && addedFrom <= bake.images.length)) throw new Error(`addedImages ${addedFrom} is outside ${split}..${bake.images.length}`);
  // Each group packs on its own pages, in order: the first families' frame
  // images, each later family's, the depth layers' own images, then the
  // images added to frames that already shipped.
  const bounds = [0, ...starts, split, ...(bake.addedImages === undefined ? [] : [addedFrom]), bake.images.length];
  let pages = 0;
  const placements: PackedSlice[][] = [];
  for (let g = 0; g + 1 < bounds.length; g++) {
    const from = bounds[g];
    const packed = pack(
      bake.images.slice(from, bounds[g + 1]).map((img, i) => ({ id: from + i, w: img.w, h: img.h })),
      pageSize,
      ATLAS_PADDING,
    );
    for (const list of packed.placements) placements.push(list.map((sl) => ({ ...sl, rect: { ...sl.rect, page: sl.rect.page + pages } })));
    pages += packed.pages;
  }
  return { pages, placements };
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
        rec.chains[k] = { input: c.input, max: c.steps.length - 1, steps: c.steps.map((s) => layerOf(s, packed.placements)), ...(c.alternativeTo ? { alternativeTo: c.alternativeTo } : {}) };
      }
    }
    if (f.overlays) {
      rec.overlays = {};
      for (const [k, o] of Object.entries(f.overlays)) rec.overlays[k] = layerOf(o, packed.placements);
    }
    if (f.layers) {
      const parts = (ref: ImageRef | null): Placed[] => (ref ? placedOf(ref, packed.placements[ref.id]) : []);
      const steps = (list: (ImageRef | null)[]) => list.map((s) => layerOf(s, packed.placements));
      const layers: DepthLayers = { shell: parts(f.layers.shell), furniture: parts(f.layers.furniture) };
      if ("soft" in f.layers) layers.soft = parts(f.layers.soft ?? null);
      if ("front" in f.layers) layers.front = parts(f.layers.front ?? null);
      if (f.layers.chains) {
        layers.chains = {};
        for (const [k, c] of Object.entries(f.layers.chains)) {
          const chain: DepthLayerChain = { shell: steps(c.shell), furniture: steps(c.furniture) };
          if (c.soft) chain.soft = steps(c.soft);
          if (c.front) chain.front = steps(c.front);
          layers.chains[k] = chain;
        }
      }
      rec.layers = layers;
    }
    if (f.cycles) {
      rec.cycles = {};
      for (const [k, c] of Object.entries(f.cycles)) rec.cycles[k] = { rate: c.rate, steps: c.steps.map((s) => layerOf(s, packed.placements)) };
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
      scenery: sceneryData(),
      sky: skyData(),
      depth: depthData(),
      recyclingFillBreaks: [...RECYCLE_BREAKS],
    },
  };
  files["manifest.json"] = strToU8(JSON.stringify(manifest) + "\n");
  files["ATTRIBUTION.txt"] = strToU8(attributionText(info));
  files["ASSETS-LICENSE.md"] = strToU8(info.licenseText);
  for (const [name, bytes] of Object.entries(info.icons ?? {})) files[`icon/${name}`] = bytes;

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

/** Draw a chain step (or nothing for a null or missing one). */
function drawStep(dst: Image, pages: readonly Image[], step: LayerRef | undefined): void {
  if (step) drawParts(dst, pages, [step]);
}

/** Every picture a layered frame can show, read back out of the pages the
 *  way a frontend reads them: for each chain input `n` from 0 to the longest
 *  of its step lists, the flat frame plus steps `1..n`, the exact depth split
 *  (shell and its steps, then furniture and its steps) and, when the frame
 *  has one, the soft split. `visit` returns false to stop early. */
function eachLayeredPicture(
  archive: Pick<Archive, "manifest" | "pages">,
  visit: (name: string, n: number, flat: Image, exact: Image, soft: { picture: Image; layer: Image } | null) => boolean,
): void {
  const pages = archive.pages;
  for (const [name, rec] of Object.entries(archive.manifest.frames)) {
    const layers = rec.layers;
    if (!layers) continue;
    // A frame with no chain still has its own picture at n = 0.
    const keys = Object.keys(rec.chains ?? {});
    for (const key of keys.length > 0 ? keys : [""]) {
      const flatSteps = rec.chains?.[key]?.steps ?? [null];
      const split = layers.chains?.[key] ?? { shell: [null], furniture: [null] };
      const hasSoft = layers.soft !== undefined && (key === "" || split.soft !== undefined);
      const front = blank(rec.w, rec.h);
      if (layers.front) drawParts(front, pages, layers.front);
      const top = Math.max(flatSteps.length, split.shell.length, split.furniture.length, split.soft?.length ?? 0, split.front?.length ?? 0) - 1;
      const flat = blank(rec.w, rec.h);
      drawParts(flat, pages, rec.parts);
      const shell = blank(rec.w, rec.h);
      drawParts(shell, pages, layers.shell);
      const furniture = blank(rec.w, rec.h);
      drawParts(furniture, pages, layers.furniture);
      const soft = blank(rec.w, rec.h);
      if (hasSoft) drawParts(soft, pages, layers.soft ?? []);
      for (let n = 0; n <= top; n++) {
        if (n > 0) {
          drawStep(flat, pages, flatSteps[n] ?? undefined);
          drawStep(shell, pages, split.shell[n] ?? undefined);
          drawStep(furniture, pages, split.furniture[n] ?? undefined);
          if (hasSoft) drawStep(soft, pages, split.soft?.[n] ?? undefined);
          if (layers.front) drawStep(front, pages, split.front?.[n] ?? undefined);
        }
        const exact = { w: rec.w, h: rec.h, data: shell.data.slice() };
        over(exact, furniture, 0, 0);
        if (layers.front) over(exact, front, 0, 0);
        let softPicture: { picture: Image; layer: Image } | null = null;
        if (hasSoft) {
          const picture = { w: rec.w, h: rec.h, data: shell.data.slice() };
          over(picture, soft, 0, 0);
          softPicture = { picture, layer: soft };
        }
        if (!visit(name, n, flat, exact, softPicture)) break;
      }
    }
  }
}

/** Names of the frames whose chains name a missing alternative, or whose
 *  depth layers break the manifest's rules (chain
 *  keys, at most one chain besides its alternatives, a null step 0, soft steps exactly
 *  where there is soft furniture) or, read back out of the packed pages
 *  through the manifest the way a frontend reads them, do not give back the
 *  frame's own pixels for some occupant count; empty when every layered frame
 *  passes. */
export function checkLayers(archive: Pick<Archive, "manifest" | "pages">): string[] {
  const bad = new Set<string>();
  // A layered frame has at most one chain (its overlays draw last); its chain has a
  // depth split (and no split lacks its chain), each list starts with a null
  // step 0, and soft furniture comes with soft steps for its chain.
  for (const [name, rec] of Object.entries(archive.manifest.frames)) {
    // An alternative chain, on any frame, names a chain the frame has that is
    // not one itself.
    const chains = rec.chains ?? {};
    const alternativesOk = Object.values(chains).every((c) => c.alternativeTo === undefined || (Object.prototype.hasOwnProperty.call(chains, c.alternativeTo) && chains[c.alternativeTo].alternativeTo === undefined));
    if (!alternativesOk) bad.add(name);
    const layers = rec.layers;
    if (!layers) continue;
    const flat = JSON.stringify(Object.keys(rec.chains ?? {}).sort());
    const depth = JSON.stringify(Object.keys(layers.chains ?? {}).sort());
    const soft = layers.soft !== undefined;
    const lists = Object.values(layers.chains ?? {}).flatMap((c) => [c.shell, c.furniture, ...(c.soft ? [c.soft] : []), ...(c.front ? [c.front] : [])]);
    const front = layers.front !== undefined;
    // A vehicle's three-way split walks one chain; it carries no alternative.
    if (front && Object.values(chains).some((c) => c.alternativeTo !== undefined)) bad.add(name);
    if ((front && soft) || Object.values(layers.chains ?? {}).some((c) => (c.front !== undefined) !== front)) bad.add(name);
    const primary = Object.values(chains).filter((c) => c.alternativeTo === undefined);
    const oneChain = primary.length <= 1 && alternativesOk && (primary.length > 0 || Object.keys(chains).length === 0);
    if (flat !== depth || !oneChain || lists.some((l) => l[0] !== null) || Object.values(layers.chains ?? {}).some((c) => (c.soft !== undefined) !== soft)) bad.add(name);
  }
  eachLayeredPicture(archive, (name, _n, flat, exact) => {
    if (sameImage(flat, exact)) return true;
    bad.add(name);
    return false;
  });
  return [...bad];
}

/** The largest channel difference (of 255) the soft furniture may show
 *  against the flat frame before the export refuses the atlas. Translucent
 *  paint over the shell rounds a step or two away from the same paint baked
 *  over it; anything far past that means the soft pass drew something else. */
export const SOFT_DRIFT_LIMIT = 4;

/** How far the soft furniture strays from the flat pictures it stands in
 *  for: pictures compared (one per frame and occupant count), the soft
 *  furniture's own pixels in them, how many of those differ from the flat
 *  picture, how many pixels outside it differ (none, unless the soft pass
 *  missed part of the furniture), the largest difference in any channel
 *  (0..255) anywhere, and the frame that shows it (or the first with a
 *  pixel outside). A pixel counts once per picture it shows in. */
export function softLayerDrift(archive: Pick<Archive, "manifest" | "pages">): { frames: number; pictures: number; pixels: number; differing: number; outside: number; maxDelta: number; worst: string } {
  const frames = new Set<string>();
  const out = { frames: 0, pictures: 0, pixels: 0, differing: 0, outside: 0, maxDelta: 0, worst: "" };
  eachLayeredPicture(archive, (name, _n, flat, _exact, soft) => {
    if (!soft) return true;
    frames.add(name);
    out.pictures++;
    for (let i = 0; i < flat.data.length; i += 4) {
      const covered = soft.layer.data[i + 3] > 0;
      if (covered) out.pixels++;
      let d = 0;
      for (let c = 0; c < 4; c++) d = Math.max(d, Math.abs(flat.data[i + c] - soft.picture.data[i + c]));
      if (d > 0 && covered) out.differing++;
      if (d > 0 && !covered && out.outside++ === 0) out.worst = name;
      if (d > out.maxDelta && out.outside === 0) out.worst = name;
      if (d > out.maxDelta) out.maxDelta = d;
    }
    return true;
  });
  out.frames = frames.size;
  return out;
}

/** Room kinds whose frames carry depth layers but never any furniture. Shell
 *  plus furniture equals the flat frame whatever the shell holds, so a bake
 *  that failed to take the furniture out (a shell that still shows it) would
 *  pass {@link checkLayers}; every kind that splits has furniture in some
 *  frame, so an empty kind means the split did not happen. */
export function kindsWithoutFurniture(manifest: Pick<AtlasManifest, "frames">): string[] {
  const split = new Set<string>();
  const furnished = new Set<string>();
  for (const rec of Object.values(manifest.frames)) {
    if (!rec.layers) continue;
    const kind = String(rec.keys.kind ?? rec.keys.vehicle ?? rec.keys.piece ?? "unkeyed");
    split.add(kind);
    // A parking space's car comes as a 'car<i>' overlay, which draws in
    // front, and an empty elevator cab's riders as its chain's furniture steps.
    const steps = Object.values(rec.layers.chains ?? {}).some((c) => c.furniture.some((s) => s !== null));
    const car = Object.keys(rec.overlays ?? {}).some((o) => /^car\d+$/.test(o));
    if (rec.layers.furniture.length > 0 || steps || car) furnished.add(kind);
  }
  return [...split].filter((k) => !furnished.has(k)).sort();
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
