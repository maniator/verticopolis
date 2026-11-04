import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import type { CDPSession } from "playwright";
import { assertHeld, describeNetwork, ENGINE_WASM_PATH, heldProblem, limitedRow, limitNetwork, networkConditions, networkFolderProblem, networkMarker, parseNetwork } from "./network";
import { makeConfig, outputDir, parseArgs } from "./main";

const TEN: { mbps: number; latencyMs: number } = { mbps: 10, latencyMs: 40 };

describe("parseNetwork", () => {
  it("reads megabits per second and an added latency in milliseconds", () => {
    expect(parseNetwork("10,40")).toEqual(TEN);
    expect(parseNetwork("1.5, 0")).toEqual({ mbps: 1.5, latencyMs: 0 });
    expect(parseNetwork("1,0")).toEqual({ mbps: 1, latencyMs: 0 });
    expect(parseNetwork("1000,2000")).toEqual({ mbps: 1000, latencyMs: 2000 });
  });
  it("refuses a missing, empty, zero, negative, out of range or oddly written value", () => {
    for (const bad of ["", "10", "10,", ",40", "0,40", "0.5,40", "0.000001,40", "-1,40", "10,-1", "x,40", "10,40,5", "1001,40", "10,2001", "0.0000001,40", "1.5555,40", "1000.001,40", "10,2000.001", "Infinity,40", "0x10,40", "1e2,40", "10,4e1", "10.,40"]) {
      expect(() => parseNetwork(bad), bad).toThrow(/--network takes MBPS,LATENCY_MS/);
    }
  });
});

describe("networkConditions and describeNetwork", () => {
  it("turns a limit into bytes per second and a latency", () => {
    expect(networkConditions(TEN)).toEqual({ offline: false, latency: 40, downloadThroughput: 1_250_000, uploadThroughput: 1_250_000 });
  });
  it("lifts the limit with an unlimited throughput and no added latency", () => {
    expect(networkConditions(null)).toEqual({ offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  });
  it("describes the latency as added to each request", () => {
    expect(describeNetwork(TEN)).toBe("10 Mbps each way with 40 ms added latency per request");
  });
});

describe("limitNetwork", () => {
  it("switches the Network domain on, then sends the conditions", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    await limitNetwork({ send } as unknown as CDPSession, TEN);
    expect(send.mock.calls).toEqual([["Network.enable"], ["Network.emulateNetworkConditions", networkConditions(TEN)]]);
  });
  it("lifts the limit and switches the domain off again, which a memory pass needs", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    await limitNetwork({ send } as unknown as CDPSession, null);
    expect(send.mock.calls).toEqual([["Network.emulateNetworkConditions", networkConditions(null)], ["Network.disable"]]);
  });
});

describe("the folder name of a limited run", () => {
  it("carries a marker built from the limit", () => {
    expect(networkMarker(TEN)).toBe("net-10x40");
    expect(networkMarker({ mbps: 1.5, latencyMs: 0 })).toBe("net-1p5x0");
  });
  it("is required of an explicit --out, and refused on a run with no limit", () => {
    expect(networkFolderProblem("run-net-10x40-1", TEN)).toBeNull();
    expect(networkFolderProblem("RUN-NET-10X40", TEN)).toBeNull();
    expect(networkFolderProblem("run", TEN)).toMatch(/needs an --out folder name containing net-10x40/);
    expect(networkFolderProblem("run-net-5x40", TEN)).toMatch(/containing net-10x40/);
    expect(networkFolderProblem("run-net-10x40", null)).toMatch(/names a network-limited folder/);
    expect(networkFolderProblem("run", null)).toBeNull();
  });
  it("matches the whole marker as its own part of the name", () => {
    for (const name of ["run-net-10x400", "run-net-10x40p5", "subnet-10x40", "run-net-10x40.5", "run-net-10x40x5", "run-net-10x40ms", "run-net-10x40b"]) expect(networkFolderProblem(name, TEN), name).toMatch(/as its own part/);
    expect(networkFolderProblem("run-net-10x40", TEN)).toBeNull();
    expect(networkFolderProblem("net-10x40_a", TEN)).toBeNull();
    // Words that happen to contain "net-" followed by a digit are not markers on an unlimited run.
    expect(networkFolderProblem("planet-2", null)).toBeNull();
    expect(networkFolderProblem("subnet-1", null)).toBeNull();
    expect(networkFolderProblem("my-net-2", null)).toBeNull();
    expect(networkFolderProblem("asp.net-6", null)).toBeNull();
    // Exactly one marker, and it is this run's.
    expect(networkFolderProblem("x-net-5x20-net-10x40", TEN)).toMatch(/nothing else that starts like a limit marker/);
    expect(networkFolderProblem("net-10x40-net-10x40", TEN)).toMatch(/nothing else that starts like a limit marker/);
    expect(networkFolderProblem("my-net-2-net-10x40", TEN)).toBeNull();
    expect(networkFolderProblem("run-net-10x40p5", null)).toMatch(/names a network-limited folder/);
    // Anything that starts like a marker counts as one when looking for a claimed limit, however it ends.
    for (const name of ["run-net-10x40ms", "run-net-10x40.5", "run-net-10x40x5", "run-net-1x0s"]) expect(networkFolderProblem(name, null), name).toMatch(/names a network-limited folder/);
    for (const name of ["run-net-10x40-net-5x20.5", "run-net-10x40-net-10x40ms"]) expect(networkFolderProblem(name, TEN), name).toMatch(/nothing else that starts like a limit marker/);
  });
  const env = { commitShort: "abc1234", dirty: false };
  const base = { quick: false, skipBuild: false, aa: null } as const;
  it("is added to the default folder name and enforced on --out", () => {
    expect(outputDir("/r", { ...base, out: null, network: TEN }, "2026-11-04", env, () => false)).toMatch(/2026-11-04-abc1234-net-10x40$/);
    expect(outputDir("/r", { ...base, out: null, network: null }, "2026-11-04", env, () => false)).toMatch(/2026-11-04-abc1234$/);
    expect(() => outputDir("/r", { ...base, out: "limited", network: TEN }, "d", env, () => false)).toThrow(/containing net-10x40/);
    expect(outputDir("/r", { ...base, out: "limited-net-10x40", network: TEN }, "d", env, () => false)).toMatch(/limited-net-10x40$/);
    expect(() => outputDir("/r", { ...base, out: "x-net-10x40", network: null }, "d", env, () => false)).toThrow(/names a network-limited folder/);
  });
});

describe("limitedRow", () => {
  it("marks the cold and warm startup and transfer rows, and nothing the limit did not touch", () => {
    for (const metric of ["cold game ready", "warm game ready", "cold engine loaded", "cold bytes served before ready", "cold before ready: wasm-binary"]) {
      expect(limitedRow({ group: metric.includes("bytes") || metric.includes("before") ? "transfer" : "startup", scenario: "-", metric }), metric).toBe(true);
    }
    expect(limitedRow({ group: "startup", scenario: "small", metric: "cold game ready with a saved tower" })).toBe(false);
    expect(limitedRow({ group: "sim-raw", scenario: "small", metric: "total for fixed duration" })).toBe(false);
    expect(limitedRow({ group: "transfer", scenario: "-", metric: "first visit with service worker, bytes served" })).toBe(false);
    expect(limitedRow({ group: "wasm-load", scenario: "-", metric: "cold fetch" })).toBe(false);
  });
});

describe("heldProblem", () => {
  // 449,000 bytes at 10 Mbps take about 360 ms.
  const wasm = (ms: number) => ({ name: "/engine/verticopolis_engine_bg.wasm", startTime: 100, responseEnd: 100 + ms, transferSize: 449_000 });
  it("accepts a transfer that took about as long as the rate allows", () => {
    expect(heldProblem(TEN, [wasm(380)])).toBeNull();
    expect(() => assertHeld(TEN, [wasm(380)], "cold start", "wasm")).not.toThrow();
  });
  it("counts the added latency in the floor, so a high rate still proves the limit", () => {
    const fast = { mbps: 1000, latencyMs: 2000 };
    expect(heldProblem(fast, [wasm(5)])).toMatch(/in 5\.0 ms, under its floor of 2001\.8 ms for 1000 Mbps with 2000 ms added latency/);
    expect(heldProblem(fast, [wasm(2100)])).toBeNull();
  });
  it("refuses a limit too close to local speed to check, which a local fetch would pass", () => {
    // 449,000 bytes at 1000 Mbps need 3.6 ms, so the floor is 1.8 ms; a loopback fetch takes 2 to 4 ms.
    for (const near of [{ mbps: 1000, latencyMs: 0 }, { mbps: 500, latencyMs: 0 }, { mbps: 360, latencyMs: 0 }]) expect(heldProblem(near, [wasm(500)]), `${near.mbps},${near.latencyMs}`).toMatch(/too close to local speed to check/);
    expect(heldProblem({ mbps: 1000, latencyMs: 8 }, [wasm(500)])).toMatch(/too close to local speed to check/);
    expect(heldProblem({ mbps: 1000, latencyMs: 9 }, [wasm(500)])).toBeNull();
    expect(heldProblem({ mbps: 100, latencyMs: 0 }, [wasm(40)])).toBeNull();
    expect(() => assertHeld({ mbps: 1000, latencyMs: 0 }, [wasm(500)], "cold start", "wasm")).toThrow(/too close to local speed to check.*add latency or lower the rate/);
  });
  it("prints the durations with a decimal, so a near miss does not read as a tie", () => {
    expect(heldProblem(TEN, [{ name: "/a.js", startTime: 0, responseEnd: 219.2, transferSize: 449_000 }])).toMatch(/in 219\.2 ms, under its floor of 219\.6 ms/);
  });
  it("starts checking at 20,000 bytes", () => {
    const at = (bytes: number) => ({ name: "/a.js", startTime: 0, responseEnd: 1, transferSize: bytes });
    expect(heldProblem(TEN, [at(19_999)])).toMatch(/no transfer of a size/);
    expect(heldProblem(TEN, [at(20_000)])).toMatch(/\/a\.js moved 20000 bytes/);
    // The per-start check of the engine binary is separate: 19,999 bytes of it do not count.
  });
  it("accepts a slower one, which a busy page makes", () => {
    expect(heldProblem(TEN, [wasm(2000)])).toBeNull();
  });
  it("refuses a transfer too fast for the rate, which means the limit did not reach it", () => {
    expect(heldProblem(TEN, [wasm(26)])).toMatch(/verticopolis_engine_bg\.wasm moved 449000 bytes in 26\.0 ms, under its floor of 219\.6 ms for 10 Mbps with 40 ms added latency/);
    expect(() => assertHeld(TEN, [wasm(26)], "cold start", "wasm")).toThrow(/cold start: the network limit \(10 Mbps each way with 40 ms added latency per request\) did not hold/);
  });
  it("checks every large transfer and ignores small ones", () => {
    expect(heldProblem(TEN, [wasm(380), { name: "/assets/main.js", startTime: 0, responseEnd: 5, transferSize: 900_000 }])).toMatch(/main\.js/);
    expect(heldProblem(TEN, [{ name: "/a.css", startTime: 0, responseEnd: 1, transferSize: 5000 }, wasm(380)])).toBeNull();
  });
  it("needs the engine binary among the timed transfers on a WASM page and nowhere else", () => {
    const main = { name: "/assets/main.js", startTime: 0, responseEnd: 2000, transferSize: 900_000 };
    expect(() => assertHeld(TEN, [main], "cold start", "wasm")).toThrow(/could not be proven on the engine package/);
    expect(() => assertHeld(TEN, [main, { name: ENGINE_WASM_PATH, startTime: 0, responseEnd: 5, transferSize: 0 }], "cold start", "wasm")).toThrow(/could not be proven on the engine package/);
    // A small entry for the binary (a revalidation or a stub) is not the fetch, and a preload entry with no bytes in front of the real fetch does not hide it.
    expect(() => assertHeld(TEN, [main, { name: ENGINE_WASM_PATH, startTime: 0, responseEnd: 5, transferSize: 19_999 }], "cold start", "wasm")).toThrow(/could not be proven on the engine package/);
    expect(() => assertHeld(TEN, [{ name: ENGINE_WASM_PATH, startTime: 0, responseEnd: 1, transferSize: 0 }, wasm(380)], "cold start", "wasm")).not.toThrow();
    // The binary itself is timed: a fast one fails even when the other transfers are slow.
    expect(() => assertHeld(TEN, [main, wasm(26)], "cold start", "wasm")).toThrow(/did not hold/);
    expect(ENGINE_WASM_PATH).toBe("/engine/verticopolis_engine_bg.wasm");
    expect(() => assertHeld(TEN, [main], "cold start", "ts")).not.toThrow();
  });
  it("refuses a start with nothing large to check", () => {
    expect(heldProblem(TEN, [])).toMatch(/no transfer of a size/);
    expect(heldProblem(TEN, [{ name: "/a.css", startTime: 0, responseEnd: 1, transferSize: 5000 }])).toMatch(/no transfer of a size/);
  });
});

describe("--network on the command line", () => {
  it("is off by default and leaves the config shape unchanged", () => {
    const a = parseArgs([]);
    expect(a.network).toBeNull();
    expect("network" in makeConfig(a, ["small"])).toBe(false);
  });
  it("is recorded in the config when given", () => {
    expect(makeConfig(parseArgs(["--network", "10,40"]), ["small"]).network).toEqual(TEN);
  });
  it("refuses --aa together with --network in either order, since an A/A pass feeds calibration", () => {
    expect(() => parseArgs(["--aa", "wasm", "--network", "10,40"])).toThrow(/cannot be combined with --aa/);
    expect(() => parseArgs(["--network", "10,40", "--aa", "ts"])).toThrow(/cannot be combined with --aa/);
  });
  it("refuses a bad value and a repeat", () => {
    expect(() => parseArgs(["--network", "fast"])).toThrow(/--network takes MBPS,LATENCY_MS/);
    expect(() => parseArgs(["--network", "10,40", "--network", "5,20"])).toThrow(/--network is given twice/);
    expect(() => parseArgs(["--network"])).toThrow(/needs a value/);
  });
});

/**
 * A source-text guard on where the runner sets and lifts the limit. The runner
 * needs a browser, so a refactor that moved a call would leave every other
 * test green; the order is read from its source, as contextLossWiring does for
 * the context-loss check.
 */
describe("the runner's use of the limit", () => {
  const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "runner.ts"), "utf8");
  const at = (text: string): number => {
    const i = source.indexOf(text);
    expect(i, text).toBeGreaterThan(-1);
    expect(source.indexOf(text, i + 1), `${text} appears once`).toBe(-1);
    return i;
  };
  it("sets the limit before the cold start, keeps it through the warm start, lifts it before every other pass", () => {
    const set = at("if (config.network) await limitNetwork(cdp, config.network);");
    const cold = at("const cold = await startup(page");
    const coldHeld = at('assertHeld(config.network, cold.info.resources, "cold start", engine);');
    const warm = at("const warm = await startup(page");
    const lift = at("if (config.network) await limitNetwork(cdp, null);");
    const firstPass = at("const unthrottledProbe = ");
    const memory = at("const memory = await memoryPass(");
    expect(set).toBeLessThan(cold);
    expect(cold).toBeLessThan(coldHeld);
    expect(coldHeld).toBeLessThan(warm);
    expect(warm).toBeLessThan(lift);
    expect(lift).toBeLessThan(firstPass);
    expect(firstPass).toBeLessThan(memory);
  });
  it("limits the throttled cold start from the context's creation, proves it held and lifts it right after", () => {
    const create = at("const slowCdp = await slow.newCDPSession(slowPage);");
    const set = at("if (config.network) await limitNetwork(slowCdp, config.network);");
    const start = at("const c4 = await startup(slowPage");
    const held = at("assertHeld(config.network, c4.info.resources,");
    const lift = at("await limitNetwork(slowCdp, null);");
    const probe = at("run.cpuProbe = { unthrottledMs: unthrottledProbe, throttledMs: await ev(slowPage");
    expect(create).toBeLessThan(set);
    expect(set).toBeLessThan(start);
    expect(start).toBeLessThan(held);
    expect(held).toBeLessThan(lift);
    expect(lift).toBeLessThan(probe);
  });
  it("applies a limit nowhere else", () => {
    expect(source.match(/limitNetwork\(/g)).toHaveLength(4); // a set and a lift in the page context, a set and a lift in the throttled cold start's context
  });
});
