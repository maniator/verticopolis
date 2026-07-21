/**
 * ⚠ BROWSER-INJECTED CODE lives in the siblings this file re-exports. Every
 * function shipped into the page via Playwright `page.evaluate(fn)` is
 * serialized with `.toString()`, so each one MUST be fully self-contained (no
 * imports, no module-scope references, no cross-function calls). See the
 * siblings for the full contract.
 *
 * This file is the entry point + barrel. The functions were split out by role
 * into cohesive siblings and re-exported here so every existing
 * `import { … } from "./screenshot-builders.ts"` (screenshots.ts and
 * screenshot-scenes.ts import by identity) keeps working unchanged:
 *   - `screenshot-page-ops.ts`: the `pg*` in-page primitives (clock adoption,
 *     stepping, chrome sweeps, palette/overlay/clock nudges, camera framing).
 *   - `screenshot-tower-builders.ts`: `buildCanonTower`, `buildBasement`,
 *     `buildModernPricingTower`, `pgGrowToStar`.
 *   - `screenshot-compare-builders.ts`: the CAP-8 escalator-on-office pair
 *     (`buildEscalatorOfficeModern` / `buildEscalatorOfficeClassic`).
 *   - `screenshot-scene-builders.ts`: the engine/crowd/fire/condo/stats/hotspot/
 *     overlay/tablet builders folded in from the old shot-*.mjs generators.
 *
 * Keep re-exports only here (erasable): no enums / namespaces / parameter
 * properties.
 */

export * from "./screenshot-page-ops.ts";
export * from "./screenshot-tower-builders.ts";
export * from "./screenshot-compare-builders.ts";
export * from "./screenshot-scene-builders.ts";
