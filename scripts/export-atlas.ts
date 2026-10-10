/**
 * Export the game's procedural sprite art as a scaled texture atlas any
 * frontend on the open engine can load (issue #909). Usage:
 *
 *   npx tsx scripts/export-atlas.ts [--out dist-atlas] [--filter room/office]
 *
 * The art is baked ONCE at the canonical size in a real Chromium, then scaled
 * to 2x and 4x by nearest neighbor (the draw routines are not scale-faithful,
 * #812 and #813, so the art is never redrawn larger). The release copy must be
 * baked in the pinned Playwright image (`mcr.microsoft.com/playwright:v<lockfile
 * playwright version>-jammy`, the one the screenshot workflows use); a host
 * browser is fine for a preview but rasterizes differently. Set PW_CHROME to
 * the browser binary to override Playwright's own.
 *
 * Writes `<out>/verticopolis-atlas-<version>.zip` and a `.sha256` beside it.
 * Nothing it writes is committed. The archive layout and manifest schema are
 * documented in docs/atlas.md.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { bundleBake } from "./atlas-bundle.ts";
import { buildArchive } from "../src/render/atlas/archive";
import type { BakeResult } from "../src/render/atlas/bake";
import type { Image } from "../src/render/atlas/pixels";

const root = resolve(import.meta.dirname, "..");

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

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

function gitCommit(): string {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

async function main(): Promise<void> {
  const outDir = resolve(root, arg("out") ?? "dist-atlas");
  const filter = arg("filter");
  const t0 = Date.now();
  const code = await bundleBake();
  console.log(`bundled the bake (${(code.length / 1024).toFixed(0)} KiB)`);
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined });
  let bakeResult: BakeResult;
  try {
    const page = await browser.newPage();
    await page.setContent("<!doctype html><html><body></body></html>");
    await page.addScriptTag({ content: code });
    const summary = await page.evaluate((f) => (globalThis as any).__vcAtlas.run(f), filter);
    console.log(`baked ${summary.frames} frames, ${summary.animations} animations, ${summary.images} unique images`);
    const records = await page.evaluate(() => (globalThis as any).__vcAtlas.records());
    const images: Image[] = [];
    const CHUNK = 400;
    for (let from = 0; from < summary.images; from += CHUNK) {
      const got: { w: number; h: number; b64: string }[] = await page.evaluate(
        ([a, b]) => (globalThis as any).__vcAtlas.images(a, b),
        [from, Math.min(summary.images, from + CHUNK)],
      );
      for (const g of got) images.push({ w: g.w, h: g.h, data: new Uint8ClampedArray(Buffer.from(g.b64, "base64")) });
    }
    bakeResult = { images, frames: records.frames, animations: records.animations };
  } finally {
    await browser.close();
  }

  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version: string };
  const licenseText = readFileSync(join(root, "ASSETS-LICENSE.md"), "utf8");
  const archive = buildArchive(
    bakeResult,
    { version: pkg.version, commit: gitCommit(), attribution: attributionLine(licenseText), licenseText },
    (msg) => console.log(msg),
  );
  mkdirSync(outDir, { recursive: true });
  const name = `verticopolis-atlas-${pkg.version}.zip`;
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
