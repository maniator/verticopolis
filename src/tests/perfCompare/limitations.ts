import { classifyRenderer } from "./renderer";
import { preThree } from "./report";
import type { EngineName } from "./types";

interface Limitation {
  text: string;
  /** "cross" describes two different engines in the two slots, so an A/A
   *  folder leaves it out; "wasm" describes WASM-only rows, which an
   *  `--aa ts` folder does not have. */
  only?: "cross" | "wasm";
}

const STATIC_LIMITATIONS: readonly Limitation[] = [
  { text: "One machine and one headless Chromium. Spread is reported (CV, order-statistic intervals of the median, order-statistic intervals of the paired median ratios); results from other hardware, browsers or a GPU will differ." },
  { text: "Both engines run on the main thread. The WASM host keeps a TypeScript read model of the tower, refreshed from the engine's frame view after every step and from a full save merge whenever the tower revision moves or an in-game hour passes (src/wasmhost/wasmHost.ts). The hosted rows include that cost; the bare-engine rows do not.", only: "cross" },
  { text: "The step driver (the frame loop's owed-minute math and fixed step) is the TypeScript host's for both engines (#867), and commands still run on both the read model and the engine (#954). This benchmark times ticks, which the engine alone runs when hosted; it does not time player commands.", only: "cross" },
  { text: "Pages are served cross-origin isolated (COOP/COEP) so performance.now() resolves to about 5 microseconds instead of 100. The production site is not isolated; isolation does not change how either engine executes." },
  { text: "Transfer sizes are what this harness's server sent: Brotli quality 11 or gzip level 9 static compression, Cache-Control per vercel.json. A CDN's compression levels and protocol overhead differ; headers are not counted." },
  { text: "CPU throttling is Chromium's DevTools emulation (the renderer is paused in slices), not a slower CPU: it scales CPU time but not memory bandwidth or cache behavior. A fixed CPU probe runs under each throttle before every scenario's timed passes, at the start of each frame block and just after the throttled cold start, and must show at least half the nominal slowdown or the run fails. A probe shows the throttle held at that moment, not at every moment after it." },
  { text: "Memory is measured per scenario in its own freshly loaded page, after the save is loaded and two in-game hours run, then a forced GC through the DevTools protocol. WASM linear memory only grows, so each WASM figure is that page's high-water mark, which includes the boot tower the page hosted before the save was loaded. The JS heap leaves linear memory out, so the comparable row is JS heap plus linear memory. Process PSS sums the browser's processes (Linux only).", only: "wasm" },
  { text: "Frame-time accounting times sim.tick and ui.update directly; the rest of each frame (the Excalibur canvas render, the compositor, GC and idle time until the next frame) is reported as one remainder. Render cost is therefore not isolated from idle time." },
  { text: "Ratios are paired by repetition (the two engines' processes ran back to back, order alternating) with a distribution-free 95% interval of the median ratio, and a verdict needs six pairs. Every row is its own 95% interval, so across the report's many rows a few verdicts can be wrong by chance; read single borderline rows with that in mind.", only: "cross" },
  { text: "Startup is measured to the moment the app publishes its tooling handle (window.game) and to the first frame after it; it uses a VC_TOOLING=1 build of the same sources, which only adds that handle. The before-ready and after-ready byte split is cut where a 10 ms poll first sees the handle. The 4x cold start runs in a second fresh context of the same browser process (fresh HTTP cache, warm process)." },
  { text: "Gameplay frame windows are wall-clock time, so the slower engine simulates fewer in-game minutes in them; the achieved sim speed is reported beside every frame row. A frame over 200 ms is handed 1 ms of elapsed time by Excalibur, so rows with clamped frames (counted in the frames-over-200-ms row) understate the simulation's share.", only: "cross" },
  { text: "Audio-off means the game's audio never started (no gesture, so the Tone.js chunk never loads); audio-on starts it the way a first click does, unmuted, with Chromium's autoplay policy relaxed for both engines. Headless Chromium plays to no device, so the audio thread's cost on real output hardware may differ.", only: "cross" },
  { text: "The WASM attribution (engine tick, exports the host reads, host JS) comes from a separate pass with wrappers on every method of the engine, never from the timed pass; the wrappers' own bookkeeping outside their timed window lands in the host JS share, so that share is an upper bound. The bare-engine (raw) rows tick a detached Engine and do not include the host's read-model sync.", only: "wasm" },
  { text: "The incremental WASM download counts the engine package (binary, loader, BUILD.json). The WASM host code (src/wasmhost) is inside the shared app chunks and is counted there for both configurations (backlog row perf-compare-host-js-share)." },
  { text: "Node timings (outcome check table) are a secondary data point on Node's V8; the engine order alternates by scenario." },
  { text: "Every result directory is named by date and commit so later runs can be compared with it." },
];

/** The pre-cutover framing, added to the limitations only for an app
 *  version before 3.0.0 (the header follows the same rule). */
export const PRE_THREE_LIMITATION = "This is a pre-3.0 baseline of an engine still being cut over (#945), not release performance.";

/** What an A/A folder says in place of the cross-engine limitations. */
export const aaLimitation = (aa: EngineName): string =>
  `An A/A pass: ${aa === "wasm" ? "WASM" : "TypeScript"} ran in both slots. This folder is one input to the calibration summary (#1110) and sets no tolerance by itself. The limitations that describe two different engines are left out, and so are the rows only the ${aa === "wasm" ? "TypeScript" : "WASM"} engine produces and the cold WASM load steps.`;

/** What the WebGL renderers of the good runs mean for the frame rows (the protocol requires verified hardware). Each distinct renderer is classified on its own. */
export function rendererLimitation(renderers: readonly string[], exception: string | null = null): string[] {
  const out: string[] = [];
  for (const renderer of [...new Set(renderers)]) {
    const kind = classifyRenderer(renderer);
    if (kind === "hardware") out.push(`WebGL renderer in these runs: ${renderer}. Frame rates are for this GPU; other GPUs and displays will differ. The simulation-only rows do not depend on rendering.`);
    else if (kind === "software") out.push(`WebGL renderer in these runs: ${renderer}. That is a software rasterizer: render cost dominates the frame, the frame rows are invalid, and the CPU load may have moved the simulation rows. A protocol run fails validation on it.`);
    else if (kind === "virtual") out.push(`WebGL renderer in these runs: ${renderer}. That is a virtual display adapter, not the GPU: the frame rows are invalid. A protocol run fails validation on it.`);
    else out.push(`WebGL renderer in these runs: ${renderer}. It does not name a hardware adapter, so the frame rows are not verified GPU evidence. A protocol run fails validation on it.`);
  }
  if (renderers.length === 0) out.push("No WebGL renderer was recorded, so the frame rows are not verified GPU evidence. A protocol run fails validation on it.");
  if (exception) out.push(`Renderer exception ${exception} was declared for this run: the renderer checks above are warnings, not a pass. The frame rows count as GPU evidence only if that register entry says so.`);
  return out;
}

/** The limitations a results folder lists. */
export function buildLimitations(aa: EngineName | null, appVersion: string, renderers: readonly string[], exception: string | null = null): string[] {
  const kept = STATIC_LIMITATIONS.filter((l) => !aa || !l.only || (l.only === "wasm" && aa === "wasm")).map((l) => l.text);
  return [...(aa ? [aaLimitation(aa)] : []), ...kept, ...(preThree(appVersion) ? [PRE_THREE_LIMITATION] : []), ...rendererLimitation(renderers, exception)];
}
