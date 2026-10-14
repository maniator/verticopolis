import { readdirSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { AUDIO_ENGINE_CHUNK, AUDIO_RUNTIME_FILES } from "./audioAssets";

/**
 * AUDIO_RUNTIME_FILES is what scripts/verify-precache.ts checks against the
 * service worker's manifest, so the offline PWA (#985) plays every sound only
 * if the list is complete. These tests fail when a sound file ships, or the
 * source names one, without being listed.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, "..");
const PUBLIC_AUDIO = resolve(SRC, "public", "audio");
const AUDIO_EXT = /\.(?:mp3|ogg|wav|m4a|flac|aac|opus|webm|json)$/i;

/** Every regular file under `dir`, recursively, as paths relative to it. */
function filesUnder(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => relative(dir, resolve(e.parentPath, e.name)).split("\\").join("/"));
}

describe("AUDIO_RUNTIME_FILES", () => {
  it("lists exactly the sound files in src/public/audio/", () => {
    const shipped = filesUnder(PUBLIC_AUDIO)
      .filter((f) => !f.split("/").some((part) => part.startsWith(".")) && AUDIO_EXT.test(f))
      .map((f) => `audio/${f}`)
      .sort();
    expect([...AUDIO_RUNTIME_FILES].sort()).toEqual(shipped);
  });

  it("covers every audio file path the source names, and the source builds none", () => {
    const named = new Set<string>();
    const built: string[] = [];
    for (const f of filesUnder(SRC)) {
      if (!/\.tsx?$/.test(f) || /\.test\.tsx?$/.test(f) || f === "audio/audioAssets.ts" || f.endsWith(".d.ts")) continue;
      const text = readFileSync(resolve(SRC, f), "utf8");
      // A module import ("./audio/x.json") is bundled, never fetched; skip it.
      for (const m of text.matchAll(/(?<!\.\/|\.\.\/)audio\/[\w./-]+\.(?:mp3|ogg|wav|m4a|flac|aac|opus|webm|json)\b/gi)) named.add(m[0]);
      // A path assembled at run time (`${base}audio/${name}.mp3`, or
      // "audio/" + name) can't be checked against the list; name the file in
      // audioAssets.ts instead. Paths spread over constants or `new URL` are
      // beyond a text scan; the src/public/audio/ test above still covers
      // every file shipped there.
      if (/`[^`]*audio\/[^`]*\$\{[^`]*`|["']audio\/["']\s*\+/.test(text)) built.push(f);
    }
    expect([...named].filter((p) => !AUDIO_RUNTIME_FILES.includes(p))).toEqual([]);
    expect(built).toEqual([]);
  });

  it("holds only file types the workbox glob precaches", () => {
    // An audio file whose extension vite.config.ts's globPatterns leaves out
    // would never be precached (verify-precache.ts would then fail the build).
    const config = readFileSync(resolve(SRC, "..", "vite.config.ts"), "utf8");
    const glob = /globPatterns:\s*\["\*\*\/\*\.\{([\w,]+)\}"\]/.exec(config);
    expect(glob, "vite.config.ts globPatterns changed shape; update this test").not.toBeNull();
    const exts = new Set(glob![1].toLowerCase().split(","));
    for (const f of AUDIO_RUNTIME_FILES) expect(exts.has(f.slice(f.lastIndexOf(".") + 1).toLowerCase()), f).toBe(true);
  });
});

describe("AUDIO_ENGINE_CHUNK", () => {
  it("matches the lazy Tone chunk's built name and nothing else", () => {
    expect(AUDIO_ENGINE_CHUNK.test("assets/ToneAudioEngine-Bq3x9a1Z.js")).toBe(true);
    expect(AUDIO_ENGINE_CHUNK.test("assets/main-Bq3x9a1Z.js")).toBe(false);
    expect(AUDIO_ENGINE_CHUNK.test("assets/ToneAudioEngine-Bq3x9a1Z.js.map")).toBe(false);
  });
});
