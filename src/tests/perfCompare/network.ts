import type { CDPSession } from "playwright";
import { ENGINE_PACKAGE_FILES } from "./env";
import type { EngineName, NetworkLimit } from "./types";

/**
 * The `--network MBPS,LATENCY_MS` option of perf:compare (#1254). The CPU
 * throttles slow the page down but leave the connection at local speed, so a
 * change that mainly helps a slow download (the engine package preload, #1777)
 * shows nothing in a plain run. A limit here is Chrome DevTools Protocol
 * network emulation (`Network.emulateNetworkConditions`): one download and
 * upload rate, and a minimum delay added to every request. That delay is not a
 * full round trip: the protocol does not emulate the DNS, TCP or TLS
 * handshakes.
 *
 * It limits only the startup measurements: the cold start, the warm start and,
 * when a throttle above 1x is configured, the cold start under the heaviest CPU
 * throttle. The timed simulation and frame passes run on a page that is
 * already loaded, so a limit there would slow only their setup. The saved-tower
 * starts boot a fresh context per scenario and stay unlimited, so a limited
 * run never measures a limit it did not state.
 *
 * Emulation reaches the page target, and the startup contexts block service
 * workers and fetch the engine from the main thread, so the engine package is
 * limited too. `assertHeld` rejects a limited cold start whose transfers ran faster than the limit allows, which is how an emulation that never reached the page shows.
 */
/** The rate and latency caps are heuristics that aim to keep a limited cold start inside the fixed 120 s startup waits (a page needs a couple of megabytes before it is ready: about 16 s at 1 Mbps, and a few dozen request waves at 2000 ms each). A run that still times out fails its repetition and says so; the caps do not scale the waits. */
export const NETWORK_MIN_MBPS = 1;
export const NETWORK_MAX_MBPS = 1000;
export const NETWORK_MAX_LATENCY_MS = 2000;
/** A transfer is checked once it is this large. */
const CHECKED_BYTES = 20_000;
/** The share of its transfer time at the stated rate that a checked transfer must have taken; the added latency counts in full. The rest absorbs cached ranges, compression and clock granularity. */
const SLACK = 0.5;
/** A local fetch of a few hundred KB takes a few milliseconds (about 2 to 4 ms was measured). A limit whose largest checked transfer has a floor under this cannot be told from no limit. */
const MIN_PROVABLE_MS = 10;
/** The Chrome DevTools Protocol value for no throughput limit. */
const CDP_UNLIMITED_THROUGHPUT = -1;

/** Plain decimals with up to three places, so no value prints in exponent form (`1e-7`) and the marker and the rerun flag always parse back. */
const decimal = /^\d+(\.\d{1,3})?$/;

export function parseNetwork(text: string): NetworkLimit {
  const parts = text.split(",").map((p) => p.trim());
  const [mbps, latencyMs] = parts.map((p) => (decimal.test(p) ? Number(p) : NaN));
  if (parts.length !== 2 || !(mbps >= NETWORK_MIN_MBPS && mbps <= NETWORK_MAX_MBPS) || !(latencyMs >= 0 && latencyMs <= NETWORK_MAX_LATENCY_MS)) {
    throw new Error(`--network takes MBPS,LATENCY_MS as plain decimals with up to three places: a rate from ${NETWORK_MIN_MBPS} to ${NETWORK_MAX_MBPS} megabits per second (a slower link would run into the fixed startup timeouts) and an added per-request latency from 0 to ${NETWORK_MAX_LATENCY_MS} ms, for example 10,40`);
  }
  return { mbps, latencyMs };
}

export function describeNetwork(limit: NetworkLimit): string {
  return `${limit.mbps} Mbps each way with ${limit.latencyMs} ms added latency per request`;
}

/** Which starts a limit shaped, for the report: the throttled cold start exists only when a CPU throttle above 1x is configured. */
export function limitedStarts(throttles: readonly number[]): string {
  return Math.max(...throttles) > 1 ? "the cold start, the warm start and the cold start under the heaviest CPU throttle" : "the cold start and the warm start";
}

/** The text that marks a limited run: in the folder name and in the CSV column. */
export function networkMarker(limit: NetworkLimit): string {
  const part = (n: number) => String(n).replace(".", "p");
  return `net-${part(limit.mbps)}x${part(limit.latencyMs)}`;
}

/** Anything that starts like a marker, so a name cannot slip a near-marker past the check: `net-10x40`, `net-1p5x0`, and also `net-10x40ms`. `planet-2` and `my-net-2` do not start like one. */
const LOOSE_MARKER = /(^|[^a-z0-9])net-\d+(p\d+)?x\d/g;
/** A whole marker as its own part of a name, with nothing alphanumeric or a dot after it. */
const STRICT_MARKER = /(^|[^a-z0-9])net-\d+(p\d+)?x\d+(p\d+)?(?![a-z0-9.])/g;

function markersIn(name: string, shape: RegExp): string[] {
  return [...name.toLowerCase().matchAll(shape)].map((m) => m[0].slice(m[0].indexOf("net-")));
}

/** The marker rule for an explicit `--out` name, as `--aa` has: a limited run's folder carries exactly its own marker, and an unlimited run's folder carries nothing that starts like one. */
export function networkFolderProblem(name: string, limit: NetworkLimit | null): string | null {
  const loose = markersIn(name, LOOSE_MARKER);
  if (!limit) return loose.length > 0 ? `--out ${name} names a network-limited folder, but this run has no --network; pass --network or pick another name` : null;
  const marker = networkMarker(limit);
  const strict = markersIn(name, STRICT_MARKER);
  return loose.length === 1 && strict.length === 1 && strict[0] === marker ? null : `--network ${limit.mbps},${limit.latencyMs} needs an --out folder name containing ${marker} as its own part, and nothing else that starts like a limit marker, so the folder cannot be mistaken for a protocol run`;
}

/** The rows a limit shaped: the cold and warm startup rows and their transfer rows. The saved-tower rows (a scenario in the row) and every other group ran unlimited, and so did the wasm-load rows: `wasmColdLoad` runs on the TypeScript page after the warm start, once the limit is lifted. */
export function limitedRow(row: { group: string; scenario: string; metric: string }): boolean {
  return row.scenario === "-" && (row.group === "startup" || row.group === "transfer") && /^(cold|warm) /.test(row.metric);
}

/** The Chrome DevTools Protocol parameters for a limit; `null` is no limit (latency 0 and throughput -1 mean unlimited). */
export function networkConditions(limit: NetworkLimit | null): { offline: false; latency: number; downloadThroughput: number; uploadThroughput: number } {
  if (!limit) return { offline: false, latency: 0, downloadThroughput: CDP_UNLIMITED_THROUGHPUT, uploadThroughput: CDP_UNLIMITED_THROUGHPUT };
  const bytesPerSecond = (limit.mbps * 1_000_000) / 8;
  return { offline: false, latency: limit.latencyMs, downloadThroughput: bytesPerSecond, uploadThroughput: bytesPerSecond };
}

/** Applies a limit to a page's connection. With `null` it lifts the limit and switches the Network domain off again, because a domain left on keeps the fetched bodies in the browser and would change the memory passes of a limited run. */
export async function limitNetwork(cdp: CDPSession, limit: NetworkLimit | null): Promise<void> {
  if (limit) await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", networkConditions(limit));
  if (!limit) await cdp.send("Network.disable");
}

export interface TransferTiming {
  name: string;
  startTime: number;
  responseEnd: number;
  transferSize: number;
}

/** Why a cold start's transfers cannot have run behind the limit, or null. A transfer cannot finish faster than the added latency plus its share of the time its bytes need at the stated rate, so one that did means the emulation did not reach it. This is a lower bound on each transfer's duration. The emulated latency sits inside the entry's own duration (measured on Chromium: a 449 KB fetch at 1000 Mbps with 300 ms took 311 ms). */
export function heldProblem(limit: NetworkLimit, resources: readonly TransferTiming[]): string | null {
  const big = resources.filter((r) => r.transferSize >= CHECKED_BYTES);
  if (big.length === 0) return "no transfer of a size the limit could be checked on was recorded";
  const bytesPerMs = (limit.mbps * 1_000_000) / 8 / 1000;
  const floorMs = (r: TransferTiming): number => limit.latencyMs + (r.transferSize / bytesPerMs) * SLACK;
  const best = Math.max(...big.map(floorMs));
  if (best < MIN_PROVABLE_MS) return `${limit.mbps} Mbps with ${limit.latencyMs} ms added latency is too close to local speed to check: the largest transfer has a floor of ${best.toFixed(1)} ms and a local fetch can take ${MIN_PROVABLE_MS} ms; add latency or lower the rate`;
  const fast = big.find((r) => r.responseEnd - r.startTime < floorMs(r));
  if (!fast) return null;
  return `${fast.name} moved ${fast.transferSize} bytes in ${(fast.responseEnd - fast.startTime).toFixed(1)} ms, under its floor of ${floorMs(fast).toFixed(1)} ms for ${limit.mbps} Mbps with ${limit.latencyMs} ms added latency (the latency plus half the transfer time at the rate)`;
}

/** The engine package's binary as the page requests it, which a WASM page must have moved, in full, among the transfers the held check times. */
const ENGINE_WASM_FILE = ENGINE_PACKAGE_FILES.find((f) => f.endsWith(".wasm"));
if (!ENGINE_WASM_FILE) throw new Error("ENGINE_PACKAGE_FILES names no .wasm file");
export const ENGINE_WASM_PATH = `/engine/${ENGINE_WASM_FILE}`;

export function assertHeld(limit: NetworkLimit, resources: readonly TransferTiming[], where: string, engine: EngineName): void {
  // Every transfer of CHECKED_BYTES or more is timed by heldProblem, so requiring the binary among those times it. A zero-byte preload entry or a small revalidation does not count.
  if (engine === "wasm" && !resources.some((r) => r.name === ENGINE_WASM_PATH && r.transferSize >= CHECKED_BYTES)) {
    throw new Error(`${where}: the network limit (${describeNetwork(limit)}) could not be proven on the engine package: the page recorded no transfer of ${ENGINE_WASM_PATH} of ${CHECKED_BYTES} bytes or more`);
  }
  const problem = heldProblem(limit, resources);
  if (problem) throw new Error(`${where}: the network limit (${describeNetwork(limit)}) did not hold: ${problem}`);
}
