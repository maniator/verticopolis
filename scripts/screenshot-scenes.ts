/**
 * The declarative SCENES manifest: every screenshot mapped to the state it needs.
 * A new shot is a new row in one of the `scenes/*.ts` groups, not a new file.
 * Each scene either builds a tower (via a page-context builder from
 * screenshot-builders.ts) or navigates a route, then lists its shots. The runner
 * (screenshots.ts) walks this array; screenshot-shards.ts validates its shard
 * partition against the ids here.
 *
 * The manifest is grouped into cohesive siblings and concatenated below, in
 * order, into one merged `SCENES` export so the id set and order stay stable:
 *   - scenes/showcase.ts: the docs/screenshots set + the crash-screen card.
 *   - scenes/features.ts: the map-overlay / stats / basement / migration set.
 *   - scenes/pricing.ts: the Classic/Modern mode-fork pricing scenes (#443).
 *   - scenes/schedule.ts: the elevator Schedule dialog scenes (#305 Phase 3).
 *   - scenes/classic-vs-modern.ts: the CAP-8 paired escalator-on-office stills.
 *   - scenes/milestones.ts: the star-rank growth set + the TOWER capstone.
 *   - scenes/boot-fallback.ts: the no-WebGL boot screen (staged boot failure).
 * The Node-side drivers (fixture load, star assertions) live in
 * screenshot-scenes-drivers.ts. Keep every file ERASABLE.
 */
import { type Scene } from "./screenshot-env.ts";
import { SHOWCASE_SCENES } from "./scenes/showcase.ts";
import { FEATURE_SCENES } from "./scenes/features.ts";
import { PRICING_SCENES } from "./scenes/pricing.ts";
import { SCHEDULE_SCENES } from "./scenes/schedule.ts";
import { CLASSIC_VS_MODERN_SCENES } from "./scenes/classic-vs-modern.ts";
import { MILESTONE_SCENES } from "./scenes/milestones.ts";
import { BOOT_FALLBACK_SCENES } from "./scenes/boot-fallback.ts";
import { INSTALL_SCENES } from "./scenes/install.ts";

export const SCENES: Scene[] = [
  ...SHOWCASE_SCENES,
  ...FEATURE_SCENES,
  ...PRICING_SCENES,
  ...SCHEDULE_SCENES,
  ...CLASSIC_VS_MODERN_SCENES,
  ...MILESTONE_SCENES,
  ...BOOT_FALLBACK_SCENES,
  ...INSTALL_SCENES,
];
