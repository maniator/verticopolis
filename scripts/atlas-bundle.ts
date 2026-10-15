/**
 * Bundle the atlas bake's browser half (`src/render/atlas/browserEntry.ts`)
 * into one IIFE string a page can run, without touching the game's own build.
 * Shared by `scripts/export-atlas.ts` and the e2e comparison spec.
 */
import { join, resolve } from "node:path";
import { build } from "vite";

const root = resolve(import.meta.dirname, "..");

/** Bundle the browser half of the bake into one IIFE string. */
export async function bundleBake(): Promise<string> {
  const out = await build({
    configFile: false,
    root,
    logLevel: "warn",
    build: {
      write: false,
      minify: false,
      target: "es2020",
      lib: { entry: join(root, "src/render/atlas/browserEntry.ts"), formats: ["iife"], name: "VcAtlasBake", fileName: () => "atlas.js" },
    },
  });
  const outputs = Array.isArray(out) ? out : [out];
  for (const o of outputs) {
    if ("output" in o) {
      const chunk = o.output.find((c) => c.type === "chunk");
      if (chunk && chunk.type === "chunk") return chunk.code;
    }
  }
  throw new Error("vite produced no bundle");
}

