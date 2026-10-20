import { chromium, type Browser } from "playwright";
import { webglRenderer } from "./page";
import { browserName, launchOptions, rendererFinding, type BrowserLaunch } from "./renderer";

/** How long the start-of-run probe may take, from the launch call to the renderer read: one deadline over both. */
export const PROBE_TIMEOUT_MS = 60_000;
/** The most the browser's close may add after the deadline. */
export const CLOSE_TIMEOUT_MS = 5_000;

/** What one throwaway launch shows before a run starts: the build and the adapter. */
export interface BrowserProbe {
  version: string;
  /** The unmasked WebGL renderer, or null when the page produced none. */
  renderer: string | null;
}

/**
 * Launch the browser the run will use, read its version and WebGL renderer
 * from a blank page, and close it. Called at the start of both harnesses,
 * before any build, so a setting that does not reach the GPU fails in seconds
 * instead of after a run, and so a `--resume` is refused when the browser
 * build or adapter is not the one the run started on (both go in the
 * machine identity).
 */
export async function probeBrowser(executablePath: string | null, launch: BrowserLaunch, timeoutMs = PROBE_TIMEOUT_MS): Promise<BrowserProbe> {
  let browser: Browser | undefined;
  let abandoned = false;
  let timer: NodeJS.Timeout | undefined;
  // A driver that hangs while it creates a context would stall the run before
  // any build, with no message: the one deadline turns that into an error,
  // whether the hang is in the launch or in the read.
  const hung = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      abandoned = true;
      reject(new Error(`the browser probe did not finish in ${timeoutMs / 1000} s (a GPU driver that hangs at context creation looks like this)`));
    }, timeoutMs);
  });
  const probe = async (): Promise<BrowserProbe> => {
    browser = await chromium.launch({ ...launchOptions(executablePath, launch), timeout: timeoutMs });
    if (abandoned) {
      // The launch outlived the deadline; the caller has moved on, so close this browser here.
      await browser.close().catch(() => {});
      throw new Error("the browser probe was abandoned");
    }
    return read(browser);
  };
  try {
    return await Promise.race([probe(), hung]);
  } finally {
    clearTimeout(timer);
    // The close gets a short bound of its own, so a hung browser cannot hold the run.
    let closeTimer: NodeJS.Timeout | undefined;
    const gaveUp = new Promise<void>((resolve) => (closeTimer = setTimeout(resolve, CLOSE_TIMEOUT_MS)));
    await Promise.race([browser?.close().catch(() => {}), gaveUp]);
    clearTimeout(closeTimer);
    if (!browser) abandoned = true;
  }
}

async function read(browser: Browser): Promise<BrowserProbe> {
  const ctx = await browser.newContext();
  await ctx.addInitScript({ content: "globalThis.__name = (fn) => fn;" });
  const page = await ctx.newPage();
  await page.goto("about:blank");
  const gl = await page.evaluate(webglRenderer);
  return { version: browser.version(), renderer: gl?.renderer ?? null };
}

/**
 * The start-of-run gate: the same rule validation applies to the finished
 * runs, applied to the probe, so a full run on a software, virtual, masked or
 * unknown renderer stops before the builds. Returns the warnings to print;
 * throws on an error.
 */
export function gateBrowser(probe: BrowserProbe, quick: boolean, launch: BrowserLaunch, executablePath: string | null = null): string[] {
  const f = rendererFinding([probe.renderer], [probe.renderer], { quick, exception: launch.rendererException });
  if (f.errors.length) throw new Error(`the browser cannot be used for this run (${browserName(launch.channel, executablePath)} ${probe.version}${launch.channel ? `, channel ${launch.channel}` : ""}):\n  - ${f.errors.join("\n  - ")}`);
  return f.warnings;
}
