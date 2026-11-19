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
 *   node scripts/screenshot-shards.ts jobs           -> the shards packed into CI jobs, as a JSON array of
 *                                                       space-joined shard names (the shoot matrix)
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
import { planShards } from "../src/tests/ci/e2eShards.ts";

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
  // The "page not found" page (owner, 2026-11-15): four DOM-only route
  // shots, no engine and no tower, a few seconds; its own shard.
  "not-found": ["not-found", "not-found-phone", "not-found-help", "not-found-help-phone"],
  // ~64s: feature panels + two light HUD scenes + the three schedule-dialog
  // scenes (#305 Phase 3: small frozen towers, DOM dialog shots, cheap) + the
  // two CAP-8 escalator-on-office stills (small frozen towers, one shot each)
  // + the boot-no-webgl fallback screen (no tower at all, ~2s, cheapest scene
  // in the set; it barely moves the shard's budget)
  // + the four rental-living / founder-badge shots (desktop and phone). Both towers
  // are placed-and-frozen with the sim stopped, so neither needs a drawSettle, and
  // the founder pair captures a splash over no tower at all; ~4s for the set, which
  // keeps this shard inside the same ~71s pole as the rest.
  features: ["overlays", "cleanliness-overlay", "stats", "crash-screen", "basement", "traffic", "lobby-awnings", "update-prompt", "schedule-dialog", "schedule-dialog-express", "schedule-dialog-classic", "schedule-dialog-classic-phone", "compare-escalator-office-modern", "compare-escalator-office-classic", "compare-cinema-modern", "compare-cinema-classic", "boot-no-webgl", "rental-living", "founder-badge", "rental-living-mobile", "founder-badge-mobile"],
  // ~57s + the two light pricing-modern scenes (one small frozen tower built
  // twice, four DOM panel/dialog shots total; issue #443's Modern fork) + the
  // settings-modern dialog shot (one frozen Modern tower, one modal still),
  // placed here because this was the lightest shard, keeping the gate bounded
  // by the same ~71s pole.
  // ...plus the settings-modern dialog shot (above) and the two returning-player
  // title-screen scenes (~5s together: no tower is built, they re-mount the splash
  // and open one DOM dialog). They go here rather than beside their first-run
  // siblings in `engine` precisely because this is the lightest shard, so the gate
  // stays bounded by the same ~71s pole.
  // ...plus the four Security scenes (#1886's bomb search and a quiet day):
  // one small frozen tower each, the search run by the engine's own ticks;
  // only the quiet-day lunch crowd settles for a few seconds.
  showcase: ["showcase", "milestones", "sprite-gallery", "pricing-modern", "pricing-modern-batch", "settings-modern", "returning-player", "returning-player-mobile", "security-search-classic", "security-search-modern", "security-search-joins", "security-search-split", "security-quiet-day"],
  // ~67s: the live-engine scene (its demo shot is drawSettle) + the now-cheap metro
  // + onboarding + the desktop install-affordance shot (a live engine tower with
  // the topbar Install chip surfaced, drawSettle; SPEC-pwa-install).
  // ...plus the three tall lobby scenes (#308): small frozen towers, one or
  // two shots each, about 11s together, and the venue flights tower (two
  // shots of one small frozen tower), the metro line (three shots) and the
  // split lot (one small frozen tower run a few engine minutes).
  engine: ["engine", "metro", "metro-line", "first-run", "first-run-mobile", "preview-rooms", "install-affordance"],
  // The tall lobbies, the venue flights, the split lot and the sky bridge:
  // small frozen towers, one to four shots each, about 130s a leg together
  // in CI. They rode in `engine` until that shard passed 4 minutes
  // (November 2026), the slowest capture on a pull request.
  lobbies: ["tall-lobby-classic", "tall-lobby-modern-sky", "tall-lobby-split-halls", "tall-lobby-flights", "tall-lobby-phone", "venue-flights", "split-lot-street", "sky-bridge", "sky-bridge-looks"],
  // ~71s before the Tools window fit: anchored by the tablet shots (the
  // heaviest drawSettle scene) plus the small scenes + the mobile
  // install-affordance shot (its engine-tower sibling) + the overview Map
  // scenes and the landscape phone pair (one built tower, two shots). The
  // desktop Tools window fit adds one small frozen tower with four shots; only
  // the folded strip draws every settle frame (the canvas resizes in view),
  // about 15s in the pinned image locally, roughly twice that under CI's
  // two-leg contention.
  // The folder linked on the player's computer (owner, 2026-11-15): three
  // scenes of DOM window stills over the default new tower, desktop and
  // phone, about 10s; its own shard as the owner asked.
  "linked-folder": ["linked-folder", "linked-folder-unsupported", "linked-folder-mobile"],
  // File > Open Recent (owner, 2026-11-16): the empty and full submenu, a
  // gone tower's note, the title screen's menu and the phone's in-place
  // submenu, DOM stills over the default new tower; its own shard.
  "open-recent": ["open-recent", "open-recent-title", "open-recent-mobile"],
  // Previous versions of a My Towers tower (#2380): the row menu, the window
  // with versions and empty, the Open and Save As windows it goes back to on
  // Cancel, and on a phone; DOM stills over the default new tower, its own
  // shard as new features get.
  "previous-versions": ["previous-versions", "previous-versions-mobile"],
  // The elevator schedule's Auto box (owner, 2026-11-17): ticked on a
  // measured shaft, waiting on a new one, and on a phone; DOM stills over
  // the small frozen schedule tower, its own shard as new features get.
  "elevator-auto": ["schedule-dialog-auto", "schedule-dialog-auto-phone"],
  // The 1994 desk and the sunrise startup screen (owner, 2026-11-15: their own
  // shard, every design and option): one canon tower on the desk, the
  // README's day and night pair on a second one, the title window, and the
  // startup screen on a computer and a phone.
  desk: ["desk", "desk-hero", "desk-title", "startup-sunrise", "startup-sunrise-phone"],
  // The appearance schemes (owner, 2026-11-17): the dialog, the canon tower's
  // desk in Skyline and High Contrast, a phone in Skyline and the phone title
  // screen in both; its own shard,
  // as new features get.
  appearance: [
    "appearance",
    "appearance-skyline",
    "appearance-high-contrast",
    "appearance-skyline-phone",
    "appearance-skyline-phone-title",
    "appearance-high-contrast-phone-title",
  ],
  // The star-up message box (r/SimTower feedback, 2026-11-16): every rating's
  // box in both modes and one on a phone, each over a small frozen tower.
  "star-up": ["star-up", "star-up-mobile"],
  // Each Modern tower's own front door (owner, 2026-11-16): one small frozen
  // pair of towers, day and night; its own shard, as new features get.
  "front-doors": ["front-doors"],
  // The Traffic readout's jump (owner, 2026-11-17): the jammed tower the
  // traffic chip shots use, tapped on desktop and on a phone, with the floor
  // banded and its transports outlined; its own shard, as new features get.
  "traffic-jump": ["traffic-jump", "traffic-jump-mobile"],
  // The answer to a fire (#1889): guards on the stairs and at the room, and
  // the rescue helicopter flying in and spraying; two small frozen towers
  // run by the engine's own ticks; its own shard, as new features get.
  "fire-response": ["fire-guards", "fire-helicopter"],
  misc: ["tablet", "mobile", "mobile-landscape", "construction", "crowd", "fire", "install-affordance-mobile", "overview-map", "overview-map-phone", "overview-map-gaps", "overview-map-gaps-phone", "palette-fit"],
};

// The shoot jobs. Every shard above keeps its own scenes and its own artifact
// folder, but a job renders several shards one after another, because each job
// pays about a minute of container start and npm ci before it renders, and the
// small feature shards render in under a minute. Fifteen one-shard jobs made the
// drift check alone queue 15 runners on every push (November 2026), so pull
// requests waited minutes for a runner.
export const SHOOT_JOBS = 7;

// The render step's seconds per shard in CI, both legs and both builds
// included (the lower of runs 44232857883 and 44234106281, since a busy runner
// can double one). The packing places the slowest first, so a new or
// unmeasured shard (counted at six seconds a scene) only moves the balance.
// Refresh from a drift-check run's "Render" step times when a shard grows.
export const SHARD_SECONDS: Record<string, number> = {
  appearance: 82,
  desk: 161,
  "elevator-auto": 25,
  engine: 140,
  features: 181,
  "fire-response": 89,
  "front-doors": 16,
  "linked-folder": 37,
  lobbies: 145,
  misc: 152,
  "not-found": 17,
  "open-recent": 34,
  "previous-versions": 32,
  showcase: 139,
  "star-up": 35,
  "traffic-jump": 46,
};

/** The shards packed into {@link SHOOT_JOBS} jobs of about equal render time,
 *  longest first; each entry is one job's shard names, space-joined. Every
 *  shard lands in exactly one job. */
export function shootJobs(): string[] {
  const shards = Object.entries(SHARDS).map(([file, ids]) => ({ file, tests: ids.length }));
  const jobs = Math.min(SHOOT_JOBS, shards.length);
  return planShards(shards, jobs, SHARD_SECONDS)
    .sort((a, b) => b.seconds - a.seconds)
    .map((job) => job.files.join(" "));
}

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
  if (cmd === "jobs") {
    // JSON array for the workflow's `fromJSON(...)` shoot matrix.
    process.stdout.write(JSON.stringify(shootJobs()));
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
  console.error("usage: screenshot-shards.ts (matrix | jobs | names | print <shard> | verify)");
  process.exit(1);
}

main();
