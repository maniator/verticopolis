/**
 * The build's own version string, as a LEAF module. It imports nothing, and
 * that is the point.
 *
 * It lived on `game/appBoot.ts`, which still re-exports it so its two importers
 * (the `appBoot` test suites) did not have to move. It had to come out because
 * `analyticsCore.ts` seeds the version onto the analytics common props at MODULE
 * LOAD, so that every event names its build whatever the entry point, including
 * the standalone `/help` and `/gallery` pages that never boot the game.
 *
 * Reading it from `appBoot` instead would close a real value cycle:
 * `analyticsCore` imports `appBoot`, `appBoot` imports `../analytics`, and
 * `analytics` re-exports `analyticsCore`. An import cycle alone is survivable
 * (the repo has plenty), but this one would be evaluated during module
 * initialization rather than inside a function, so `APP_VERSION` could be read
 * in its temporal dead zone and every event would carry `undefined`. A leaf
 * module cannot participate in a cycle at all, which is why the fix is
 * structural rather than a careful import order somebody has to preserve.
 *
 * `__APP_VERSION__` is a compile-time define (see `vite.config.ts`), so this is
 * a constant in the bundle rather than a lookup. The `"dev"` fallback covers
 * the environments that never run through Vite's define step.
 */
export const APP_VERSION = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "dev";
