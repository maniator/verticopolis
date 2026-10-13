import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { buildArchive, checkLayers, checkPages, kindsWithoutFurniture, signature, softLayerDrift, ARCHIVE_ROOT } from "./archive";
import { bake, ImageStore, type Renderer } from "./bake";
import type { Job } from "./catalog";
import type { PaintSpec } from "./paint";
import { blank, sameImage, type Image } from "./pixels";
import { blit } from "./raster";
import { compareImages, composeFrame, composeLayered, composeLookup } from "./compose";
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
    expect(m.data.skyColors).toHaveLength(96);
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
    expect(checkPages(r2, a)).toEqual([]);
    // A page pixel knocked out of place is caught.
    const p0 = a.placements[0][0].rect;
    a.pages[p0.page].data[(p0.y * 32 + p0.x) * 4] ^= 1;
    expect(checkPages(r2, a)).toEqual([0]);
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

/** A fake room for the depth split: spec `room:<shell>:<furniture>[:haze]`
 *  paints a w x h block in the shell color, then its last pixel in the
 *  furniture color (translucent with `haze`); its shell pass is the block. */
const room = (shell: number, furniture: number, haze = false): PaintSpec => ({ p: "solid", css: `room:${shell}:${furniture}${haze ? ":haze" : ""}` });
function roomPixels(spec: PaintSpec, w: number, h: number, withFurniture: boolean): Image | null {
  if (spec.p !== "solid" || !spec.css.startsWith("room:")) return null;
  const [, a, b, haze] = spec.css.split(":");
  const img = blank(w, h);
  for (let i = 0; i < w * h; i++) img.data.set([Number(a), 0, 0, 255], i * 4);
  if (withFurniture) img.data.set([Number(b), 0, 0, haze ? 40 : 255], (w * h - 1) * 4);
  return img;
}
const layeredFake: Renderer = {
  render: (spec, w, h) => roomPixels(spec, w, h, true) ?? fake.render(spec, w, h),
  renderShell: (spec, w, h) => roomPixels(spec, w, h, false),
};
const flatFake: Renderer = { render: layeredFake.render };

describe("depth layers", () => {
  const still = (name: string, paint: PaintSpec, layers = true): Job => ({ type: "still", name, w: 4, h: 2, anchor: { x: 0, y: 0 }, keys: {}, paint, layers });
  const jobs: Job[] = [
    still("r1", room(5, 6)),
    still("plain", solid("3")),
    still("r2", room(5, 6)),
    still("same", room(9, 9)),
    still("unasked", room(7, 8), false),
    {
      type: "still",
      name: "cab",
      w: 4,
      h: 1,
      anchor: { x: 0, y: 0 },
      keys: {},
      paint: car(0),
      chains: { riders: { input: "riders", steps: [car(0), car(1), car(2)] } },
      layers: true,
    },
  ];
  const layered = bake(jobs, layeredFake);
  const flat = bake(jobs, flatFake);
  const info = { version: "1", commit: "x", attribution: "a", licenseText: "" };
  const byName = (r: typeof layered, n: string) => r.frames.find((f) => f.name === n)!;

  it("splits only frames that ask for it and whose paint marks a break", () => {
    expect(layered.frames.filter((f) => f.layers).map((f) => f.name)).toEqual(["r1", "r2", "same"]);
    expect(flat.frames.some((f) => f.layers)).toBe(false);
  });
  it("gives back every layered frame from its shell plus its furniture", () => {
    for (const f of layered.frames.filter((fr) => fr.layers)) expect(sameImage(composeLayered(layered, f), composeFrame(layered, f)), f.name).toBe(true);
    expect(() => composeLayered(layered, byName(layered, "plain"))).toThrow(/no depth layers/);
  });
  it("stores every frame image exactly as a bake without layers does", () => {
    expect(layered.frameImages).toBe(flat.images.length);
    flat.images.forEach((img, i) => expect(sameImage(layered.images[i], img) && sameImage(layered.normals[i], flat.normals[i])).toBe(true));
    layered.frames.forEach((f, i) => {
      const { layers: _layers, ...rest } = f;
      expect(rest).toEqual(flat.frames[i]);
    });
  });
  it("reuses images and keeps its own past the frame images", () => {
    const r1 = byName(layered, "r1").layers!;
    expect(byName(layered, "r2").layers).toEqual(r1);
    expect(r1.shell!.id).toBeGreaterThanOrEqual(layered.frameImages!);
    expect(r1.furniture).toMatchObject({ dx: 3, dy: 1 });
    // A room with no furniture: its shell is its own frame image, reused.
    const same = byName(layered, "same");
    expect(same.layers).toEqual({ shell: same.image, furniture: null });
    expect(same.layers!.shell!.id).toBeLessThan(layered.frameImages!);
  });
  it("names the frame whose furniture cannot compose", () => {
    expect(() => bake([still("hazy", room(5, 6, true))], layeredFake)).toThrow(/hazy: diffLayer/);
  });
  it("packs the layers on pages after the frames' and leaves every frame page and part as it was", () => {
    const a = buildArchive(layered, info, undefined, 32);
    const b = buildArchive(flat, info, undefined, 32);
    expect(a.pages.length).toBeGreaterThan(b.pages.length);
    b.pages.forEach((page, i) => expect(sameImage(a.pages[i], page) && sameImage(a.normalPages[i], b.normalPages[i])).toBe(true));
    for (const [name, rec] of Object.entries(b.manifest.frames)) {
      const { layers, ...rest } = a.manifest.frames[name];
      expect(rest).toEqual(rec);
      for (const p of [...(layers?.shell ?? []), ...(layers?.furniture ?? [])]) {
        if (p.rect.page < b.pages.length) expect(name).toBe("same"); // reused frame image
      }
    }
    expect(a.manifest.frames.r1.layers!.furniture).toHaveLength(1);
    expect(a.manifest.frames.same.layers!.furniture).toEqual([]);
    expect(a.manifest.frames.plain.layers).toBeUndefined();
    expect(checkPages(layered, a)).toEqual([]);
    expect(checkLayers(a)).toEqual([]);
    // A furniture pixel knocked out of place in the pages is caught.
    const p = a.manifest.frames.r1.layers!.furniture[0].rect;
    a.pages[p.page].data[(p.y * 32 + p.x) * 4] ^= 1;
    expect(checkLayers(a)).toEqual(["r1", "r2"]);
  });
  it("names a split kind whose frames never hold furniture", () => {
    const placed = { rect: { page: 0, x: 0, y: 0, w: 1, h: 1 }, dx: 0, dy: 0 };
    const rec = (kind: string, furniture: (typeof placed)[]) => ({ w: 1, h: 1, anchor: { x: 0, y: 0 }, parts: [placed], keys: { kind }, layers: { shell: [placed], furniture } });
    const frames = { a: rec("office", []), b: rec("office", [placed]), c: rec("spa", []), d: { ...rec("shop", []), layers: undefined } };
    expect(kindsWithoutFurniture({ frames })).toEqual(["spa"]);
  });
  it("refuses a frame-image count outside the images", () => {
    expect(() => buildArchive({ ...layered, frameImages: layered.images.length + 1 }, info, undefined, 32)).toThrow(/frameImages/);
  });
});

/** A fake occupied room for the step split: spec `lit:<n>[:fade]` is a 4 x 2
 *  block in color 5 with a glow pixel at (1, 0) and a desk at (3, 1); from
 *  n = 1 the ceiling light at (0, 0) is on, and occupant k sits at (k - 1, 1).
 *  Its shell pass keeps the light; its soft pass paints the desk, the people
 *  and the glow on transparency (with `fade` the glow's alpha follows n, so
 *  the soft steps cannot be drawn source-over). */
const lit = (n: number, fade = false): PaintSpec => ({ p: "solid", css: `lit:${n}${fade ? ":fade" : ""}` });
function litPixels(spec: PaintSpec, pass: "flat" | "shell" | "soft"): Image | null {
  if (spec.p !== "solid" || !spec.css.startsWith("lit:")) return null;
  const [, ns, fade] = spec.css.split(":");
  const n = Number(ns);
  const img = blank(4, 2);
  const at = (x: number, y: number, px: number[]) => img.data.set(px, (y * 4 + x) * 4);
  if (pass !== "soft") for (let i = 0; i < 8; i++) img.data.set([5, 0, 0, 255], i * 4);
  if (pass !== "soft" && n > 0) at(0, 0, [9, 0, 0, 255]);
  if (pass === "shell") return img;
  at(3, 1, [6, 0, 0, 255]);
  for (let k = 1; k <= Math.min(n, 3); k++) at(k - 1, 1, [7, 0, 0, 255]);
  at(1, 0, pass === "soft" ? [200, 0, 0, fade ? 40 + n : 40] : [8, 0, 0, 255]);
  return img;
}
const litFake: Renderer = {
  render: (spec, w, h) => litPixels(spec, "flat") ?? layeredFake.render(spec, w, h),
  renderShell: (spec, w, h) => litPixels(spec, "shell") ?? layeredFake.renderShell!(spec, w, h),
  renderSoft: (spec) => litPixels(spec, "soft"),
};

describe("depth layers on occupant steps", () => {
  const room = (name: string, fade = false): Job => ({
    type: "still",
    name,
    w: 4,
    h: 2,
    anchor: { x: 0, y: 0 },
    keys: { kind: "office" },
    paint: lit(0, fade),
    chains: { occupants: { input: "visibleOccupants", steps: [lit(0, fade), lit(1, fade), lit(2, fade), lit(2, fade)] } },
    layers: true,
  });
  const stats = { softDropped: 0 };
  const r = bake([room("lit"), room("fading", true)], litFake, undefined, stats);
  const info = { version: "1", commit: "x", attribution: "a", licenseText: "" };
  const lit0 = r.frames.find((f) => f.name === "lit")!;

  it("puts a light that switches on with the first occupant on the shell, and the occupants in front", () => {
    const c = lit0.layers!.chains!.occupants;
    expect(c.shell).toHaveLength(2); // only step 1 changes the shell
    expect(c.shell[1]).toMatchObject({ dx: 0, dy: 0 });
    expect(c.furniture).toHaveLength(3); // two occupants, the third step changes nothing
    expect(c.furniture[1]).toMatchObject({ dx: 0, dy: 1 });
    expect(c.furniture[2]).toMatchObject({ dx: 1, dy: 1 });
    expect(c.soft).toHaveLength(3);
  });
  it("gives back the flat frame plus its steps exactly at every occupant count", () => {
    for (let n = 0; n <= 4; n++) {
      expect(sameImage(composeLayered(r, lit0, { occupants: n }), composeFrame(r, lit0, { occupants: n })), `n = ${n}`).toBe(true);
    }
    const a = buildArchive(r, info, undefined, 32);
    expect(checkLayers(a)).toEqual([]);
  });
  it("keeps the soft furniture's glow translucent and close to the flat frame", () => {
    const soft = r.images[lit0.layers!.soft!.id];
    // The glow pixel stays translucent instead of carrying the wall behind it.
    const glow = (1 - lit0.layers!.soft!.dx + (0 - lit0.layers!.soft!.dy) * soft.w) * 4;
    expect(soft.data[glow + 3]).toBe(40);
    expect(() => composeLayered(r, lit0, { occupants: 2 }, [], true)).not.toThrow();
    const drift = softLayerDrift(buildArchive(r, info, undefined, 32));
    expect(drift.frames).toBe(1);
    expect(drift.pictures).toBe(3); // n = 0, 1, 2: the flat chain stops changing at 2
    expect(drift.differing).toBeGreaterThan(0); // the glow pixel: not exact, by design
  });
  it("drops the soft furniture when a step would change a translucent pixel", () => {
    const fading = r.frames.find((f) => f.name === "fading")!;
    expect(fading.layers!.soft).toBeUndefined();
    expect(fading.layers!.chains!.occupants.soft).toBeUndefined();
    expect(stats.softDropped).toBe(1);
    expect(() => composeLayered(r, fading, {}, [], true)).toThrow(/no soft furniture/);
  });
  it("catches an occupant step whose depth split is broken", () => {
    const a = buildArchive(r, info, undefined, 32);
    // The light's shell step is a layer-only image (no flat frame shares it).
    const step = a.manifest.frames.lit.layers!.chains!.occupants.shell[1]!.rect;
    a.pages[step.page].data[(step.y * 32 + step.x) * 4] ^= 1;
    expect(checkLayers(a)).toContain("lit");
  });
});
