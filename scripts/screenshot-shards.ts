/**
 * Shard partition for the screenshot generator's CI capture: the SINGLE source
 * of truth for how update-screenshots.yml splits the work across parallel jobs.
 *
 * The gallery is ~70 shots rendered with no GPU (software raster) in the pinned
 * container, and the determinism guard renders the whole set twice, so a serial
 * regen is slow. Splitting SCENES into a few shards lets the jobs render in
 * parallel (wall-clock drops to roughly one shard's worth).
 *
 * The universe of scene ids is read from the real SCENES, never hand-copied, so
 * a newly added scene cannot silently fall out of coverage: `verify` fails the
 * workflow unless every scene id is in EXACTLY one shard. That coverage check is
 * the guard against the subset-blindness trap (a shot that quietly stops being
 * generated and byte-compared because no shard owns it).
 *
 * Commands:
 *   node scripts/screenshot-shards.ts matrix         -> shard names as a JSON array  (the CI matrix, via fromJSON)
 *   node scripts/screenshot-shards.ts names          -> shard names, space-joined  (human/debug)
 *   node scripts/screenshot-shards.ts print <shard>  -> that shard's scene ids, comma-joined  (ONLY=)
 *   node scripts/screenshot-shards.ts verify         -> exit 0 if coverage is exact, else exit 1
 *
 * The workflow's shard matrix is built from `matrix` (not hand-listed in the
 * YAML) so the set of jobs is derived from this same SHARDS map: a shard added
 * here automatically gets a job, and `verify` still guarantees its scenes are
 * covered. Hand-listing the matrix separately would reopen the subset-blindness
 * trap (a shard whose scenes never render because no job was added for it).
 *
 * Keep this file ERASABLE (type annotations / `as` only; no enums, namespaces,
 * or parameter properties) so `node scripts/screenshot-shards.ts` runs it via
 * native type-stripping, and import siblings with an explicit `.ts` extension.
 */
import { SCENES } from "./screenshot-scenes.ts";

// The partition: explicit scene-id groups, NOT a count/index split. Grouped by
// capture cost so the shards finish together. Cost is dominated by each scene's
// tower BUILD + settle, not by shot count, so the five feature scenes (each its
// own 100-200 unit build, with the two most expensive settles in the gallery:
// `overlays` re-rendering three full-tower heatmaps and `metro` stepping a
// 6-second train settle) used to swamp one `features` shard at ~2.5x the others.
// They are now split across TWO shards: `metro`, the single most expensive scene
// (its 6-second train settle can't be split), gets its own shard, and the other
// four feature scenes share the sibling, so the shards run closer to even (metro
// alone is the practical floor). The remaining
// light scenes (showcase's one build amortized over 13 shots, milestones, and the
// small/route misc scenes) stay grouped. This is the ONLY place the split is
// defined; correctness is enforced by `verify` against SCENES, so a rebalance here
// is safe as long as `verify` still passes. The exact balance is an estimate from
// per-scene structure; confirm it against a CI run and nudge a scene across if a
// shard still lags.
export const SHARDS: Record<string, string[]> = {
  features: ["overlays", "stats", "crash-screen", "basement"],
  metro: ["metro"],
  showcase: ["showcase", "milestones"],
  misc: [
    "mobile",
    "first-run",
    "first-run-mobile",
    "construction",
    "engine",
    "crowd",
    "fire",
    "sprite-gallery",
    "excalibur-preview",
    "preview-rooms",
    "traffic",
    "lobby-awnings",
    "tablet",
  ],
};

function allSceneIds(): string[] {
  return SCENES.map((s) => s.id);
}

// A shard name becomes a shell word (the CI matrix loops `for shard in $(...)`
// and names artifacts `shots-<run>-<shard>`), so it must be a single safe token.
// This is enforced by `verify` at the gate, before any capture, so a rebalance
// that renames a shard to something with a space or quote fails loudly instead of
// silently mis-splitting the matrix.
const SAFE_SHARD_NAME = /^[a-z0-9-]+$/;

/** Every problem with the current partition: a shard whose name is not a safe
 *  shell token, a shard listing an id that no scene has, an id in more than one
 *  shard, or a scene in no shard. Empty when the shard names are safe and the
 *  groups cover every scene id exactly once. */
function coverageErrors(): string[] {
  const errs: string[] = [];
  const universe = new Set(allSceneIds());
  const placed = new Set<string>();
  for (const [shard, ids] of Object.entries(SHARDS)) {
    if (!SAFE_SHARD_NAME.test(shard)) {
      errs.push(`shard name "${shard}" must match ${String(SAFE_SHARD_NAME)} (it is used as a shell token in CI)`);
    }
    for (const id of ids) {
      if (!universe.has(id)) errs.push(`shard "${shard}" lists unknown scene "${id}"`);
      else if (placed.has(id)) errs.push(`scene "${id}" is in more than one shard`);
      placed.add(id);
    }
  }
  for (const id of universe) if (!placed.has(id)) errs.push(`scene "${id}" is in no shard`);
  return errs;
}

function main(): void {
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === "matrix") {
    // JSON array for the workflow's `fromJSON(...)` shard matrix.
    process.stdout.write(JSON.stringify(Object.keys(SHARDS)));
    return;
  }
  if (cmd === "names") {
    process.stdout.write(Object.keys(SHARDS).join(" "));
    return;
  }
  if (cmd === "print") {
    const ids = SHARDS[arg ?? ""];
    if (!ids) {
      console.error(`unknown shard "${arg}". valid shards: ${Object.keys(SHARDS).join(", ")}`);
      process.exit(1);
    }
    process.stdout.write(ids.join(","));
    return;
  }
  if (cmd === "verify") {
    const errs = coverageErrors();
    if (errs.length) {
      // ::error:: on stdout so GitHub surfaces each as an annotation.
      for (const e of errs) console.log(`::error::screenshot shard coverage: ${e}`);
      console.log(
        `shard coverage FAILED (${errs.length} problem(s)): every SCENES id must be in exactly one shard in scripts/screenshot-shards.ts.`,
      );
      process.exit(1);
    }
    console.log(`shard coverage OK: ${allSceneIds().length} scenes across ${Object.keys(SHARDS).length} shards.`);
    return;
  }
  console.error("usage: screenshot-shards.ts (matrix | names | print <shard> | verify)");
  process.exit(1);
}

main();
