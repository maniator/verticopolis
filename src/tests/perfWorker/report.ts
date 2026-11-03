import { MIN_REPS, pairedDifference } from "../perfCompare/stats";
import { treeSummary } from "../perfCompare/treeRecord";
import { browserName, rendererBanners, rendererSummary } from "../perfCompare/renderer";
import type { Metric, Ratio } from "./analysis";
import type { WorkerResults } from "./main";
import type { ModeName } from "./pageWorker";
import { aaBanner } from "./aa";

/** report.md for a `perf:worker` run: the snapshot header, the medians per
 *  mode with their intervals, and the paired ratios against the shipped
 *  host and against TypeScript. Prose interpretation lives in the doc. */

const fmt = (v: number | null | undefined, unit: string): string => {
  if (v === null || v === undefined || !Number.isFinite(v)) return "n/a";
  if (unit === "bytes" || unit === "bytes/s") return v >= 1024 * 1024 ? `${(v / 1024 / 1024).toFixed(2)} MiB` : `${(v / 1024).toFixed(1)} KiB`;
  if (Math.abs(v) >= 100) return v.toFixed(0);
  if (Math.abs(v) >= 10) return v.toFixed(1);
  return v.toFixed(2);
};

const cell = (m: Metric | undefined): string => {
  const s = m?.summary;
  if (!s) return "n/a";
  const ci = s.medianCiLow !== null && s.medianCiHigh !== null ? ` [${fmt(s.medianCiLow, m!.unit)}, ${fmt(s.medianCiHigh, m!.unit)}]` : "";
  return `${fmt(s.median, m!.unit)}${ci}${m!.unthrottled ? " †" : ""}`;
};

/** Metrics the gate judges by an additive paired difference (protocol section 5, M4: a zero TypeScript reference has no ratio). Their gate cell prints that difference instead of a ratio. */
const DIFFERENCE_GATED = /^main-thread blocking/;

/**
 * The gate cell of a metric judged by a paired difference (M4): the median of
 * wasm minus ts per repetition, with the 95% interval of the median, in the
 * metric's unit. The upper end of the interval is the statistic ε is read
 * against (protocol 6.1), the same one `perf:calibrate` computes for a pass.
 * Above zero is worse. Pairs are by repetition number.
 */
export function differenceCell(wasm: Metric | undefined, ts: Metric | undefined, aa = false): string {
  if (!wasm || !ts) return "n/a";
  const d = pairedDifference(wasm, ts);
  if (!d) return "n/a";
  const ci = d.ciLow !== null && d.ciHigh !== null ? ` [${fmt(d.ciLow, wasm.unit)}, ${fmt(d.ciHigh, wasm.unit)}]` : " (no interval)";
  const thin = d.n < MIN_REPS ? `, below the gate's minimum of ${MIN_REPS} pairs` : "";
  return `${fmt(d.median, wasm.unit)}${ci}, ${d.n} pairs (${aa ? "slot wasm minus slot ts" : "wasm minus ts"})${thin}`;
}

/** `verdict` false for an A/A folder, which has no verdict words: the interval is the data. */
const ratioCell = (r: Ratio | undefined, verdict = true): string => {
  if (!r) return "";
  const ci = r.ciLow !== null && r.ciHigh !== null ? ` [${r.ciLow.toFixed(2)}, ${r.ciHigh.toFixed(2)}]` : "";
  return `${r.ratio.toFixed(2)}x${ci}${verdict ? ` ${r.verdict}` : ""}${r.zeroReference ? ` (${r.zeroReference} zero)` : ""}${r.unthrottled ? " †" : ""}`;
};

export function markdown(res: WorkerResults): string {
  const modes = res.config.modes;
  const env = res.environment;
  const lines: string[] = [];
  const aa = res.config.aa ?? null;
  lines.push(aa ? `# Worker host A/A pass (npm run perf:worker -- --aa ${aa})` : "# Worker host benchmark (npm run perf:worker)");
  lines.push("");
  lines.push(`> **Snapshot, measured ${res.startedAt} to ${res.generatedAt} on commit \`${env.commitShort}\` (app ${env.appVersion})${env.dirty ? ", dirty tree" : ""}.** Live numbers: re-run \`npm run perf:worker\` (src/tests/perfWorker/, its arithmetic pinned by src/tests/perfWorker/analysis.test.ts). ${res.validation.ok ? "Validation passed." : "VALIDATION FAILED: see the end of this report."}`);
  if (aa) lines.push("", aaBanner(aa));
  for (const banner of rendererBanners(res.browser, res.config.quick)) lines.push("", banner);
  lines.push("");
  if (treeSummary(env.tree, env.dirty)) lines.push(`- Working tree: ${treeSummary(env.tree, env.dirty)}`);
  if (res.tsBaseline) lines.push(`- TypeScript baseline: ${res.tsBaseline.commit} (app ${res.tsBaseline.appVersion}, pinned pre-cutover build; ${aa ? "both slots ran it" : "the ts mode ran it, the other modes ran this commit"})`);
  lines.push(`- Engine package: ${Object.entries(env.enginePackage).map(([k, v]) => `${k} \`${String(v).slice(0, 16)}\``).join(", ")}; source hash \`${env.engineBuildHash ?? "none"}\``);
  lines.push(`- Machine: ${env.cpuModel}, ${env.logicalCpus} CPUs, ${(env.totalMemoryBytes / 2 ** 30).toFixed(1)} GiB, ${env.os}; Node ${env.node}; Playwright ${env.playwright}`);
  lines.push(`- Browser: ${browserName(res.browser.channel, res.browser.executable)} ${res.browser.version ?? "unknown"} (headless${res.browser.channel ? `, channel ${res.browser.channel}` : ""}${res.browser.executable ? `, ${res.browser.executable}` : ""}${res.browser.args?.length ? `, extra switches ${res.browser.args.join(" ")}` : ""})`);
  lines.push(`- Renderer: ${rendererSummary(res.runs)}; cross-origin isolated: ${res.runs.find((r) => r.page)?.page?.crossOriginIsolated ?? "unknown"}; frames at a ${res.config.viewport.width}x${res.config.viewport.height} CSS viewport`);
  lines.push(`- ${res.config.reps} repetitions of ${modes.join(", ")}, each in a fresh browser process, order rotated by repetition; throttles ${res.config.throttles.join("x, ")}x`);
  lines.push(`- Scenarios: ${res.scenarios.map((s) => `${s.name} (${s.population} population, \`${s.sha256.slice(0, 12)}\`)`).join(", ")}`);
  lines.push(`- Download (production build, Brotli 11): engine worker chunk ${res.scripts.worker ? `${fmt(res.scripts.worker.brotli, "bytes")} (${fmt(res.scripts.worker.raw, "bytes")} raw)` : "not run (this build has none)"}; engine package (WASM modes) ${fmt(res.scripts.enginePackage.brotli, "bytes")} (${fmt(res.scripts.enginePackage.raw, "bytes")} raw); all other JavaScript ${fmt(res.scripts.otherJs.brotli, "bytes")}`);
  lines.push("");
  lines.push("Medians with their 95% order-statistic interval. Ratios are paired by repetition (mode over the column's reference); a verdict needs six pairs and an interval clear of a 5% band. `wasm-worker / wasm-frame` compares two hosts with the same sync changes, so it is the worker placement alone; `wasm-frame / wasm` is the sync changes alone. The gate column leads with the gate's orientation; the full set of ratios is in ratios.csv. A ratio marked with `(k zero)` dropped k repetitions where the reference was 0.");
  lines.push("");
  if (res.metrics.some((m) => m.unthrottled)) lines.push("† The engine worker was barely CPU-throttled: DevTools cannot throttle a worker, so at this throttle the worker host's main thread ran throttled and its engine thread ran 7 to 41% slower in the probe, against about 4x on the main thread. Compare such a row only with another run of the same mode.", "");
  const groups: Metric["group"][] = ["startup", "raw", "hosted", "frames", "memory", "traffic"];
  for (const g of groups) {
    const rows = res.metrics.filter((m) => m.group === g);
    if (!rows.length) continue;
    lines.push(`## ${g}`);
    lines.push("");
    const keys = [...new Set(rows.map((m) => `${m.scenario}|${m.throttle}|${m.metric}|${m.unit}`))];
    const present = modes.filter((mode) => rows.some((m) => m.mode === mode && m.summary));
    // The gate's orientation leads (protocol section 5): the shipped host over
    // TypeScript, read so that above 1.0 is worse, which for a rate (better:
    // higher) means TypeScript over the shipped host. The other columns keep
    // each mode over the shipped host.
    const gate = present.includes("ts") && present.includes("wasm");
    const cols: [ModeName, ModeName][] = [...present.filter((m) => m !== "wasm" && !(gate && m === "ts")).map((m) => [m, "wasm"] as [ModeName, ModeName]), ...(present.includes("wasm-worker") && present.includes("wasm-frame") ? [["wasm-worker", "wasm-frame"] as [ModeName, ModeName]] : [])];
    const row = (cells: string[]) => `| ${cells.join(" | ")} |`;
    const header = ["scenario", "throttle", "metric", ...(gate ? [aa ? "slot wasm / slot ts (rates: ts / wasm)" : "gate: wasm / ts (rates: ts / wasm)"] : []), ...present.map((m) => (aa ? `slot ${m}` : m)), ...cols.map(([a, b]) => `${a} / ${b}`)];
    lines.push(row(header));
    lines.push(row(header.map(() => "---")));
    for (const k of keys) {
      const [scenario, throttle, metric, unit] = k.split("|");
      const of = (mode: ModeName) => rows.find((m) => m.scenario === scenario && m.throttle === throttle && m.metric === metric && m.mode === mode);
      const ratio = (mode: ModeName, against: ModeName) => res.ratios.find((r) => r.scenario === scenario && r.throttle === throttle && r.metric === metric && r.mode === mode && r.against === against);
      const higher = (of("wasm") ?? rows.find((m) => m.scenario === scenario && m.throttle === throttle && m.metric === metric))?.better === "higher";
      lines.push(row([scenario, `${throttle}x`, `${metric} (${unit})`, ...(gate ? [DIFFERENCE_GATED.test(metric) ? differenceCell(of("wasm"), of("ts"), !!aa) : ratioCell(higher ? ratio("ts", "wasm") : ratio("wasm", "ts"), !aa)] : []), ...present.map((m) => cell(of(m))), ...cols.map(([a, b]) => ratioCell(ratio(a, b), !aa))]));
    }
    lines.push("");
  }
  lines.push("## Offline restart");
  lines.push("");
  for (const mode of modes) {
    const off = res.runs.filter((r) => r.mode === mode && r.offline);
    const seen = [...new Set(off.map((r) => (r.offline!.error ? `failed: ${r.offline!.error}` : `${r.offline!.onlineMode} online, ${r.offline!.offlineMode ?? "none"} offline${r.offline!.swActive ? "" : " (no service worker)"}`)))];
    lines.push(`- ${mode}: ${seen.join("; ") || "not measured"}`);
  }
  lines.push("");
  lines.push("## Validation");
  lines.push("");
  lines.push(res.validation.errors.length ? res.validation.errors.map((e) => `- error: ${e}`).join("\n") : "- no errors");
  for (const w of res.validation.warnings) lines.push(`- warning: ${w}`);
  lines.push("");
  lines.push("## Limitations");
  lines.push("");
  for (const l of res.limitations) lines.push(`- ${l}`);
  lines.push("");
  return lines.join("\n");
}
