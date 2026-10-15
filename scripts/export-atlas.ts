/**
 * Export the game's procedural sprite art as a scaled texture atlas any
 * frontend on the open engine can load (issue #909). Usage:
 *
 *   npx tsx scripts/export-atlas.ts [--out dist-atlas] [--filter room/office] [--label <tag>]
 *
 * The art is baked ONCE at the canonical size in a real Chromium, then scaled
 * to 2x and 4x by nearest neighbor (the draw routines are not scale-faithful,
 * #812 and #813, so the art is never redrawn larger). The release copy must be
 * baked in the pinned Playwright image (`mcr.microsoft.com/playwright:v<lockfile
 * playwright version>-jammy`, the one the screenshot workflows use); a host
 * browser is fine for a preview but rasterizes differently. The bake launches
 * Playwright's own Chromium, the same binary the e2e comparison uses; set
 * PW_CHROME only to point a local preview at another browser.
 *
 * Before writing, it checks the atlas against the game's own paint for the
 * sample signatures in `src/render/atlas/samples.ts` (flat, and through each
 * room's depth layers) and stops on any mismatch. After packing it checks that
 * every image comes back out of the pages, that every room's depth layers,
 * read back from the pages, give back its flat frame at every occupant count,
 * and that the soft furniture stays within rounding of it. Writes
 * `<out>/verticopolis-atlas-<label or version>.zip` and a `.sha256` beside it
 * (`verticopolis-atlas-preview.zip` for a `--filter` run, which skips the
 * sample check).
 * Nothing it writes is committed. The archive layout and manifest schema are
 * documented in docs/atlas.md.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { bundleBake } from "./atlas-bundle.ts";
import { iconSvg } from "./app-icon-svg.mjs";
import { LOBBY_VARIANTS } from "../src/render/sprites";
import { buildArchive, checkLayers, checkPages, kindsWithoutFurniture, SOFT_DRIFT_LIMIT, softLayerDrift } from "../src/render/atlas/archive";
import type { BakeResult } from "../src/render/atlas/bake";
import type { Image } from "../src/render/atlas/pixels";

const root = resolve(import.meta.dirname, "..");

const FLAGS = new Set(["--out", "--filter", "--label"]);

/** The app icon for other frontends: the mark's SVG (full bleed and inside the
 *  maskable safe zone) and the committed PNGs the web app ships. */
function appIcons(root: string): Record<string, Uint8Array> {
  const icons: Record<string, Uint8Array> = {
    "icon.svg": new TextEncoder().encode(iconSvg(1024, false) + "\n"),
    "icon-maskable.svg": new TextEncoder().encode(iconSvg(1024, true) + "\n"),
  };
  for (const name of ["icon-1024x1024.png", "pwa-512x512.png", "pwa-maskable-512x512.png", "pwa-192x192.png", "apple-touch-icon.png", "favicon.png"]) {
    icons[name] = new Uint8Array(readFileSync(join(root, "src/public", name)));
  }
  return icons;
}

/** Every argument must be one of {@link FLAGS} followed by its value; the
 *  `--flag=value` form, unknown flags and a repeated flag are refused so
 *  nothing is silently ignored. */
function checkArgs(argv: readonly string[]): void {
  const seen = new Set<string>();
  for (let i = 0; i < argv.length; i += 2) {
    if (!FLAGS.has(argv[i])) throw new Error(`unknown argument ${argv[i]} (use ${[...FLAGS].join(", ")}, each followed by its value)`);
    if (seen.has(argv[i])) throw new Error(`${argv[i]} given twice`);
    seen.add(argv[i]);
  }
}

/** A `--name value` argument. A missing, empty or flag-shaped value is an
 *  error rather than a silent default. */
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return undefined;
  const v = process.argv[i + 1];
  if (v === undefined || v === "" || v.startsWith("--")) throw new Error(`--${name} needs a value`);
  return v;
}

/** Most base64 bytes one page.evaluate hands back (well under the DevTools
 *  message and string limits). */
const TRANSFER_BYTES = 32 * 1024 * 1024;

/** The suggested attribution line, read from ASSETS-LICENSE.md. */
function attributionLine(license: string): string {
  const lines = license.split("\n");
  const at = lines.findIndex((l) => l.startsWith("Suggested attribution"));
  const quote: string[] = [];
  for (let i = at + 1; i < lines.length; i++) {
    const l = lines[i].trim();
    if (l.startsWith(">")) quote.push(l.replace(/^>\s?/, ""));
    else if (quote.length > 0) break;
  }
  if (at < 0 || quote.length === 0) throw new Error("ASSETS-LICENSE.md has no suggested attribution block");
  return quote.join(" ").replace(/\s+/g, " ").trim();
}

/** The commit the working tree is checked out at, from git. In CI a failure
 *  is fatal: the archive must never name a commit it was not built from. */
function gitCommit(): string {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  } catch (e) {
    if (process.env.CI) throw new Error(`cannot read the commit from git: ${String(e)}`);
    return "unknown";
  }
}

function decode(b64: string, w: number, h: number, what: string): Uint8ClampedArray {
  const data = new Uint8ClampedArray(Buffer.from(b64, "base64"));
  if (data.length !== w * h * 4) throw new Error(`${what}: got ${data.length} bytes for ${w} x ${h}`);
  return data;
}

async function main(): Promise<void> {
  checkArgs(process.argv.slice(2));
  const outDir = resolve(root, arg("out") ?? "dist-atlas");
  const filter = arg("filter");
  // The release tag names the archive when the workflow builds one; a local
  // run falls back to the package version.
  const label = arg("label")?.replace(/[^A-Za-z0-9._-]+/g, "-");
  if (label !== undefined && !/[A-Za-z0-9]/.test(label)) throw new Error(`--label ${label} names nothing`);
  if (label !== undefined && filter !== undefined) throw new Error("--label names a release archive; a --filter run is a preview");
  const t0 = Date.now();
  const code = await bundleBake();
  console.log(`bundled the bake (${(code.length / 1024).toFixed(0)} KiB)`);
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined });
  let bakeResult: BakeResult;
  try {
    const page = await browser.newPage();
    await page.setContent("<!doctype html><html><body></body></html>");
    await page.addScriptTag({ content: code });
    // Pre-flight: the atlas must reproduce the game's paint for every sample
    // signature before anything is written.
    // A filtered preview skips it and is named as a preview.
    if (!filter) {
      const checks: { label: string; mismatches: number; control?: boolean }[] = await page.evaluate(() => (globalThis as any).__vcAtlas.verify());
      // A control case compares two different pictures on purpose; it must
      // report a mismatch, or the comparison itself is broken.
      const bad = checks.filter((c) => (c.control ? c.mismatches === 0 : c.mismatches > 0));
      if (bad.length > 0) throw new Error(`atlas does not match the game's paint:\n${JSON.stringify(bad, null, 1)}`);
      const layeredChecks = checks.filter((c) => c.label.endsWith("(depth layers)")).length;
      if (layeredChecks === 0) throw new Error("pre-flight: no sample was composed through its depth layers");
      console.log(`pre-flight: ${checks.length} sample paints match the game (${layeredChecks} through depth layers)`);
    }
    const summary = await page.evaluate((f) => (globalThis as any).__vcAtlas.run(f), filter);
    if (summary.frames === 0) throw new Error(`--filter ${filter} matches no frame`);
    console.log(`baked ${summary.frames} frames, ${summary.animations} animations, ${summary.images} unique images`);
    const dropped: string[] = summary.softDropped;
    console.log(`soft furniture: left out of ${dropped.length} layered frames where an occupant step cannot be drawn over it or the soft pass failed${dropped.length > 0 ? `: ${dropped.slice(0, 5).join(", ")}${dropped.length > 5 ? ", ..." : ""}` : ""}`);
    const records = await page.evaluate(() => (globalThis as any).__vcAtlas.records());
    const images: Image[] = [];
    const normals: Image[] = [];
    while (images.length < summary.images) {
      const got: { w: number; h: number; b64: string; normal: string }[] = await page.evaluate(
        ([from, bytes]) => (globalThis as any).__vcAtlas.images(from, bytes),
        [images.length, TRANSFER_BYTES],
      );
      for (const g of got) {
        const id = images.length;
        images.push({ w: g.w, h: g.h, data: decode(g.b64, g.w, g.h, `image ${id}`) });
        normals.push({ w: g.w, h: g.h, data: decode(g.normal, g.w, g.h, `normal ${id}`) });
      }
    }
    bakeResult = { ...records, images, normals };
  } finally {
    await browser.close();
  }

  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version: string };
  const licenseText = readFileSync(join(root, "ASSETS-LICENSE.md"), "utf8");
  const archive = buildArchive(
    bakeResult,
    { version: pkg.version, commit: gitCommit(), attribution: attributionLine(licenseText), licenseText, icons: appIcons(root) },
    (msg) => console.log(msg),
  );
  // Every image must come back out of the pages it was packed into.
  const misplaced = checkPages(bakeResult, archive);
  if (misplaced.length > 0) throw new Error(`images do not round-trip through the pages: ${misplaced.slice(0, 10).join(", ")}`);
  // Every room's shell plus its furniture must give back its flat frame.
  const split = checkLayers(archive);
  if (split.length > 0) throw new Error(`depth layers do not compose back to their frames: ${split.slice(0, 10).join(", ")}`);
  // A shell that still shows the furniture also composes back, so every kind
  // that splits must have furniture somewhere. That holds across the whole
  // catalog only, so a --filter preview skips it.
  const unsplit = filter ? [] : kindsWithoutFurniture(archive.manifest);
  if (unsplit.length > 0) throw new Error(`depth layers hold no furniture for ${unsplit.join(", ")}: the shell kept it`);
  // The lobby shares one kind across its tiles and entrances, so check those
  // frame by frame: every one splits, and every one but the sconce and print
  // tile (the last variant, wall pieces only) has furniture in front of its wall.
  const lastVariant = `/v${LOBBY_VARIANTS - 1}`;
  const bareLobby = Object.entries(archive.manifest.frames)
    .filter(([name]) => name.startsWith("structure/lobby/") || name.startsWith("structure/entrance/"))
    .filter(([name, f]) => !f.layers || (f.layers.furniture.length === 0 && !name.endsWith(lastVariant)))
    .map(([name]) => name);
  if (bareLobby.length > 0) throw new Error(`lobby frames without depth furniture: ${bareLobby.slice(0, 10).join(", ")}`);
  // The cabs and the train carry their riders inside: each has a front.
  const openVehicles = Object.entries(archive.manifest.frames)
    .filter(([name]) => name.startsWith("car/") || name.startsWith("vehicle/metrotrain/"))
    .filter(([, f]) => !f.layers?.front || f.layers.front.length === 0)
    .map(([name]) => name);
  if (openVehicles.length > 0) throw new Error(`vehicle frames without a front: ${openVehicles.slice(0, 10).join(", ")}`);
  const layered = Object.values(archive.manifest.frames).filter((f) => f.layers).length;
  console.log(`depth layers: ${layered} frames (rooms at every occupant count, lobby tiles, entrances, cabs and the metro train) compose back to their flat frames`);
  // The soft furniture is close to the flat frame but rounds differently;
  // report how far it strays, and stop if it strays further than rounding.
  const drift = softLayerDrift(archive);
  const share = drift.pixels > 0 ? ((100 * drift.differing) / drift.pixels).toFixed(2) : "0";
  console.log(`soft furniture: ${drift.frames} frames, ${drift.pictures} pictures; ${share}% of its pixels differ from the flat frame, by at most ${drift.maxDelta} of 255`);
  // A soft pass that broke everywhere would leave nothing to measure.
  if (!filter && layered > 0 && drift.frames === 0) throw new Error("no layered frame kept its soft furniture");
  if (drift.outside > 0) throw new Error(`soft furniture misses ${drift.outside} pixels where the flat frame differs from the shell (first in ${drift.worst})`);
  if (drift.maxDelta > SOFT_DRIFT_LIMIT) throw new Error(`soft furniture strays ${drift.maxDelta} of 255 from the flat frame in ${drift.worst}, past the limit of ${SOFT_DRIFT_LIMIT}`);
  mkdirSync(outDir, { recursive: true });
  const name = filter ? "verticopolis-atlas-preview.zip" : `verticopolis-atlas-${label ?? pkg.version}.zip`;
  writeFileSync(join(outDir, name), archive.zip);
  const sha = createHash("sha256").update(archive.zip).digest("hex");
  writeFileSync(join(outDir, `${name}.sha256`), `${sha}  ${name}\n`);
  console.log(`wrote ${join(outDir, name)} (${(archive.zip.length / 1048576).toFixed(1)} MiB) sha256 ${sha}`);
  console.log(`done in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
