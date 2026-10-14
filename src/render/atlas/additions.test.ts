import { describe, expect, it } from "vitest";
import { buildArchive, checkLayers, checkPages } from "./archive";
import { bake, type BakeResult, type Renderer } from "./bake";
import type { StillJob } from "./catalog";
import { composeFrame, composeLayered } from "./compose";
import type { PaintSpec } from "./paint";
import { LayerError, blank, sameImage, type Image } from "./pixels";
import { blit } from "./raster";
import type { LayerRef } from "./schema";
import type { ImageRef } from "./store";

/**
 * Data added to frames that already shipped (an alternative chain, a frame's
 * cycles) must leave every older image, id, part and page as it was, pack on
 * pages after all of them, and compose back to the paint.
 */

/** Spec `x:<n>:<m>:<s>` paints a 6 x 2 room: a wall, the marquee pixel (0, 0)
 *  in color 100 + m, the screen pixel (1, 0) in 150 + s, and `n` seated
 *  people along the bottom row. Its shell pass leaves the people out. */
const spec = (n: number, m = 0, s = 0): PaintSpec => ({ p: "solid", css: `x:${n}:${m}:${s}` });
function paintRoom(p: PaintSpec, w: number, h: number, people: boolean): Image {
  if (p.p !== "solid") throw new Error("fake renderer: solid only");
  const [, n, m, s] = p.css.split(":").map(Number);
  const img = blank(w, h);
  for (let i = 0; i < w * h; i++) img.data.set([50, 0, 0, 255], i * 4);
  img.data.set([100 + m, 0, 0, 255], 0);
  img.data.set([150 + s, 0, 0, 255], 4);
  if (people) for (let i = 0; i < n; i++) img.data.set([200, 0, 0, 255], (w + i) * 4);
  return img;
}
const renderer: Renderer = {
  render: (p, w, h) => paintRoom(p, w, h, true),
  renderShell: (p, w, h) => paintRoom(p, w, h, false),
};

const older: StillJob = {
  type: "still",
  name: "room",
  w: 6,
  h: 2,
  anchor: { x: 0, y: 0 },
  keys: {},
  paint: spec(0),
  layers: true,
  chains: { people: { input: "people", steps: [spec(0), spec(2), spec(4)] } },
};
const other: StillJob = { ...older, name: "other", paint: spec(1), chains: undefined };
const checks: StillJob["cycleChecks"] = [];
for (let m = 0; m < 2; m++) for (let s = 0; s < 3; s++) checks.push({ at: { m, s }, chains: { exact: 3 }, paint: spec(3, m, s) }, { at: { m, s }, chains: {}, paint: spec(0, m, s) });
const added: StillJob = {
  ...older,
  chains: { ...older.chains, exact: { input: "exactPeople", steps: [0, 1, 2, 3, 4].map((n) => spec(n)), alternativeTo: "people" } },
  cycles: { m: { rate: 4, steps: [spec(0), spec(0, 1)] }, s: { rate: 2.5, steps: [0, 1, 2].map((s) => spec(0, 0, s)) } },
  cycleChecks: checks,
};
const info = { version: "1", commit: "x", attribution: "a", licenseText: "" };

describe("data added to frames that already shipped", () => {
  const before = bake([older, other], renderer);
  const after = bake([added, other], renderer);
  const rec = (r: BakeResult, name: string) => r.frames.find((f) => f.name === name)!;

  it("keeps every older image under its id and every older record as it was", () => {
    expect(after.frameImages).toBe(before.frameImages);
    expect(after.addedImages).toBe(before.images.length);
    expect(after.images.length).toBeGreaterThan(before.images.length);
    before.images.forEach((img, i) => expect(sameImage(after.images[i], img) && sameImage(after.normals[i], before.normals[i]), `image ${i}`).toBe(true));
    const { cycles, chains, layers, ...rest } = rec(after, "room");
    const { chains: oldChains, layers: oldLayers, ...oldRest } = rec(before, "room");
    expect(rest).toEqual(oldRest);
    expect(chains!.people).toEqual(oldChains!.people);
    expect({ ...layers, chains: { people: layers!.chains!.people } }).toEqual(oldLayers);
    expect(Object.keys(cycles!)).toEqual(["m", "s"]);
    expect(chains!.exact.alternativeTo).toBe("people");
    expect(rec(after, "other")).toEqual(rec(before, "other"));
    // Every added reference points past the older images, or at one of them.
    const refs = [...chains!.exact.steps, ...layers!.chains!.exact.shell, ...layers!.chains!.exact.furniture, ...cycles!.m.steps, ...cycles!.s.steps];
    for (const ref of refs) if (ref) expect(ref.id).toBeLessThan(after.images.length);
    expect(refs.some((ref) => ref && ref.id >= before.images.length)).toBe(true);
  });

  it("composes the frame, its cycles and either chain back to the paint, flat and with depth", () => {
    const room = rec(after, "room");
    for (let m = 0; m < 2; m++) {
      for (let s = 0; s < 3; s++) {
        for (let n = 0; n <= 4; n++) {
          const want = renderer.render(spec(n, m, s), 6, 2);
          expect(sameImage(composeFrame(after, room, { exact: n }, [], { m, s }), want), `exact ${n} ${m} ${s}`).toBe(true);
          expect(sameImage(composeLayered(after, room, { exact: n }, [], false, { m, s }), want), `depth ${n} ${m} ${s}`).toBe(true);
          if (n % 2 === 0) expect(sameImage(composeFrame(after, room, { people: n / 2 }, [], { m, s }), want), `people ${n}`).toBe(true);
        }
      }
    }
    expect(() => composeFrame(after, room, {}, [], { m: 2 })).toThrow(/cycle m has no step 2/);
    // A cycle the frame does not carry draws nothing.
    expect(sameImage(composeFrame(after, room, {}, [], { nope: 1 }), renderer.render(spec(0), 6, 2))).toBe(true);
  });

  it("packs the added images on pages after every older page and leaves those pages alone", () => {
    const a = buildArchive(before, info, undefined, 8);
    const b = buildArchive(after, info, undefined, 8);
    expect(b.pages.length).toBeGreaterThan(a.pages.length);
    a.pages.forEach((page, i) => expect(sameImage(b.pages[i], page) && sameImage(b.normalPages[i], a.normalPages[i]), `page ${i}`).toBe(true));
    const { cycles, chains, layers, ...rest } = b.manifest.frames.room;
    const { chains: oldChains, layers: oldLayers, ...oldRest } = a.manifest.frames.room;
    expect(rest).toEqual(oldRest);
    expect(chains!.people).toEqual(oldChains!.people);
    expect({ ...layers, chains: { people: layers!.chains!.people } }).toEqual(oldLayers);
    expect(chains!.exact).toMatchObject({ input: "exactPeople", max: 4, alternativeTo: "people" });
    expect(cycles!.m.rate).toBe(4);
    expect(cycles!.s.steps).toHaveLength(3);
    expect(cycles!.m.steps[0]).toBeNull();
    for (const p of [...chains!.exact.steps, ...cycles!.m.steps, ...cycles!.s.steps]) if (p) expect(p.rect.page).toBeGreaterThanOrEqual(a.pages.length);
    // Each added step reads back out of the pages as the bake's image.
    const room = rec(after, "room");
    const pairs: [LayerRef, ImageRef | null][] = [
      ...chains!.exact.steps.map((p, i): [LayerRef, ImageRef | null] => [p, room.chains!.exact.steps[i]]),
      ...Object.entries(cycles!).flatMap(([k, c]) => c.steps.map((p, i): [LayerRef, ImageRef | null] => [p, room.cycles![k].steps[i]])),
    ];
    for (const [p, ref] of pairs) {
      if (!p || !ref) {
        expect(p).toBe(ref);
        continue;
      }
      expect(ref).toEqual({ id: ref.id, dx: p.dx, dy: p.dy });
      const fromPage = blank(p.rect.w, p.rect.h);
      blit(fromPage, b.pages[p.rect.page], p.rect.x, p.rect.y, p.rect.w, p.rect.h, 0, 0);
      expect(sameImage(fromPage, after.images[ref.id])).toBe(true);
    }
    expect(b.manifest.frames.other).toEqual(a.manifest.frames.other);
    expect(checkPages(after, b)).toEqual([]);
    expect(checkLayers(b)).toEqual([]);
  });

  it("refuses a cycle that does not compose to its check", () => {
    const wrong = { ...added, cycleChecks: [{ at: { m: 1 }, chains: {}, paint: spec(0, 0, 1) }] };
    expect(() => bake([wrong], renderer)).toThrow(/room: cycles \{"m":1\} with chains \{\} miss 2 pixels/);
  });

  it("leaves out a cycle that never changes the frame", () => {
    const still = bake([{ ...added, cycles: { m: { rate: 4, steps: [spec(0), spec(0)] } }, cycleChecks: [] }], renderer);
    expect(rec(still, "room").cycles).toBeUndefined();
  });

  it("refuses an alternative whose soft step fails, rather than drop the frame's soft furniture", () => {
    const soft = (fails: number): Renderer => ({
      ...renderer,
      renderSoft: (p, w, h) => {
        if (p.p === "solid" && p.css.startsWith(`x:${fails}:`)) throw new LayerError("soft pass failed");
        const img = paintRoom(p, w, h, true);
        const wall = paintRoom(p, w, h, false);
        for (let i = 0; i < img.data.length; i += 4) if (img.data[i] === wall.data[i]) img.data.fill(0, i, i + 4);
        return img;
      },
    });
    const ok = bake([added, other], soft(9));
    expect(rec(ok, "room").layers!.soft).not.toBeUndefined();
    expect(rec(ok, "room").layers!.chains!.exact.soft).not.toBeUndefined();
    expect(() => bake([added, other], soft(3))).toThrow(/room: chain exact step 3: an alternative chain's soft step fails/);
  });

  it("splits at most one chain besides its alternatives", () => {
    const two = { ...added, chains: { ...added.chains, more: { input: "more", steps: [spec(0), spec(1)] } } };
    expect(() => bake([two], renderer)).toThrow(/depth layers need at most one chain/);
  });

  it("flags an alternative that names no chain, or another alternative", () => {
    const b = buildArchive(after, info, undefined, 8);
    const room = b.manifest.frames.room;
    room.chains!.exact.alternativeTo = "nope";
    expect(checkLayers(b)).toEqual(["room"]);
    room.chains!.exact.alternativeTo = "people";
    room.chains!.people.alternativeTo = "exact";
    expect(checkLayers(b)).toContain("room");
  });
});
