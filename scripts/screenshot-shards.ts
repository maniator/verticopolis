/**
 * Shard partition for the screenshot generator's CI capture: the SINGLE source
 * of truth for how screenshot-capture.yml (the reusable capture that
 * pr-drift-check.yml calls) splits the work across parallel jobs.
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
// capture cost so the shards finish together. Now that a settle skips its discarded
// intermediate draws by default, the old poles (metro's 6-second train settle, the
// crowd rush) render in seconds. Drawing every settle frame is a PER-SHOT opt-in
// (the `drawSettle` flag in screenshot-env.ts), so the expensive scenes are the ones
// whose `drawSettle` shots dominate: `tablet` (two viewport-resize shots) and
// `engine` (a live-engine demo). A few other scenes carry `drawSettle` shots too
// (e.g. showcase's sky/sun clips), but those are cheap, so only tablet and engine
// move the balance. So `metro` no longer needs its own shard (folded in), and the
// groups are balanced against MEASURED per-scene render time from CI, not structure:
//
//   tablet 55s, engine 29s               (the drawSettle-heavy scenes)
//   metro 28s, traffic 12s, lobby-awnings 9s, first-run 6s
//   mobile/construction ~4.5s, crowd/fire ~3.7s
//   first-run-mobile/sprite-gallery/preview-rooms ~2.5s
//   features (overlays+stats+crash-screen+basement) ~43s, showcase+milestones ~54s
//
// The two drawSettle-heavy scenes (tablet, engine) are the anchors and sit in
// DIFFERENT shards so no shard carries both; the light scenes fill each shard to
// roughly even (~57-71s a shard, so the gate is bounded near ~70s of render instead
// of the old 197s `misc`). This is the ONLY place the split is defined; correctness
// is enforced by `verify` against SCENES, so a rebalance here is safe as long as
// `verify` still passes. The per-scene numbers are wall time under CI's two-leg
// contention; confirm against a run and nudge a scene across if a shard still lags.
// To go below the ~55s tablet floor, the lever is the scene itself (its shots draw
// many settle frames), not the split.
export const SHARDS: Record<string, string[]> = {
  // ~64s: feature panels + two light HUD scenes.
  features: ["overlays", "cleanliness-overlay", "stats", "crash-screen", "basement", "traffic", "lobby-awnings"],
  // ~57s: the hero gallery + the star ladder + the sprite sheet.
  showcase: ["showcase", "milestones", "sprite-gallery"],
  // ~67s: the live-engine scene (its demo shot is drawSettle) + the now-cheap metro
  // + onboarding.
  engine: ["engine", "metro", "first-run", "first-run-mobile", "preview-rooms"],
  // ~71s: anchored by the tablet shots (the heaviest drawSettle scene) plus the
  // small scenes.
  misc: ["tablet", "mobile", "construction", "crowd", "fire"],
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
