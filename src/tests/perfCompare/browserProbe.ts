import { chromium } from "playwright-core";
import { webglRenderer } from "./page";
import { launchOptions, rendererFinding, type BrowserLaunch } from "./renderer";

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
export async function probeBrowser(executablePath: string | null, launch: BrowserLaunch): Promise<BrowserProbe> {
  const browser = await chromium.launch(launchOptions(executablePath, launch));
  try {
    const ctx = await browser.newContext();
    await ctx.addInitScript({ content: "globalThis.__name = (fn) => fn;" });
    const page = await ctx.newPage();
    await page.goto("about:blank");
    const gl = await page.evaluate(webglRenderer);
    return { version: browser.version(), renderer: gl?.renderer ?? null };
  } finally {
    await browser.close().catch(() => {});
  }
}

/**
 * The start-of-run gate: the same rule validation applies to the finished
 * runs, applied to the probe, so a full run on a software, virtual, masked or
 * unknown renderer stops before the builds. Returns the warnings to print;
 * throws on an error.
 */
export function gateBrowser(probe: BrowserProbe, quick: boolean, launch: BrowserLaunch): string[] {
  const f = rendererFinding([probe.renderer], [probe.renderer], { quick, exception: launch.rendererException });
  if (f.errors.length) throw new Error(`the browser cannot be used for this run (Chromium ${probe.version}${launch.channel ? `, channel ${launch.channel}` : ""}):\n  - ${f.errors.join("\n  - ")}`);
  return f.warnings;
}
