/**
 * Whether a served dist publishes the `window.game` tooling handle, which only
 * a `VC_TOOLING=1` build carries (production builds compile it away, see
 * `bootstrap.ts`). The e2e global setup and the screenshot runner both ask
 * this before they wait on `window.game`, so a plain build fails at once with
 * a message naming the flag instead of timing out on every spec or scene
 * (#2281). It reads the page's script bundles and looks for the same `.game=`
 * publish `scripts/verify-game-handle.ts` greps for.
 *
 * Only positive proof of a handle-less dist answers false: a fetch or parse
 * failure, or a page that lists no bundle at all, answers true, so a server
 * hiccup never aborts a run that might be fine.
 */

/** Fetch a URL's body as text. */
export type FetchText = (url: string) => Promise<string>;

/** The bundle paths a built `index.html` loads, each once. */
export function bundlePaths(html: string): string[] {
  return [...new Set(html.match(/assets\/[\w.-]+\.js/g) ?? [])];
}

/** Whether a bundle's source publishes the handle. */
export function publishesHandle(js: string): boolean {
  return /\.game\s*=[^=]|window\.game/.test(js);
}

/** Whether the dist served at `base` publishes the handle (see above). */
export async function distPublishesHandle(base: string, fetchText: FetchText): Promise<boolean> {
  const root = base.replace(/\/+$/, "");
  try {
    const bundles = bundlePaths(await fetchText(`${root}/`));
    for (const path of bundles) {
      if (publishesHandle(await fetchText(`${root}/${path}`))) return true;
    }
    return bundles.length === 0;
  } catch {
    return true;
  }
}

/** The message for a dist with no handle. */
export function missingHandleMessage(base: string): string {
  return (
    `The build served at ${base} ships no window.game handle: it was built without VC_TOOLING=1 ` +
    `(a production build). Rebuild with VC_TOOLING=1 npm run build, then run again.`
  );
}
