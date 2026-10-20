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
  /** The commit of origin/main whose register approved it; null before that and for no exception. */
  rendererExceptionCommit?: string | null;
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
/** Vendor words. They name a maker and no device, so they count only beside a model token. */
const VENDOR = /\b(nvidia|amd|intel|apple|qualcomm|arm|imagination)\b/i;
/** API and driver words that carry digits but name no device (Direct3D11, vs_5_0, Vulkan 1.3.0). */
const NOISE = /^(direct3d\d*|d3d\d+|vs|ps|opengl|es|gl|vulkan|metal|llvm|angle|0x[0-9a-f]+|version|unspecified)$/;

/** Version numbers and driver builds (1.3.260, D3D11-31.0.15.3623, vs_5_0) that carry digits but name no device. */
const VERSIONS = /d3d\d+-[\d.]+|\b\d+(?:\.\d+)+\b|\b(?:vs|ps)_\d_\d\b/g;

/** A token that looks like a model number (A100, L4, 650, G78, 6800): not an API word, a version, a driver build or a year. */
function hasModelToken(text: string): boolean {
  return text
    .toLowerCase()
    .replace(VERSIONS, " ")
    .split(/[^a-z0-9-]+|_/)
    .filter((t) => t && !NOISE.test(t))
    .some((t) => (/[a-z]/.test(t) && /\d/.test(t)) || (/^\d{3,}$/.test(t) && !/^(19|20)\d\d$/.test(t)));
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
  // Firefox's masked strings end in ", or similar"; Chromium never sends them.
  if (/,\s*or similar/i.test(text)) return "unknown";
  // A bare vendor word and "ANGLE (Intel)" name no device.
  return FAMILY.test(text) || (VENDOR.test(text) && hasModelToken(text)) ? "hardware" : "unknown";
}

export interface RendererFindingOptions {
  /** A `--quick` smoke run: failures to verify the GPU are warnings. */
  quick: boolean;
  /** The register entry that lets an unverified renderer pass with warnings (never for a disagreement between reads). */
  exception?: string | null;
  /** Reads taken after the throttled cold start, one per process run; `undefined` for a run that had no cold start. They are held to the same rules as the reads after the frames. */
  lateEnds?: readonly (string | null | undefined)[];
}

/**
 * The validation finding for the renderers the runs recorded: `starts` read
 * at the page's start, `ends` read again after the frames and `lateEnds`
 * after the throttled cold start (when a run had one), one entry per good
 * process run. One rule for both runners:
 *
 * - Every run must show a hardware renderer at every read. A masked,
 *   unknown, virtual or software one is an error, or a warning for a
 *   `--quick` run or a run that declares a register exception (the report
 *   then says so at the top).
 * - A missing renderer is an error unless the run is `--quick` without an
 *   exception: an exception covers an adapter the owner has seen named, and
 *   a page with no WebGL context at all is not that.
 * - Different renderers across runs, or different reads in one run (a GPU
 *   process that died and fell back), are errors even then: they mean the
 *   frame rows mix adapters.
 */
export function rendererFinding(starts: readonly (string | null | undefined)[], ends: readonly (string | null | undefined)[], opts: RendererFindingOptions): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const relaxed = opts.quick || !!opts.exception;
  const tag = (msg: string) => (opts.exception ? `exception ${opts.exception}: ${msg}` : msg);
  const unverified = (msg: string) => (relaxed ? warnings : errors).push(tag(msg));
  const missing = (msg: string) => (opts.quick && !opts.exception ? warnings : errors).push(tag(msg));
  const fix = '(benchmark-protocol.md, "The renderer must be the GPU")';
  const read = (r: string | null | undefined): string => (typeof r === "string" ? r.trim() : "");
  const names = (list: readonly (string | null | undefined)[]) => [...new Set(list.map(read).filter(Boolean))];
  const late = opts.lateEnds ?? [];
  // The read lists after the start: every run has one after the frames; the cold-start list counts only where a run had a cold start.
  const afters: { when: string; reads: readonly (string | null | undefined)[]; optional: boolean }[] = [{ when: "after the frames", reads: ends, optional: false }];
  if (late.some((r) => r !== undefined)) afters.push({ when: "after the cold start", reads: late, optional: true });
  if (starts.length === 0) missing(`no process run recorded a WebGL renderer, so whether the page rendered on the GPU is unknown ${fix}`);
  const noStart = starts.filter((r) => !read(r)).length;
  if (noStart > 0 && starts.length > 0) missing(`${noStart} of ${starts.length} process runs recorded no WebGL renderer at their start, so the GPU is not verified ${fix}`);
  for (const { when, reads, optional } of afters) {
    const gone = (i: number): boolean => !read(reads[i]) && !(optional && reads[i] === undefined);
    // A start read with no read afterwards is the signature of a GPU process
    // that died mid-run: no declared exception or smoke run hides it.
    const lost = starts.filter((r, i) => !!read(r) && gone(i)).length;
    if (lost > 0) errors.push(`${lost} of ${starts.length} process runs read a WebGL renderer at their start but none ${when}, which is how a GPU process that died mid-run looks ${fix}`);
    const noEnd = starts.filter((r, i) => !read(r) && gone(i)).length;
    if (noEnd > 0) missing(`${noEnd} of ${starts.length} process runs have no WebGL renderer read ${when} either ${fix}`);
  }
  const kinds = new Map<RendererKind, string[]>();
  for (const r of names([...starts, ...afters.flatMap((x) => x.reads)])) kinds.set(classifyRenderer(r), [...(kinds.get(classifyRenderer(r)) ?? []), r]);
  for (const kind of ["software", "virtual", "unknown"] as const) {
    const list = kinds.get(kind);
    if (!list?.length) continue;
    const what = {
      software: ["a software rasterizer", ": frame rates, 1% lows and frame times are invalid and the CPU load may have moved the bare-step rows"],
      virtual: ["a virtual display adapter", " that is no GPU"],
      unknown: ["a renderer string that does not name a hardware adapter", ", so whether the page used the GPU is unknown"],
    }[kind];
    unverified(`the page rendered with ${what[0]} (${list.map((u) => `"${u}"`).join("; ")})${what[1]}; run it on the GPU ${fix}`);
  }
  // Every read of every run must name one adapter, in every mode.
  const all = names([...starts, ...afters.flatMap((x) => x.reads)]);
  if (all.length > 1) errors.push(`the runs recorded different WebGL renderers: ${all.join("; ")}`);
  for (const { when, reads } of afters) {
    const changed = starts.map((r, i) => [read(r), read(reads[i])] as const).filter(([x, y]) => !!x && !!y && x !== y);
    if (changed.length) errors.push(`the WebGL renderer changed ${when} in ${changed.length} process run(s) (${changed.map(([x, y]) => `"${x}" then "${y}"`).join("; ")}), so the frames did not all run on one adapter`);
  }
  return { errors, warnings };
}

/** True when every good run read a hardware renderer at its start and every read after, with no exception and no `--quick` allowance. Recorded in the results so a consumer can refuse a run that was not GPU evidence. */
export function gpuVerified(starts: readonly (string | null | undefined)[], ends: readonly (string | null | undefined)[], lateEnds?: readonly (string | null | undefined)[]): boolean {
  return starts.length > 0 && rendererFinding(starts, ends, { quick: false, lateEnds }).errors.length === 0;
}

/** The `browser.gpuVerified` a results file records: false for every run that declared a register exception, whatever it read, so a consumer can refuse it on the flag alone. */
export function recordedGpuVerified(exception: string | null | undefined, starts: readonly (string | null | undefined)[], ends: readonly (string | null | undefined)[], lateEnds?: readonly (string | null | undefined)[]): boolean {
  return !exception && gpuVerified(starts, ends, lateEnds);
}

/**
 * The browser's product name for a report: from the channel when one launched
 * it, otherwise from the executable. An installed Chrome or Edge reached with
 * `PW_CHROMIUM_PATH` is named from its install folder; every other build
 * (Playwright's own, a copy of it, Chrome for Testing) stays "Chromium".
 */
export function browserName(channel: string | null | undefined, executable?: string | null): string {
  if (channel && channel !== "chromium") return channel.startsWith("msedge") ? "Microsoft Edge" : "Google Chrome";
  if (!channel && executable && !/ms-playwright|chromium/i.test(executable)) {
    if (/msedge|microsoft[\\/ ]edge/i.test(executable)) return "Microsoft Edge";
    // An installed Chrome lives under a Google folder; a Chrome for Testing build or a copied Playwright build stays Chromium.
    if (/google[\\/ -]?chrome/i.test(executable)) return "Google Chrome";
  }
  return "Chromium";
}

interface RendererRecord {
  ok?: boolean;
  page?: { webgl?: { renderer: string } | null } | null;
  rendererEnd?: string | null;
  rendererEndCold?: string | null;
}

/** The renderers the good runs read, as one report line: at the start of each page and again at the end of the run (after the frames, and after the throttled cold start where there was one). */
export function rendererSummary(runs: readonly RendererRecord[]): string {
  const good = runs.filter((r) => r.ok !== false);
  const list = (xs: (string | null | undefined)[]) => [...new Set(xs.filter((x): x is string => !!x))].join("; ") || "none";
  const start = list(good.map((r) => r.page?.webgl?.renderer));
  const end = list(good.flatMap((r) => [r.rendererEnd, r.rendererEndCold]));
  return start === end ? start : `${start} (at the start); ${end} (at the end)`;
}

/**
 * The lines that lead a report when its renderer was not verified as hardware:
 * a declared register exception (with the entry's hash), and a `--quick`
 * smoke run. Either way the frame rows are not GPU evidence on their own.
 */
export function rendererBanners(browser: { rendererException?: string | null; rendererExceptionSha256?: string | null; rendererExceptionCommit?: string | null; gpuVerified?: boolean }, quick: boolean): string[] {
  const out: string[] = [];
  if (browser.rendererException) out.push(`> **Renderer exception ${browser.rendererException} declared** (register entry SHA-256 ${browser.rendererExceptionSha256 ?? "unrecorded"}, read from origin/main at ${browser.rendererExceptionCommit?.slice(0, 12) ?? "an unrecorded commit"}). The renderer checks were warnings in this run, so it is not verified GPU evidence. The frame rows count only as far as that owner-approved entry says.`);
  if (quick && browser.gpuVerified === false) out.push("> **Smoke run.** The `--quick` option let this run finish without a verified hardware renderer, so no frame row in it is GPU evidence.");
  return out;
}
