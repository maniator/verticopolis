/**
 * Where this build is deployed, as the build recorded it. A separate module
 * so unit tests can replace it (Vite's `define` substitutes the constant at
 * build time, where a test cannot stub it).
 */

/** True only in a Vercel preview deployment. The page registers no service
 *  worker there (see src/build/previewDeploy.ts and src/pwa.ts). */
export const PREVIEW_DEPLOY: boolean = typeof __PREVIEW_DEPLOY__ !== "undefined" && __PREVIEW_DEPLOY__;
