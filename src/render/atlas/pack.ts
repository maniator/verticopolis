import type { AtlasRect } from "./schema";

/**
 * A deterministic shelf packer for the atlas pages. Images go in tallest
 * first (ties by width, then by id, so the same input always packs the same
 * way), each inside a transparent gutter. An image wider than a page is cut
 * into column slices packed on their own; `sx` says where a slice starts in
 * its image.
 */

export interface PackInput {
  id: number;
  w: number;
  h: number;
}

export interface PackedSlice {
  rect: AtlasRect;
  sx: number;
}

export interface PackResult {
  pages: number;
  /** Slices per image id, left to right. */
  placements: PackedSlice[][];
}

interface Shelf {
  y: number;
  h: number;
  x: number;
}

export function pack(images: readonly PackInput[], pageSize: number, padding: number): PackResult {
  const maxW = pageSize - 2 * padding;
  const items: { id: number; sx: number; w: number; h: number }[] = [];
  for (const img of images) {
    if (img.h > maxW) throw new Error(`image ${img.id} is ${img.h} px tall, past the ${maxW} px page`);
    for (let sx = 0; sx < img.w; sx += maxW) items.push({ id: img.id, sx, w: Math.min(maxW, img.w - sx), h: img.h });
  }
  items.sort((a, b) => b.h - a.h || b.w - a.w || a.id - b.id || a.sx - b.sx);
  const pages: { shelves: Shelf[]; used: number }[] = [];
  const placements: PackedSlice[][] = images.map(() => []);
  const index = new Map(images.map((img, i) => [img.id, i]));
  for (const it of items) {
    const cw = it.w + 2 * padding;
    const ch = it.h + 2 * padding;
    let spot: { page: number; x: number; y: number } | null = null;
    for (let p = 0; p < pages.length && !spot; p++) {
      const pg = pages[p];
      for (const s of pg.shelves) {
        if (s.h >= ch && s.x + cw <= pageSize) {
          spot = { page: p, x: s.x, y: s.y };
          s.x += cw;
          break;
        }
      }
      if (!spot && pg.used + ch <= pageSize) {
        pg.shelves.push({ y: pg.used, h: ch, x: cw });
        spot = { page: p, x: 0, y: pg.used };
        pg.used += ch;
      }
    }
    if (!spot) {
      pages.push({ shelves: [{ y: 0, h: ch, x: cw }], used: ch });
      spot = { page: pages.length - 1, x: 0, y: 0 };
    }
    const at = index.get(it.id) as number;
    placements[at].push({ rect: { page: spot.page, x: spot.x + padding, y: spot.y + padding, w: it.w, h: it.h }, sx: it.sx });
  }
  for (const list of placements) list.sort((a, b) => a.sx - b.sx);
  return { pages: pages.length, placements };
}
