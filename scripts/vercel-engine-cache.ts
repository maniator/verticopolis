/**
 * The Vercel preview build's engine package cache (scripts/vercel-build.sh).
 *
 *   node scripts/vercel-engine-cache.ts restore   # exit 0 on a hit, 1 otherwise
 *   node scripts/vercel-engine-cache.ts save
 *
 * The copy lives in node_modules/.cache/vc-engine/, which Vercel's build cache
 * carries from one deployment to the next (scripts/vercel-install.sh keeps it
 * across an `npm ci`). It is keyed on the hash of the Rust sources and the
 * build scripts (src/build/engineCache.ts), the same inputs CI keys its cache
 * on, so a push that leaves the engine alone restores the package and skips
 * installing Rust and compiling it. Only a preview (VERCEL_ENV=preview) uses
 * it: anywhere else restore is a miss and save does nothing, so production
 * builds the engine from source every time.
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { vercelEngineCache } from "../src/build/engineCache.ts";
import { engineSourceHash } from "../src/wasmhost/packageHash.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const command = process.argv[2];
if (command !== "restore" && command !== "save") throw new Error(`expected "restore" or "save", got ${command ?? "nothing"}`);
const result = vercelEngineCache(command, root, process.env, engineSourceHash);
console.log(`vercel-engine-cache: ${result.message}`);
if (command === "restore" && !result.restored) process.exitCode = 1;
