import type { LaunchOptions } from "playwright-core";

/**
 * Which browser the benchmark runs, and whether its page rendered on the GPU
 * (benchmark-protocol.md, "The renderer must be the GPU"). Frame rates, 1%
 * lows and frame times from a software rasterizer measure the CPU rasterizer,
 * and it also competes with the bare-step rows for the CPU. A full run
 * therefore fails closed: it passes only when the renderer is positively
 * named as hardware, before and after the frames. Only a `--quick` smoke run
 * or a declared owner-approved exception turns those failures into warnings.
 */

/** What the owner's machine can change about the launch, through the environment. */
export interface BrowserLaunch {
  /** A Playwright channel such as "chrome" (the installed browser); null for the bundled Chromium. */
  channel: string | null;
  /** Extra Chromium switches, after the harness's own, each normalized to lower case. */
  args: string[];
  /** The exception-register entry (for example "EX-4") that lets a run with an unverified renderer finish with warnings; null for none. */
  rendererException: string | null;
}

/** The switches every launch gets: autoplay without a gesture, and gc() for the timed loops. */
export const BASE_ARGS = ["--autoplay-policy=no-user-gesture-required", "--js-flags=--expose-gc"];

/** The Playwright channels a launch may name. */
export const CHANNELS = ["chromium", "chrome", "chrome-beta", "chrome-dev", "chrome-canary", "msedge", "msedge-beta", "msedge-dev", "msedge-canary"];

/**
 * The only extra switches a launch takes: the ones that choose how the GPU is
 * reached. A switch maps to the pattern its value must match (null for a flag
 * with no value). Anything else changes what is measured (feature lists
 * replace Playwright's own, process-model and compositor switches change the
 * frame path) and is refused. Chromium on Windows lowercases switch names, so
 * names are compared in lower case.
 */
const GPU_SWITCHES: Readonly<Record<string, RegExp | null>> = {
  "use-angle": /^[a-z0-9_-]+$/,
  "use-gl": /^[a-z0-9_-]+$/,
  "ignore-gpu-blocklist": null,
  "enable-gpu-rasterization": null,
  "enable-zero-copy": null,
};

const SWITCH = /^--([A-Za-z][A-Za-z0-9-]*)(?:=(.*))?$/;

/**
 * `PW_CHROMIUM_CHANNEL`, `PW_CHROMIUM_ARGS` (space-separated switches from
 * `GPU_SWITCHES`, none quoted) and `PW_RENDERER_EXCEPTION` (a register entry
 * such as `EX-4`). The channel and `PW_CHROMIUM_PATH` are alternatives:
 * Playwright ignores the channel when an executable is given. Called once at
 * the start of a run, before any build or results folder exists, so a bad
 * setting fails at once.
 */
export function browserLaunch(env: Record<string, string | undefined>): BrowserLaunch {
  const rawChannel = env.PW_CHROMIUM_CHANNEL?.trim();
  const channel = rawChannel ? rawChannel.toLowerCase() : null;
  if (channel && !CHANNELS.includes(channel)) throw new Error(`PW_CHROMIUM_CHANNEL: "${rawChannel}" is not a channel; expected one of ${CHANNELS.join(", ")}`);
  if (channel && env.PW_CHROMIUM_PATH) throw new Error("set PW_CHROMIUM_PATH or PW_CHROMIUM_CHANNEL, not both: Playwright launches the executable and ignores the channel");
  const seen = new Set<string>();
  const args: string[] = [];
  for (const token of (env.PW_CHROMIUM_ARGS ?? "").split(/\s+/).filter(Boolean)) {
    const m = SWITCH.exec(token);
    if (!m) throw new Error(`PW_CHROMIUM_ARGS: "${token}" is not a switch (each is --name or --name=value, with no quotes)`);
    const name = m[1].toLowerCase();
    const value = m[2]?.toLowerCase();
    if (!Object.prototype.hasOwnProperty.call(GPU_SWITCHES, name)) throw new Error(`PW_CHROMIUM_ARGS: --${name} is not allowed in a benchmark run; the allowed switches are ${Object.keys(GPU_SWITCHES).map((k) => `--${k}`).join(", ")}`);
    if (seen.has(name)) throw new Error(`PW_CHROMIUM_ARGS: --${name} is given twice`);
    seen.add(name);
    const pattern = GPU_SWITCHES[name];
    if (pattern === null && value !== undefined) throw new Error(`PW_CHROMIUM_ARGS: --${name} takes no value`);
    if (pattern !== null && (value === undefined || !pattern.test(value))) throw new Error(`PW_CHROMIUM_ARGS: --${name} needs a value like --${name}=d3d11`);
    args.push(value === undefined ? `--${name}` : `--${name}=${value}`);
  }
  const rawException = env.PW_RENDERER_EXCEPTION?.trim();
  if (rawException && !/^EX-\d+$/i.test(rawException)) throw new Error(`PW_RENDERER_EXCEPTION: "${rawException}" is not an exception-register entry (expected EX-<number>, an owner-approved entry that says why this run may use an unverified renderer)`);
  return { channel, args, rendererException: rawException ? rawException.toUpperCase() : null };
}

/** Playwright's launch options: headless, the base switches, the extra ones, and the executable or channel. */
export function launchOptions(executablePath: string | null, launch: BrowserLaunch): LaunchOptions {
  return {
    headless: true,
    args: [...BASE_ARGS, ...launch.args],
    ...(executablePath ? { executablePath } : {}),
    ...(launch.channel && !executablePath ? { channel: launch.channel } : {}),
  };
}

/** `hardware` is positively named; `software` and `virtual` are known not to be a GPU; `unknown` is anything else, including no string, a masked string and a lost context's "null". */
export type RendererKind = "hardware" | "software" | "virtual" | "unknown";

const SOFTWARE = /swiftshader|llvmpipe|softpipe|lavapipe|\bwarp\b|basic render|software|osmesa|offscreen|\bswr\b|swrast|mesa x11/i;
const VIRTUAL = /vmware|svga3d|vmsvga|virtualbox|vbox|parallels|citrix|qemu|virtio|virgl|venus|hyper-v|basic display|remote display|\brdp\b|\bxen\b|bochs|cirrus/i;
/** Vendor and device-family words of real adapters. A string must carry one of these, and none of the words above, to count. */
const HARDWARE = /\b(nvidia|geforce|rtx|gtx|quadro|tesla|titan|radeon|radeonsi|amd|vega|intel|apple m\d|apple gpu|adreno|mali|powervr|qualcomm)\b/i;

/**
 * The unmasked WebGL renderer string, sorted by an allowlist: hardware only
 * when it names a known adapter vendor or family and no software or virtual
 * word. A software word wins over everything (a SwiftShader string also names
 * "Google" and "Vulkan"). Everything unrecognized is `unknown`, which a full
 * run treats like software.
 */
export function classifyRenderer(renderer: string | null | undefined): RendererKind {
  const text = typeof renderer === "string" ? renderer.trim() : "";
  if (!text) return "unknown";
  if (SOFTWARE.test(text)) return "software";
  if (VIRTUAL.test(text)) return "virtual";
  return HARDWARE.test(text) ? "hardware" : "unknown";
}

export interface RendererFindingOptions {
  /** A `--quick` smoke run: failures to verify the GPU are warnings. */
  quick: boolean;
  /** The register entry that lets an unverified renderer pass with warnings (never for a disagreement between reads). */
  exception?: string | null;
}

/**
 * The validation finding for the renderers the runs recorded: `starts` read
 * at the page's start, `ends` read again after the frames, one entry per good
 * process run. One rule for both runners:
 *
 * - Every run must show a hardware renderer at both reads. A missing, masked,
 *   unknown, virtual or software one is an error, or a warning for a `--quick`
 *   run or a run that declares a register exception (the report then says so
 *   at the top).
 * - Different renderers across runs, or different reads in one run (a GPU
 *   process that died and fell back), are errors even then: they mean the
 *   frame rows mix adapters.
 */
export function rendererFinding(starts: readonly (string | null | undefined)[], ends: readonly (string | null | undefined)[], opts: RendererFindingOptions): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const relaxed = opts.quick || !!opts.exception;
  const unverified = (msg: string) => (relaxed ? warnings : errors).push(opts.exception && !opts.quick ? `exception ${opts.exception}: ${msg}` : msg);
  const fix = '(benchmark-protocol.md, "The renderer must be the GPU")';
  const names = (list: readonly (string | null | undefined)[]) => [...new Set(list.filter((r): r is string => !!r && !!r.trim()))];
  const seenStart = names(starts);
  const seenEnd = names(ends);
  if (starts.length === 0) unverified(`no process run recorded a WebGL renderer, so whether the page rendered on the GPU is unknown ${fix}`);
  const noStart = starts.filter((r) => !r || !r.trim()).length;
  if (noStart > 0 && starts.length > 0) unverified(`${noStart} of ${starts.length} process runs recorded no WebGL renderer at their start, so the GPU is not verified ${fix}`);
  const noEnd = ends.filter((r) => !r || !r.trim()).length;
  if (noEnd > 0 || ends.length < starts.length) unverified(`${Math.max(noEnd, starts.length - ends.length)} of ${starts.length} process runs have no WebGL renderer read after the frames, so a GPU process that died mid-run would not show ${fix}`);
  const kinds = new Map<RendererKind, string[]>();
  for (const r of new Set([...seenStart, ...seenEnd])) kinds.set(classifyRenderer(r), [...(kinds.get(classifyRenderer(r)) ?? []), r]);
  for (const kind of ["software", "virtual", "unknown"] as const) {
    const list = kinds.get(kind);
    if (!list?.length) continue;
    const what = {
      software: ["a software rasterizer", ": frame rates, 1% lows and frame times are invalid and the CPU load may have moved the bare-step rows"],
      virtual: ["a virtual display adapter", ", which is not the GPU"],
      unknown: ["a renderer string that does not name a hardware adapter", ", so whether the page used the GPU is unknown"],
    }[kind];
    unverified(`the page rendered with ${what[0]} (${list.map((u) => `"${u}"`).join("; ")})${what[1]}; run it on the GPU ${fix}`);
  }
  if (seenStart.length > 1) errors.push(`the runs recorded different WebGL renderers: ${seenStart.join("; ")}`);
  const changed = starts.map((r, i) => [r, ends[i]] as const).filter(([a, b]) => !!a && !!b && a.trim() !== b.trim());
  if (changed.length) errors.push(`the WebGL renderer changed during ${changed.length} process run(s) (${changed.map(([a, b]) => `"${a}" then "${b}"`).join("; ")}), so the frames did not all run on one adapter`);
  return { errors, warnings };
}

/** The browser's product name for a report, from the channel that launched it. */
export function browserName(channel: string | null | undefined): string {
  if (!channel || channel === "chromium") return "Chromium";
  return channel.startsWith("msedge") ? "Microsoft Edge" : "Google Chrome";
}

interface RendererRecord {
  page?: { webgl?: { renderer: string } | null } | null;
  rendererEnd?: string | null;
}

/** The renderers the runs read, as one report line: at the start of each page and again after the frames. */
export function rendererSummary(runs: readonly RendererRecord[]): string {
  const list = (xs: (string | null | undefined)[]) => [...new Set(xs.filter((x): x is string => !!x))].join("; ") || "none";
  const start = list(runs.map((r) => r.page?.webgl?.renderer));
  const end = list(runs.map((r) => r.rendererEnd));
  return start === end ? start : `${start} (at the start); ${end} (after the frames)`;
}

/** The report line for a declared renderer exception, or null. It leads the report, because it changes what the frame rows prove. */
export function exceptionBanner(exception: string | null | undefined): string | null {
  return exception ? `> **Renderer exception ${exception} declared.** The renderer checks were warnings in this run, not a pass. The frame rows are GPU evidence only if that exception-register entry (owner-approved) says so.` : null;
}
