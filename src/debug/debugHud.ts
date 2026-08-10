import { html, nothing, render, type TemplateResult } from "lit-html";
import {
  emptySnapshot,
  formatCount,
  formatFps,
  formatMs,
  snapshotFrame,
  systemTimerTooCoarse,
  type FrameSnapshot,
  type FrameStatsLike,
} from "./debugMetrics";
import { readSimTick } from "./simTimer";

/**
 * The DOM metrics overlay: frame cost, draw counters, actor counts, and the
 * costliest ECS systems, sampled from Excalibur's per-frame statistics.
 *
 * It is DOM rather than Excalibur debug draw for two reasons, both of which bit
 * the obvious approach first. Excalibur's own debug rendering goes through the
 * graphics context, so it ADDS to `drawCalls` and `rendererSwaps`, the very
 * counters a performance overlay exists to report. And it draws in world space,
 * so at the zoom range this game reaches (down past `CROWD_CULL_ZOOM`, 0.125)
 * the text is sub-pixel and unreadable exactly when you are investigating
 * zoomed-out performance. A fixed DOM panel has neither problem.
 *
 * The engine is reached through {@link HudSource}, a structural port rather
 * than `ex.Engine` and `TowerEngine` directly. That is what lets this run under
 * happy-dom against a plain fake, and it keeps the panel honest about how
 * little it actually needs.
 */

/** Everything the panel reads, as narrow as it can be made. The debug installer
 *  adapts the real engines to this; the tests pass a literal. */
export interface HudSource {
  /** Subscribe to the engine's per-frame signal. Returns an unsubscribe. */
  onFrame(handler: () => void): () => void;
  /** The live frame statistics. Excalibur REUSES this instance every frame, so
   *  the panel snapshots it rather than retaining it. */
  frameStats(): FrameStatsLike | undefined;
  /** Session frame-rate percentiles, or null before enough frames have been
   *  sampled. Comes from the analytics reservoir, which is already a proper
   *  sampler and reads its own wall clock (see `GameplaySession.noteFrame`). */
  fpsPercentiles(): { p50: number; p5: number; samples: number } | null;
  /** Camera zoom, for the crowd-cull context row. */
  zoom(): number;
  /** Whether the crowd and vehicle layer is currently zoom-culled. */
  crowdCulled(): boolean;
  /** Whether Excalibur geometry draw is on, so the panel can say out loud that
   *  its own graphics counters are inflated. */
  drawOn(): boolean;
}

/** How many ECS systems the panel lists. Three fits without crowding and is
 *  almost always enough to answer "is it drawing or is it motion"; the console's
 *  `vcdebug.systems(n)` is there when it is not. */
const TOP_SYSTEMS = 3;

/** Panel refresh period. Fast enough to watch a number move, slow enough that
 *  the overlay is not itself a cost worth subtracting. */
const REFRESH_MS = 250;

const HOST_ID = "debug-hud-host";

/** A full reading: the frame snapshot plus the context the panel shows beside
 *  it. This is also what `vcdebug.stats()` hands back. */
export interface HudReading {
  frame: FrameSnapshot;
  /** Latest and worst sim-tick cost since the previous reading (see simTimer). */
  simLastMs: number;
  simPeakMs: number;
  fps: { p50: number; p5: number; samples: number } | null;
  zoom: number;
  crowdCulled: boolean;
  drawOn: boolean;
}

export interface DebugHud {
  setVisible(on: boolean): void;
  visible(): boolean;
  /** Take a reading right now, independent of the refresh throttle. */
  sample(): HudReading;
  /** The most recent reading the panel rendered (or a fresh one if it has not
   *  rendered yet). */
  reading(): HudReading;
  /** Unsubscribe and remove the panel from the document. */
  dispose(): void;
}

export function emptyReading(): HudReading {
  return { frame: emptySnapshot(), simLastMs: 0, simPeakMs: 0, fps: null, zoom: 1, crowdCulled: false, drawOn: false };
}

/**
 * Build the overlay. It starts hidden; `setVisible(true)` mounts it. The
 * per-frame subscription is live either way (it is a throttle check and an early
 * return while hidden), so toggling the panel from the console never has to
 * re-subscribe against an engine that may have been rebuilt underneath.
 */
export function createDebugHud(source: HudSource, doc: Document = document): DebugHud {
  let shown = false;
  let last = emptyReading();
  let lastRenderAt = 0;
  let host: HTMLElement | null = null;

  /** `resetPeak` is true only for the panel's own refresh tick, which owns the
   *  display window; an on-demand `sample()` peeks so it cannot steal the
   *  panel's peak (and report a spurious zero for itself). */
  const sample = (resetPeak = false): HudReading => {
    const sim = readSimTick(resetPeak);
    return {
      frame: snapshotFrame(source.frameStats(), TOP_SYSTEMS),
      simLastMs: sim.lastMs,
      simPeakMs: sim.peakMs,
      fps: source.fpsPercentiles(),
      zoom: source.zoom(),
      crowdCulled: source.crowdCulled(),
      drawOn: source.drawOn(),
    };
  };

  /** Mount lazily and into its own child of <body>, never into #stage. A
   *  `position: fixed` element inside #stage would be hostage to any future
   *  transformed or filtered ancestor, which silently turns "the viewport" into
   *  "the stage box" (the same reasoning as the boot fallback in bootstrap.ts). */
  const ensureHost = (): HTMLElement => {
    if (host?.isConnected) return host;
    host = doc.getElementById(HOST_ID);
    if (!host) {
      host = doc.createElement("div");
      host.id = HOST_ID;
      doc.body.appendChild(host);
    }
    return host;
  };

  const paint = (): void => {
    render(panel(last), ensureHost());
  };

  const onFrame = (): void => {
    if (!shown) return;
    const now = globalThis.performance ? performance.now() : Date.now();
    if (now - lastRenderAt < REFRESH_MS) return;
    lastRenderAt = now;
    // Snapshot only on a refresh tick, not on every frame: the other fourteen
    // frames in fifteen would allocate a snapshot and sort the system map for
    // a reading nothing ever displays. The sim-tick peak is what carries the
    // hitches those skipped frames would otherwise hide, so this is also the
    // call that clears it: one refresh window, one peak.
    last = sample(true);
    paint();
  };

  const unsubscribe = source.onFrame(onFrame);

  return {
    setVisible(on: boolean): void {
      if (on === shown) return;
      shown = on;
      if (on) {
        // Paint immediately rather than waiting up to a frame, so toggling the
        // panel from the console feels like a switch and not a request. Opens
        // the panel's first refresh window, so it clears the peak too.
        last = sample(true);
        lastRenderAt = globalThis.performance ? performance.now() : Date.now();
        paint();
      } else if (host?.isConnected) {
        host.remove();
        host = null;
      }
    },
    visible: () => shown,
    sample,
    reading: () => last,
    dispose(): void {
      unsubscribe();
      shown = false;
      if (host?.isConnected) host.remove();
      host = null;
    },
  };
}

/**
 * The panel body. Styles are inline rather than in `src/styles.css` on purpose:
 * this whole tree is behind a dynamic import, and a stylesheet rule would ship
 * to every player for a surface almost none of them will ever open.
 *
 * `pointer-events: none` matters more than it looks. The panel sits over the
 * tower, and a debug overlay that swallowed clicks on the canvas would break
 * input for exactly the sessions where you are debugging input. Copyable
 * numbers come from `vcdebug.stats()` instead.
 */
function panel(r: HudReading): TemplateResult {
  return html`<div
    id="debug-hud"
    style="position:fixed;left:8px;bottom:8px;z-index:60;pointer-events:none;background:rgba(12,14,20,0.86);color:#d7dde5;border:1px solid #39414f;border-radius:4px;padding:8px 10px;font:11px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-variant-numeric:tabular-nums"
  >
    ${row("fps", `${formatFps(r.frame.fps)}${r.fps ? `   p50 ${r.fps.p50}  p5 ${r.fps.p5}` : "   p50 —  p5 —"}`)}
    ${row("frame", `${formatMs(r.frame.totalMs)} ms   up ${formatMs(r.frame.updateMs)}  draw ${formatMs(r.frame.drawMs)}`)}
    ${row("sim", `${formatMs(r.simLastMs)} ms   peak ${formatMs(r.simPeakMs)}`)}
    ${row("draws", `${formatCount(r.frame.drawCalls)} calls  ${formatCount(r.frame.drawnImages)} imgs  ${formatCount(r.frame.rendererSwaps)} swaps`)}
    ${row("actors", `${formatCount(r.frame.actorsAlive)} alive / ${formatCount(r.frame.actorsTotal)} total`)}
    ${row("camera", `zoom ${formatZoom(r.zoom)}${r.crowdCulled ? "   crowd CULLED" : ""}`)}
    ${systemsBlock(r.frame)}
    ${r.drawOn
      ? html`<div style="margin-top:4px;color:#e0b050">debug draw on: draws/swaps inflated</div>`
      : nothing}
  </div>`;
}

/** The costliest-systems block, or an explanation of why there isn't one.
 *  Saying "all 0 ms, clock too coarse" rather than showing nothing matters:
 *  these rows are the panel's highest-value answer, and their silent absence
 *  reads as "the systems are free" instead of "this browser cannot time them". */
function systemsBlock(frame: FrameSnapshot): TemplateResult | typeof nothing {
  const border = "margin-top:4px;border-top:1px solid #39414f;padding-top:4px";
  if (frame.systems.length > 0) {
    return html`<div style=${border}>${frame.systems.map((s) => systemRow(s.label, `${formatMs(s.ms)} ms`))}</div>`;
  }
  if (systemTimerTooCoarse(frame)) {
    return html`<div style="${border};color:#8b95a5">${frame.systemKeys} systems, all 0 ms: clock too coarse to time them</div>`;
  }
  return nothing;
}

/** Camera zoom, guarded like every other number on the panel. A bare
 *  `.toFixed(3)` here was the one unguarded read: on `undefined` (a zoom read
 *  during an engine rebuild) it THROWS inside the render, taking the panel down
 *  with it, and on NaN it prints "NaN", which reads as a bug in the game rather
 *  than a gap in the instrumentation. */
function formatZoom(zoom: number): string {
  return Number.isFinite(zoom) ? zoom.toFixed(3) : "—";
}

function row(label: string, value: string): TemplateResult {
  return html`<div style="display:flex;gap:8px">
    <span style="color:#8b95a5;flex:0 0 7ch">${label}</span><span>${value}</span>
  </div>`;
}

/** A system row. Unlike {@link row}, the label is the long side (Excalibur's
 *  keys look like `draw:GraphicsSystem`), so the cost is pushed to the right
 *  edge and the name gets whatever width is left. */
function systemRow(label: string, value: string): TemplateResult {
  return html`<div style="display:flex;gap:8px;justify-content:space-between">
    <span style="color:#8b95a5;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${label}</span><span>${value}</span>
  </div>`;
}
