import { contentHash, crop, sameImage, trim, type Image, type Piece } from "./pixels";
import { maskTo, normalMap } from "./raster";

/**
 * Where the bake keeps its unique images. Frame images, the depth layers' own
 * images and the images added to frames that already shipped live in three
 * stores, numbered in that order once the bake is done, so a bake that adds
 * layers or later data stores every older image under the same id, in the
 * same order, as a bake without them (the archive packs each group on pages
 * of its own).
 */

/** An image placed inside a frame: the unique image's id and its offset. */
export interface ImageRef {
  id: number;
  dx: number;
  dy: number;
}

/** Unique color-and-normal pairs by content. A normal map is taken over a
 *  whole frame before anything is cut from it, so trimming, slicing and
 *  layering never leave a false bevel at a cut. */
export class ImageStore {
  readonly images: Image[] = [];
  readonly normals: Image[] = [];
  private readonly byHash = new Map<string, number[]>();

  /** The id of a stored pair equal to this one, or -1. */
  find(img: Image, normal: Image): number {
    for (const id of this.byHash.get(`${contentHash(img)}|${contentHash(normal)}`) ?? []) {
      if (sameImage(this.images[id], img) && sameImage(this.normals[id], normal)) return id;
    }
    return -1;
  }

  add(img: Image, normal: Image): number {
    const key = `${contentHash(img)}|${contentHash(normal)}`;
    const ids = this.byHash.get(key) ?? [];
    for (const id of ids) if (sameImage(this.images[id], img) && sameImage(this.normals[id], normal)) return id;
    const id = this.images.length;
    this.images.push(img);
    this.normals.push(normal);
    ids.push(id);
    this.byHash.set(key, ids);
    return id;
  }

  /** Trim a whole frame and store it; null for a fully transparent frame. */
  ref(img: Image): ImageRef | null {
    const t = trim(img);
    if (!t) return null;
    const normal = crop(normalMap(img), t.x, t.y, t.w, t.h);
    return { id: this.add({ w: t.w, h: t.h, data: t.data }, normal), dx: t.x, dy: t.y };
  }

  /** Store a layer cut from the whole frame `next`; its normals come from
   *  that frame, masked to the layer's own pixels. */
  layer(piece: Piece | null, next: Image): ImageRef | null {
    if (!piece) return null;
    const normal = maskTo(crop(normalMap(next), piece.x, piece.y, piece.w, piece.h), piece);
    return { id: this.add({ w: piece.w, h: piece.h, data: piece.data }, normal), dx: piece.x, dy: piece.y };
  }
}

/** A depth-layer image: a frame image's id, or (`own`) an id in the layer
 *  store, which the bake moves past the frame images once it is done. */
export interface PendingRef extends ImageRef {
  own: boolean;
}

/** A layer's normals: those of the whole picture `next` it was cut from,
 *  masked to its own pixels. */
function pieceNormal(piece: Piece, next: Image): Image {
  return maskTo(crop(normalMap(next), piece.x, piece.y, piece.w, piece.h), piece);
}

/** The depth layers' images, kept apart from the frame images so a bake with
 *  layers stores every frame image under the same id, in the same order, as a
 *  bake without them. A layer equal to a frame image already stored reuses it
 *  (one equal to a later frame's image is stored twice, which costs only
 *  space). */
export class LayerStore {
  readonly own = new ImageStore();
  constructor(private readonly frames: ImageStore) {}

  private put(img: Image, normal: Image, dx: number, dy: number): PendingRef {
    const hit = this.frames.find(img, normal);
    return hit >= 0 ? { id: hit, dx, dy, own: false } : { id: this.own.add(img, normal), dx, dy, own: true };
  }

  /** A whole shell picture, trimmed; its normals are its own (the shell is a
   *  picture of its own, drawn without the furniture). */
  shell(img: Image): PendingRef | null {
    const t = trim(img);
    if (!t) return null;
    return this.put({ w: t.w, h: t.h, data: t.data }, crop(normalMap(img), t.x, t.y, t.w, t.h), t.x, t.y);
  }

  /** A piece (the furniture, or one depth step) cut from the whole picture
   *  `next`; its normals come from that picture, masked to its own pixels,
   *  like any other layer. */
  piece(piece: Piece | null, next: Image): PendingRef | null {
    if (!piece) return null;
    return this.put({ w: piece.w, h: piece.h, data: piece.data }, pieceNormal(piece, next), piece.x, piece.y);
  }
}

/**
 * The images added to frames that already shipped (an alternative chain, a
 * frame's cycles), flat and depth alike. An image equal to one in the frame
 * or layer store reuses it; the rest are stored here and numbered after every
 * older image once the bake knows how many there are ({@link finish}), so the
 * archive packs them on pages after all the older pages.
 */
export class AddedStore {
  readonly own = new ImageStore();
  private readonly later: { ref: PendingRef; after: "frames" | "layers" }[] = [];

  constructor(
    private readonly frames: ImageStore,
    private readonly layers: ImageStore,
  ) {}

  /** A piece cut from the whole picture `next`, like {@link LayerStore.piece}.
   *  Its id is final only after {@link finish}. */
  piece(piece: Piece | null, next: Image): PendingRef | null {
    if (!piece) return null;
    const img = { w: piece.w, h: piece.h, data: piece.data };
    const normal = pieceNormal(piece, next);
    const hit = this.frames.find(img, normal);
    if (hit >= 0) return { id: hit, dx: piece.x, dy: piece.y, own: false };
    const layer = this.layers.find(img, normal);
    const ref: PendingRef = { id: layer >= 0 ? layer : this.own.add(img, normal), dx: piece.x, dy: piece.y, own: false };
    this.later.push({ ref, after: layer >= 0 ? "frames" : "layers" });
    return ref;
  }

  /** Give every reference its final id: the depth layers' own images follow
   *  the frame images, and the added images follow those. Runs once, before
   *  the depth layers' references are resolved. */
  finish(frameImages: number, layerImages: number): void {
    for (const { ref, after } of this.later) ref.id += after === "frames" ? frameImages : frameImages + layerImages;
    this.later.length = 0;
  }
}
