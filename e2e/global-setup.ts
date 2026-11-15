import type { FullConfig } from "@playwright/test";
import { distPublishesHandle, missingHandleMessage } from "../src/build/toolingHandle";

/**
 * Fail the run at once when the served build has no `window.game` handle (a
 * production build, not `VC_TOOLING=1`): every spec drives that handle, and
 * without this check each one times out on its own wait with no hint of the
 * cause (#2281). Playwright starts the web server before this runs.
 */
export default async function globalSetup(config: FullConfig): Promise<void> {
  const base = config.projects[0]?.use.baseURL;
  if (!base) return;
  const fetchText = async (url: string) => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url} answered ${res.status}`);
    return res.text();
  };
  if (!(await distPublishesHandle(base, fetchText))) throw new Error(missingHandleMessage(base));
}
