import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { buildArchive, signature, ARCHIVE_ROOT } from "./archive";
import { bake, ImageStore, type Renderer } from "./bake";
import type { Job } from "./catalog";
import type { PaintSpec } from "./paint";
import { blank, sameImage, type Image } from "./pixels";
import { blit } from "./raster";
import { compareImages, composeFrame, composeLookup } from "./compose";
import type { Placed } from "./schema";
import { ATLAS_SCALES, ATLAS_SCHEMA_VERSION } from "./schema";

/** A fake renderer: a person spec paints a w x h opaque block whose color is
 *  its fill's first byte; a car spec paints one opaque pixel per rider. */
const fake: Renderer = {
  render(spec: PaintSpec, w: number, h: number): Image {
    const img = blank(w, h);
    if (spec.p === "car") {
      for (let r = 0; r < Math.min(spec.riders, w); r++) img.data.set([200, 0, 0, 255], r * 4);
      return img;
    }
    if (spec.p === "solid") {
      if (spec.css === "clear") return img;
      for (let i = 0; i < w * h; i++) img.data.set([Number(spec.css), 0, 0, 255], i * 4);
      if (spec.css === "haze") img.data.set([0, 0, 0, 40], 0);
      return img;
    }
    throw new Error(`fake renderer: ${spec.p}`);
  },
};

const solid = (css: string): PaintSpec => ({ p: "solid", css });
const car = (riders: number): PaintSpec => ({ p: "car", kind: "elevatorStandard", seed: 0, riders, arrow: null, full: false });

describe("bake", () => {
  const jobs: Job[] = [
    { type: "still", name: "a", w: 2, h: 2, anchor: { x: 0, y: 0 }, keys: {}, paint: solid("9") },
    { type: "still", name: "b", w: 2, h: 2, anchor: { x: 0, y: 0 }, keys: {}, paint: solid("9") },
    { type: "still", name: "empty", w: 2, h: 2, anchor: { x: 0, y: 0 }, keys: {}, paint: solid("clear") },
    {
      type: "still",
      name: "cab",
      w: 4,
      h: 1,
      anchor: { x: 0, y: 0 },
      keys: {},
      paint: car(0),
      chains: { riders: { input: "riders", steps: [car(0), car(1), car(2), car(2), car(9), car(9)] } },
      overlays: { same: car(0), one: car(1) },
    },
    { type: "anim", name: "loop", w: 1, h: 1, anchor: { x: 0, y: 0 }, keys: { k: 1 }, dt: 0.5, loop: true, frames: [solid("1"), solid("2")] },
  ];
  const r = bake(jobs, fake);

  it("deduplicates identical pixels and skips empty frames", () => {
    const a = r.frames.find((f) => f.name === "a")!;
    const b = r.frames.find((f) => f.name === "b")!;
    expect(a.image!.id).toBe(b.image!.id);
    expect(r.frames.find((f) => f.name === "empty")!.image).toBeNull();
  });
  it("chains layers step by step, nulls unchanged steps and trims the tail", () => {
    const cab = r.frames.find((f) => f.name === "cab")!;
    const steps = cab.chains!.riders.steps;
    expect(steps.length).toBe(5); // 0..4: the last step (9 again) changes nothing
    expect(steps[0]).toBeNull();
    expect(steps[1]).toMatchObject({ dx: 0, dy: 0 });
    expect(steps[2]).toMatchObject({ dx: 1 });
    expect(steps[3]).toBeNull();
    expect(steps[4]).toMatchObject({ dx: 2 });
    expect(cab.overlays).toEqual({ same: null, one: { id: steps[1]!.id, dx: 0, dy: 0 } });
  });
  it("names animation frames in play order", () => {
    expect(r.animations).toEqual([{ name: "loop", dt: 0.5, loop: true, keys: { k: 1 }, frames: ["loop/0", "loop/1"] }]);
    expect(r.frames.find((f) => f.name === "loop/1")!.keys).toEqual({ k: 1, frame: 1 });
  });
  it("refuses duplicate names and names the job a bad layer came from", () => {
    expect(() => bake([jobs[0], jobs[0]], fake)).toThrow(/duplicate frame name a/);
    const bad: Job = { ...(jobs[0] as Job & { type: "still" }), name: "hazy", overlays: { h: solid("haze") } };
    expect(() => bake([bad], fake)).toThrow(/hazy: diffLayer/);
  });
  it("reports progress", () => {
    const seen: number[] = [];
    bake(jobs.slice(0, 2), fake, (done) => seen.push(done));
    expect(seen).toEqual([0, 1, 2]);
  });
  it("store returns the same id for equal content", () => {
    const s = new ImageStore();
    expect(s.add(blank(1, 1), blank(1, 1))).toBe(s.add(blank(1, 1), blank(1, 1)));
    expect(s.layer(null, blank(1, 1))).toBeNull();
    expect(s.ref(blank(2, 2))).toBeNull();
  });

  it("archives into a deterministic zip with pages per scale, a manifest and the attribution", () => {
    const info = { version: "9.9.9", commit: "abc", attribution: "Art by someone, CC BY 4.0.", licenseText: "# License\n" };
    const a = buildArchive(r, info, undefined, 32);
    expect(buildArchive(r, info, undefined, 32).zip).toEqual(a.zip);
    const files = unzipSync(a.zip);
    const names = Object.keys(files);
    expect(names).toContain(`${ARCHIVE_ROOT}/manifest.json`);
    expect(strFromU8(files[`${ARCHIVE_ROOT}/ATTRIBUTION.txt`])).toContain("Art by someone, CC BY 4.0.");
    expect(strFromU8(files[`${ARCHIVE_ROOT}/ASSETS-LICENSE.md`])).toBe("# License\n");
    for (const s of ATLAS_SCALES) {
      expect(names).toContain(`${ARCHIVE_ROOT}/${s}x/page-000.png`);
      expect(names).toContain(`${ARCHIVE_ROOT}/${s}x/page-000.normal.png`);
    }
    const m = JSON.parse(strFromU8(files[`${ARCHIVE_ROOT}/manifest.json`]));
    expect(m.schema).toBe(ATLAS_SCHEMA_VERSION);
    expect(m.game).toEqual({ version: "9.9.9", commit: "abc" });
    expect(m.signature).toEqual(signature());
    expect(m.frames.cab.chains.riders.max).toBe(4);
    expect(m.frames.empty.parts).toEqual([]);
    expect(m.animations.loop.frames).toEqual(["loop/0", "loop/1"]);
    expect(m.data.skyColors).toHaveLength(24);
    expect(m.pageSize).toBe(32);
  });
  it("the packed pages and the manifest give back every frame and layer pixel for pixel", () => {
    const info = { version: "1", commit: "x", attribution: "a", licenseText: "" };
    const wide: Job = { type: "still", name: "wide", w: 70, h: 1, anchor: { x: 0, y: 0 }, keys: {}, paint: solid("7") };
    const r2 = bake([...jobs, wide], fake);
    const a = buildArchive(r2, info, undefined, 32);
    const fromPages = (p: Placed, w: number, h: number): Image => {
      const out = blank(w, h);
      blit(out, a.pages[p.rect.page], p.rect.x, p.rect.y, p.rect.w, p.rect.h, p.dx, p.dy);
      return out;
    };
    for (const f of r2.frames) {
      const rec = a.manifest.frames[f.name];
      const rebuilt = blank(f.w, f.h);
      for (const p of rec.parts) blit(rebuilt, a.pages[p.rect.page], p.rect.x, p.rect.y, p.rect.w, p.rect.h, p.dx, p.dy);
      expect(sameImage(rebuilt, composeFrame(r2, f)), f.name).toBe(true);
      for (const [k, c] of Object.entries(rec.chains ?? {})) {
        c.steps.forEach((p, i) => {
          const ref = f.chains![k].steps[i];
          if (!p || !ref) return expect(p).toBe(ref);
          const want = blank(f.w, f.h);
          blit(want, r2.images[ref.id], 0, 0, r2.images[ref.id].w, r2.images[ref.id].h, ref.dx, ref.dy);
          expect(sameImage(fromPages(p, f.w, f.h), want)).toBe(true);
        });
      }
    }
    expect(a.manifest.frames.wide.parts.length).toBe(3); // sliced across a 32 px page
  });
  it("composes lookups and reports mismatches", () => {
    const cab = r.frames.find((f) => f.name === "cab")!;
    const two = composeFrame(r, cab, { riders: 2 }, ["one"]);
    expect(two.data[4 + 3]).toBe(255);
    expect(two.data[8 + 3]).toBe(0);
    expect(() => composeFrame(r, cab, { nope: 1 })).toThrow(/no chain nope/);
    expect(() => composeFrame(r, cab, {}, ["nope"])).toThrow(/no overlay nope/);
    expect(composeLookup(r, { frame: "cab", chains: { riders: 9 }, overlays: [] }).name).toBe("cab");
    expect(composeLookup(r, { animation: "loop" }, 1).name).toBe("loop/1");
    expect(() => composeLookup(r, { frame: "nope", chains: {}, overlays: [] })).toThrow(/no frame nope/);
    expect(compareImages(two, two)).toEqual({ mismatches: 0, box: undefined });
    expect(compareImages(two, blank(4, 1))).toMatchObject({ mismatches: 2, box: { x0: 0, x1: 1 } });
    expect(compareImages(two, blank(2, 1)).mismatches).toBe(4);
  });
  it("refuses a layer too wide for one page", () => {
    const wide: Job = { type: "still", name: "w", w: 60, h: 1, anchor: { x: 0, y: 0 }, keys: {}, paint: car(0), overlays: { o: car(60) } };
    const info = { version: "1", commit: "x", attribution: "a", licenseText: "" };
    expect(() => buildArchive(bake([wide], fake), info, undefined, 32)).toThrow(/layers must fit one page/);
  });
});
