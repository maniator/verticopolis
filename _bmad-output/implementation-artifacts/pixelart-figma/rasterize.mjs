// Rasterize the Figma board tiles locally from their source rect-arrays.
// The tiles are produced by the same use_figma scripts that built the board;
// we mock the Figma plugin API, run each script, collect the rectangles each
// tile frame accumulates, and encode them to PNG with a pure-Node writer.
import zlib from "node:zlib";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Paths resolve relative to this file so the script is portable in the repo.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS = path.join(HERE, "build-scripts");
const OUT = HERE;
const TILES = path.join(OUT, "tiles");
// Recreate tiles/ from scratch each run: if a tile is renamed or removed from the
// build scripts, its old PNG must not linger and get committed by accident.
fs.rmSync(TILES, { recursive: true, force: true });
fs.mkdirSync(TILES, { recursive: true });

// ---- PNG encoder (8-bit RGBA, single IDAT) ----
const CRCT = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRCT[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0); const t = Buffer.from(type, "ascii"); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0); return Buffer.concat([len, t, data, crc]); }
function encodePNG(w, h, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, y * w * 4 + w * 4); }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

// ---- rasterize one tile frame (its collected rectangles) ----
function rasterFrame(frame) {
  const W = Math.max(1, Math.round(frame.width)), H = Math.max(1, Math.round(frame.height));
  const buf = Buffer.alloc(W * H * 4);
  const bg = frame.fills && frame.fills[0] && frame.fills[0].color;
  const br = bg ? Math.round(bg.r * 255) : 12, bgg = bg ? Math.round(bg.g * 255) : 16, bb = bg ? Math.round(bg.b * 255) : 25;
  for (let i = 0; i < W * H; i++) { buf[i * 4] = br; buf[i * 4 + 1] = bgg; buf[i * 4 + 2] = bb; buf[i * 4 + 3] = 255; }
  for (const rc of frame.children) {
    if (rc.type !== "RECTANGLE" || !rc.fills || !rc.fills[0] || !rc.fills[0].color) continue;
    const col = rc.fills[0].color; const a = rc.fills[0].opacity == null ? 1 : rc.fills[0].opacity;
    const cr = col.r * 255, cg = col.g * 255, cb = col.b * 255;
    const x0 = Math.round(rc.x), y0 = Math.round(rc.y), rw = Math.round(rc.width), rh = Math.round(rc.height);
    for (let yy = Math.max(0, y0); yy < Math.min(H, y0 + rh); yy++) {
      for (let xx = Math.max(0, x0); xx < Math.min(W, x0 + rw); xx++) {
        const idx = (yy * W + xx) * 4;
        buf[idx] = Math.round(cr * a + buf[idx] * (1 - a));
        buf[idx + 1] = Math.round(cg * a + buf[idx + 1] * (1 - a));
        buf[idx + 2] = Math.round(cb * a + buf[idx + 2] * (1 - a));
      }
    }
  }
  return { W, H, buf };
}

// ---- composite a page: lay the tiles out in wrapping rows on the board bg ----
function composite(rendered, gap = 18, maxW = 1320, bg = [22, 28, 40]) {
  let x = gap, y = gap, rowH = 0; const placed = [];
  for (const r of rendered) { if (x + r.W + gap > maxW && x > gap) { x = gap; y += rowH + gap; rowH = 0; } placed.push({ r, x, y }); x += r.W + gap; rowH = Math.max(rowH, r.H); }
  const W = maxW, H = y + rowH + gap;
  const buf = Buffer.alloc(W * H * 4);
  for (let i = 0; i < W * H; i++) { buf[i * 4] = bg[0]; buf[i * 4 + 1] = bg[1]; buf[i * 4 + 2] = bg[2]; buf[i * 4 + 3] = 255; }
  for (const p of placed) for (let yy = 0; yy < p.r.H; yy++) for (let xx = 0; xx < p.r.W; xx++) {
    const dx = p.x + xx, dy = p.y + yy; if (dx >= W || dy >= H) continue;
    const s = (yy * p.r.W + xx) * 4, d = (dy * W + dx) * 4;
    buf[d] = p.r.buf[s]; buf[d + 1] = p.r.buf[s + 1]; buf[d + 2] = p.r.buf[s + 2]; buf[d + 3] = 255;
  }
  return { W, H, buf };
}

// ---- mock Figma nodes / API ----
function mkFrame() {
  return {
    type: "FRAME", name: "", x: 0, y: 0, width: 0, height: 0, children: [], fills: [], effects: [], cornerRadius: 0, clipsContent: false, parent: null,
    resize(w, h) { this.width = w; this.height = h; },
    appendChild(n) { n.parent = this; this.children.push(n); },
    remove() { const p = this.parent; if (p) { const i = p.children.indexOf(this); if (i >= 0) p.children.splice(i, 1); } this.parent = null; },
    find(fn) { return this.children.find(fn); },
    findOne(fn) { for (const c of this.children) { if (fn(c)) return c; if (c.findOne) { const r = c.findOne(fn); if (r) return r; } } return null; },
  };
}
function mkRect() { return { type: "RECTANGLE", x: 0, y: 0, width: 0, height: 0, fills: null, parent: null, resize(w, h) { this.width = w; this.height = h; }, appendChild() { }, remove() { const p = this.parent; if (p) { const i = p.children.indexOf(this); if (i >= 0) p.children.splice(i, 1); } } }; }
function mkText() { return { type: "TEXT", characters: "", fontName: null, fontSize: 0, fills: null, x: 0, y: 0, textAutoResize: "", parent: null, resize() { }, appendChild() { }, remove() { const p = this.parent; if (p) { const i = p.children.indexOf(this); if (i >= 0) p.children.splice(i, 1); } } }; }

let ALLFRAMES = [], ROOT = null;
const figma = {
  loadFontAsync: async () => { },
  createPage: () => ({ name: "", appendChild() { } }),
  setCurrentPageAsync: async () => { },
  getNodeByIdAsync: async () => ROOT,
  createFrame: () => { const f = mkFrame(); ALLFRAMES.push(f); return f; },
  createRectangle: () => mkRect(),
  createText: () => mkText(),
};

// SAFETY: runScript compiles and executes each build script via AsyncFunction,
// which is eval-equivalent. It is meant to run ONLY against the build-scripts/
// committed alongside this file on a trusted checkout of this repo. Do not run
// rasterize.mjs on an untrusted branch or an unreviewed PR checkout, and do not
// point SCRIPTS at any directory whose contents you have not reviewed.
const AsyncFunction = Object.getPrototypeOf(async function () { }).constructor;
async function runScript(file) { const code = fs.readFileSync(path.join(SCRIPTS, file), "utf8"); const fn = new AsyncFunction("figma", code); await fn(figma); }
function newRoot(stubs) { ROOT = mkFrame(); ROOT.name = "board"; for (const nm of stubs) { const s = mkFrame(); s.name = nm; ROOT.appendChild(s); } }

const STRUCT = ["art:Floor / Corridor (empty)", "art:Under Construction (state)", "art:Lobby (ground concourse) + grand entrance", "art:Lobby (sky lobby)", "art:Grand Entrance (front + canopy)", "art:Service Entrance (back door)", "art:Standard Entrance", "art:Wedding Hall  ·  16 tiles", "art:Stairway", "art:Escalator", "art:Standard Elevator", "art:Service Elevator", "art:Express Elevator"];
const UTIL = ["art:Recycling", "art:Metro", "art:Medical", "art:Security", "art:Housekeeping"];

const groups = [
  { page: "page-01-utilities-service", scripts: ["page-01-parking-medical-security.build.js", "page-01-parking-ramp.build.js", "page-01-utilities.build.js"], stubs: [...UTIL, "art:ParkingRamp"] },
  { page: "page-02-offices-residential", scripts: ["page-02-offices-residential.build.js"], stubs: [] },
  { page: "page-03-food-entertainment", scripts: ["page-03-food-entertainment.build.js"], stubs: [] },
  { page: "page-04-retail", scripts: ["page-04-retail.build.js"], stubs: [] },
  { page: "page-05-structure-transport", scripts: ["page-05-elevators-standard-service.build.js", "page-05-stairs-escalator.build.js", "page-05-structure.build.js", "page-05-elevator-express.build.js"], stubs: STRUCT },
  { page: "page-08-actors-events", scripts: ["page-08-actors-events.build.js"], stubs: [] },
];

function slug(name) { return name.replace(/^art:|^actor:/, "").replace(/·.*$/, "").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase(); }

const manifest = [];
for (const g of groups) {
  ALLFRAMES = []; newRoot(g.stubs);
  for (const s of g.scripts) { try { await runScript(s); } catch (e) { console.error(`rasterize: ${s} failed: ${e.message}`); throw e; } }
  const cand = ALLFRAMES.filter(f => f.name && (f.name.startsWith("art:") || f.name.startsWith("actor:")) && f.children.some(c => c.type === "RECTANGLE"));
  const byName = new Map(); for (const f of cand) byName.set(f.name, f); // keep-last wins for re-rendered tiles
  const tiles = [...byName.values()];
  const rendered = [];
  const names = [];
  for (const t of tiles) {
    const r = rasterFrame(t); rendered.push(r);
    const sl = slug(t.name);
    const file = `tiles/${g.page.slice(0, 7)}-${sl}.png`;
    fs.writeFileSync(path.join(OUT, file), encodePNG(r.W, r.H, r.buf));
    names.push({ name: t.name.replace(/^art:|^actor:/, "").trim(), file, w: r.W, h: r.H });
  }
  if (rendered.length) { const c = composite(rendered); fs.writeFileSync(path.join(OUT, g.page + ".png"), encodePNG(c.W, c.H, c.buf)); }
  manifest.push({ page: g.page, count: tiles.length, tiles: names });
  console.log(`${g.page}: ${tiles.length} tiles -> ${g.page}.png`);
}
fs.writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2));
console.log("done. total tiles:", manifest.reduce((a, m) => a + m.count, 0));
