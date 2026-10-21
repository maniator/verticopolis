import { MIN_REPS, pairedDifference } from "../perfCompare/stats";
import { treeSummary } from "../perfCompare/treeRecord";
import { browserName, rendererBanners, rendererSummary } from "../perfCompare/renderer";
import type { Metric, Ratio } from "./analysis";
import type { ReadModelResults, WorkerResults } from "./main";
import type { ModeName } from "./pageWorker";
import { aaBanner } from "./aa";
import type { ReadModelShape, Slice, Spread } from "./readModel";

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

/** A count, or a mean of counts, to one decimal when it is not whole. */
export const num = (v: number): string => (Number.isInteger(v) ? v.toLocaleString("en-US") : v.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 }));
export const pct = (share: number): string => (share > 0 && share < 0.0001 ? "<0.01%" : `${(share * 100).toFixed(share < 0.001 && share > 0 ? 2 : 1)}%`);
export const slices = (xs: readonly Slice[], top: number): string => {
  const shown = xs.slice(0, top).map((s) => `${s.name}${s.count > 1 ? ` (${s.count.toLocaleString("en-US")})` : ""} ${pct(s.share)}`);
  const rest = xs.slice(top);
  if (rest.length) shown.push(`${rest.length} more ${pct(rest.reduce((a, s) => a + s.share, 0))}`);
  return shown.join(", ");
};

/** The read model's shape per scenario (readModel.ts): what the merged
 *  save is made of, and how much of it each merge changed. */
export function readModelSection(shapes: readonly ReadModelShape[]): string[] {
  if (!shapes.length) return [];
  const lines = ["## read model", "", "Measured once per scenario on the TypeScript engine in Node (see the limitations). Shares are of the whole save in JSON characters. A merge is counted where the worker host merges; \"changed\" is units present in both saves whose records differ, as a share of the units present and as counts; \"outside the frame\" counts the changed units with at least one changed field the frame view's unit record does not carry. Merges are by reason (hour pass, revision or both).", ""];
  lines.push("| scenario | save | units | top-level keys | unit kinds | merges | share of units changed per merge, median / max | units changed per merge, median / mean / max | units touched per merge, median / mean / max | changed outside the frame, median / mean / max | unit fields changed | top-level keys changed |");
  lines.push(`|${"---|".repeat(12)}`);
  for (const s of shapes) {
    const c = s.composition;
    const unitKeys = [...new Set(s.merges.flatMap((m) => m.unitKeys))].sort();
    const topKeys = [...new Set(s.merges.flatMap((m) => m.topKeys))].sort();
    const three = (x: Spread | null): string => (x ? `${num(x.median)} / ${num(x.mean)} / ${num(x.max)}` : "n/a");
    const share = s.changedShare ? `${pct(s.changedShare.median)} / ${pct(s.changedShare.max)}` : "n/a";
    const reasons = (["hour", "revision", "both"] as const).map((r) => [r, s.merges.filter((m) => m.reason === r).length] as const).filter(([, n]) => n > 0);

    lines.push(`| ${s.scenario} | ${c.totalChars.toLocaleString("en-US")} chars | ${c.units.toLocaleString("en-US")} | ${slices(c.keys, 4)} | ${slices(c.unitKinds, 4)} | ${s.merges.length}${reasons.length ? ` (${reasons.map(([r, n]) => `${n} ${r}`).join(", ")})` : ""} | ${share} | ${three(s.changedCount)} | ${three(s.touched)} | ${three(s.outsideFrame)} | ${unitKeys.join(", ") || "none"} | ${topKeys.join(", ") || "none"} |`);
  }
  lines.push("");
  return lines;
}

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
  lines.push(`- Engine package: ${Object.entries(env.enginePackage).map(([k, v]) => `${k} \`${String(v).slice(0, 16)}\``).join(", ")}; source hash \`${env.engineBuildHash ?? "none"}\``);
  lines.push(`- Machine: ${env.cpuModel}, ${env.logicalCpus} CPUs, ${(env.totalMemoryBytes / 2 ** 30).toFixed(1)} GiB, ${env.os}; Node ${env.node}; Playwright ${env.playwright}`);
  lines.push(`- Browser: ${browserName(res.browser.channel, res.browser.executable)} ${res.browser.version ?? "unknown"} (headless${res.browser.channel ? `, channel ${res.browser.channel}` : ""}${res.browser.executable ? `, ${res.browser.executable}` : ""}${res.browser.args?.length ? `, extra switches ${res.browser.args.join(" ")}` : ""})`);
  lines.push(`- Renderer: ${rendererSummary(res.runs)}; cross-origin isolated: ${res.runs.find((r) => r.page)?.page?.crossOriginIsolated ?? "unknown"}; frames at a ${res.config.viewport.width}x${res.config.viewport.height} CSS viewport`);
  lines.push(`- ${res.config.reps} repetitions of ${modes.join(", ")}, each in a fresh browser process, order rotated by repetition; throttles ${res.config.throttles.join("x, ")}x`);
  lines.push(`- Scenarios: ${res.scenarios.map((s) => `${s.name} (${s.population} population, \`${s.sha256.slice(0, 12)}\`)`).join(", ")}`);
  lines.push(`- Download (production build, Brotli 11): engine worker chunk ${fmt(res.scripts.worker.brotli, "bytes")} (${fmt(res.scripts.worker.raw, "bytes")} raw); engine package (WASM modes) ${fmt(res.scripts.enginePackage.brotli, "bytes")} (${fmt(res.scripts.enginePackage.raw, "bytes")} raw); all other JavaScript ${fmt(res.scripts.otherJs.brotli, "bytes")}`);
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
  lines.push(...readModelSection(res.readModel ?? []));
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

/** report.md for `perf:worker --read-model`: the snapshot header, then the
 *  read model section and its limitation. */
export function readModelMarkdown(res: ReadModelResults): string {
  const lines = ["# Read model shape (npm run perf:worker -- --read-model)", ""];
  lines.push(`> **Snapshot, measured ${res.generatedAt} on commit \`${res.commit.slice(0, 7)}\` (app ${res.appVersion})${res.dirty ? ", dirty tree" : ""}, Node ${res.node}.** Live numbers: re-run \`npm run perf:worker -- --read-model\` (src/tests/perfWorker/readModel.ts, its arithmetic pinned by src/tests/perfWorker/analysis.test.ts).`);
  lines.push("");
  lines.push(`- A fresh load, then ${res.config.steps} steps of ${res.config.dt} minutes in batches of ${res.config.batch}${res.config.quick ? " (quick)" : ""}`);
  lines.push(`- Scenarios: ${res.scenarios.map((s) => `${s.name} (\`${s.sha256.slice(0, 12)}\`)`).join(", ")}`);
  lines.push("");
  lines.push(...readModelSection(res.readModel));
  lines.push("## Limitations", "");
  for (const l of res.limitations) lines.push(`- ${l}`);
  lines.push("");
  return lines.join("\n");
}
