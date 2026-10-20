import type { LaunchOptions } from "playwright";

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
  /** SHA-256 of that register entry's text once exceptionRegister.ts has resolved it; null before that and for no exception. */
  rendererExceptionSha256?: string | null;
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
/** Device-family words of real adapters, each enough on its own to name a device. */
const FAMILY = /\b(geforce|rtx|gtx|quadro|titan|tesla|radeon|radeonsi|vega|iris|uhd|arc|xe|adreno|mali|powervr|apple m\d+)\b/i;
/** Vendor words, which name a maker and not a device: they count only beside a model token. */
const VENDOR = /\b(nvidia|amd|intel|apple|qualcomm|arm|imagination)\b/i;
/** API and driver words that carry digits but name no device (Direct3D11, vs_5_0, Vulkan 1.3.0). */
const NOISE = /^(direct3d\d*|d3d\d+|vs|ps|opengl|es|gl|vulkan|metal|llvm|angle|0x[0-9a-f]+|version|unspecified)$/;

/** A token that looks like a model number (A100, L4, 650, G78, 6800), not an API word. */
function hasModelToken(text: string): boolean {
  return text
    .toLowerCase()
    .split(/[^a-z0-9-]+|_/)
    .filter((t) => t && !NOISE.test(t))
    .some((t) => (/[a-z]/.test(t) && /\d/.test(t)) || /^\d{3,}$/.test(t));
}

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
  // A bare vendor word, "ANGLE (Intel)" and "Intel, or similar" name no device.
  return FAMILY.test(text) || (VENDOR.test(text) && hasModelToken(text)) ? "hardware" : "unknown";
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
  const unverified = (msg: string) => (relaxed ? warnings : errors).push(opts.exception ? `exception ${opts.exception}: ${msg}` : msg);
  const fix = '(benchmark-protocol.md, "The renderer must be the GPU")';
  const read = (r: string | null | undefined): string => (typeof r === "string" ? r.trim() : "");
  const names = (list: readonly (string | null | undefined)[]) => [...new Set(list.map(read).filter(Boolean))];
  const seenStart = names(starts);
  const seenEnd = names(ends);
  if (starts.length === 0) unverified(`no process run recorded a WebGL renderer, so whether the page rendered on the GPU is unknown ${fix}`);
  const noStart = starts.filter((r) => !read(r)).length;
  if (noStart > 0 && starts.length > 0) unverified(`${noStart} of ${starts.length} process runs recorded no WebGL renderer at their start, so the GPU is not verified ${fix}`);
  // A start read with no end read is the signature of a GPU process that died
  // mid-run: no declared exception or smoke run hides it.
  const lost = starts.filter((r, i) => !!read(r) && !read(ends[i])).length;
  if (lost > 0) errors.push(`${lost} of ${starts.length} process runs read a WebGL renderer at their start but none after the frames, which is how a GPU process that died mid-run looks ${fix}`);
  const noEnd = starts.filter((r, i) => !read(r) && !read(ends[i])).length;
  if (noEnd > 0) unverified(`${noEnd} of ${starts.length} process runs have no WebGL renderer read after the frames either ${fix}`);
  const kinds = new Map<RendererKind, string[]>();
  for (const r of new Set([...seenStart, ...seenEnd])) kinds.set(classifyRenderer(r), [...(kinds.get(classifyRenderer(r)) ?? []), r]);
  for (const kind of ["software", "virtual", "unknown"] as const) {
    const list = kinds.get(kind);
    if (!list?.length) continue;
    const what = {
      software: ["a software rasterizer", ": frame rates, 1% lows and frame times are invalid and the CPU load may have moved the bare-step rows"],
      virtual: ["a virtual display adapter", " that is not the GPU"],
      unknown: ["a renderer string that does not name a hardware adapter", ", so whether the page used the GPU is unknown"],
    }[kind];
    unverified(`the page rendered with ${what[0]} (${list.map((u) => `"${u}"`).join("; ")})${what[1]}; run it on the GPU ${fix}`);
  }
  // Every read of every run must name one adapter, in every mode.
  const all = names([...starts, ...ends]);
  if (all.length > 1) errors.push(`the runs recorded different WebGL renderers: ${all.join("; ")}`);
  const changed = starts.map((r, i) => [read(r), read(ends[i])] as const).filter(([a, b]) => !!a && !!b && a !== b);
  if (changed.length) errors.push(`the WebGL renderer changed during ${changed.length} process run(s) (${changed.map(([a, b]) => `"${a}" then "${b}"`).join("; ")}), so the frames did not all run on one adapter`);
  return { errors, warnings };
}

/** True when every good run read a hardware renderer at its start and its end, with no exception and no `--quick` allowance. Recorded in the results so a consumer can refuse a run that was not GPU evidence. */
export function gpuVerified(starts: readonly (string | null | undefined)[], ends: readonly (string | null | undefined)[]): boolean {
  return starts.length > 0 && rendererFinding(starts, ends, { quick: false }).errors.length === 0;
}

/**
 * The browser's product name for a report: from the channel when one launched
 * it, otherwise from the executable (an installed Chrome or Edge reached with
 * `PW_CHROMIUM_PATH`). Playwright's own Chromium builds live under
 * `ms-playwright` or a `chromium-<n>` folder and stay "Chromium".
 */
export function browserName(channel: string | null | undefined, executable?: string | null): string {
  if (channel && channel !== "chromium") return channel.startsWith("msedge") ? "Microsoft Edge" : "Google Chrome";
  if (!channel && executable && !/ms-playwright|chromium/i.test(executable)) {
    if (/msedge|microsoft edge/i.test(executable)) return "Microsoft Edge";
    if (/google[ -]?chrome|[\\/]chrome(\.exe)?$/i.test(executable)) return "Google Chrome";
  }
  return "Chromium";
}

interface RendererRecord {
  ok?: boolean;
  page?: { webgl?: { renderer: string } | null } | null;
  rendererEnd?: string | null;
}

/** The renderers the good runs read, as one report line: at the start of each page and again at the end of the run. */
export function rendererSummary(runs: readonly RendererRecord[]): string {
  const good = runs.filter((r) => r.ok !== false);
  const list = (xs: (string | null | undefined)[]) => [...new Set(xs.filter((x): x is string => !!x))].join("; ") || "none";
  const start = list(good.map((r) => r.page?.webgl?.renderer));
  const end = list(good.map((r) => r.rendererEnd));
  return start === end ? start : `${start} (at the start); ${end} (at the end)`;
}

/**
 * The lines that lead a report when its renderer was not verified as hardware:
 * a declared register exception (with the entry's hash), and a `--quick`
 * smoke run. Either way the frame rows are not GPU evidence on their own.
 */
export function rendererBanners(browser: { rendererException?: string | null; rendererExceptionSha256?: string | null; gpuVerified?: boolean }, quick: boolean): string[] {
  const out: string[] = [];
  if (browser.rendererException) out.push(`> **Renderer exception ${browser.rendererException} declared** (register entry SHA-256 ${browser.rendererExceptionSha256 ?? "unrecorded"}). The renderer checks were warnings in this run, so it is not verified GPU evidence. The frame rows count only as far as that owner-approved entry says.`);
  if (quick && browser.gpuVerified === false) out.push("> **Smoke run.** The `--quick` option let this run finish without a verified hardware renderer, so no frame row in it is GPU evidence.");
  return out;
}
