import type { BrowserContext } from "playwright";

/**
 * Lost WebGL contexts in a benchmark run (#1136). The renderer checks read the
 * adapter from a new canvas, so a GPU process that restarts mid-run still
 * reads the same hardware adapter while the game's own context is lost: the
 * game draws nothing or recovers by rebuilding its canvas, and the frames
 * around that are not measurements. `watchContextLoss` (page.ts) reports each
 * loss through a binding exposed on the browser context, which survives the
 * reloads a run makes; the runner keeps one line per loss on the process run.
 */

/** The page-side name `watchContextLoss` calls. Spelled out there because Playwright serializes that function alone. */
export const CONTEXT_LOSS_BINDING = "__perfContextLost";

export interface ContextLoss {
  /** The page's clock, in milliseconds, when the event fired. */
  at: number;
  id: string;
  width: number;
  height: number;
}

/** One record line for a loss, as kept on the process run. */
export function contextLossLine(loss: ContextLoss): string {
  const canvas = `${loss.id ? `canvas#${loss.id}` : "a canvas"} (${loss.width}x${loss.height})`;
  return `WebGL context lost on ${canvas} at ${loss.at} ms of a page`;
}

/** Expose the binding on a context, so a loss in any of its pages calls `onLoss`. */
export async function trackContextLoss(ctx: BrowserContext, onLoss: (line: string) => void): Promise<void> {
  await ctx.exposeBinding(CONTEXT_LOSS_BINDING, (_source, loss: ContextLoss) => onLoss(contextLossLine(loss)));
}

/**
 * The validation errors for runs that lost a context. An error in every
 * mode: a `--quick` run and a declared renderer exception excuse an
 * unverified adapter, and neither excuses frames drawn by a context that
 * died. `losses` has one entry per good process run; absent in results
 * written before this check.
 */
export function contextLossFinding(losses: readonly (readonly string[] | undefined)[]): string[] {
  const lost = losses.filter((l) => l && l.length > 0);
  if (lost.length === 0) return [];
  const first = lost[0]?.[0] ?? "";
  return [`${lost.length} of ${losses.length} process runs lost a WebGL context (${first}), so the frames are not from one live GPU context and the page may have rebuilt its canvas (benchmark-protocol.md, "The renderer must be the GPU")`];
}
