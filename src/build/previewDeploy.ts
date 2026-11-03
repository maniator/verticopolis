/**
 * Whether a build is a Vercel preview deploy (a pull request's or a branch's
 * own URL), from the build's environment. Preview deploys may build features
 * still behind an address flag, such as the Map window's `?map` (#343), so the
 * owner can try them on a phone; the production deploy never does.
 *
 * Vercel sets `VERCEL=1` in every build it runs, and `VERCEL_ENV` to
 * "preview" or "production" (or "development" under `vercel dev`). A local
 * `vercel build` without `--prod` also reports "preview", and its output could
 * then be deployed to production with `vercel deploy --prebuilt --prod`; no
 * workflow here does that, and the deploy players get is built by Vercel's own
 * Git integration as "production". Requiring both variables keeps a plain local
 * or CI build that happens to carry `VERCEL_ENV` from counting as a preview.
 */
export function isPreviewDeploy(env: Readonly<Record<string, string | undefined>>): boolean {
  return env.VERCEL === "1" && env.VERCEL_ENV === "preview";
}
