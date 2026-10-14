import type { Metric, Ratio } from "./analysis";
import type { WorkerResults } from "./main";
import type { ModeName } from "./pageWorker";

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
  return `${fmt(s.median, m!.unit)}${ci}`;
};

const ratioCell = (r: Ratio | undefined): string => {
  if (!r) return "";
  const ci = r.ciLow !== null && r.ciHigh !== null ? ` [${r.ciLow.toFixed(2)}, ${r.ciHigh.toFixed(2)}]` : "";
  return `${r.ratio.toFixed(2)}x${ci} ${r.verdict}${r.zeroReference ? ` (${r.zeroReference} zero)` : ""}`;
};

export function markdown(res: WorkerResults): string {
  const modes = res.config.modes;
  const env = res.environment;
  const lines: string[] = [];
  lines.push("# Worker host benchmark (npm run perf:worker)");
  lines.push("");
  lines.push(`> **Snapshot, measured ${res.startedAt} to ${res.generatedAt} on commit \`${env.commitShort}\` (app ${env.appVersion})${env.dirty ? ", dirty tree" : ""}.** Live numbers: re-run \`npm run perf:worker\` (src/tests/perfWorker/, its arithmetic pinned by src/tests/perfWorker/analysis.test.ts). ${res.validation.ok ? "Validation passed." : "VALIDATION FAILED: see the end of this report."}`);
  lines.push("");
  lines.push(`- Engine package: ${Object.entries(env.enginePackage).map(([k, v]) => `${k} \`${String(v).slice(0, 16)}\``).join(", ")}; source hash \`${env.engineBuildHash ?? "none"}\``);
  lines.push(`- Machine: ${env.cpuModel}, ${env.logicalCpus} CPUs, ${(env.totalMemoryBytes / 2 ** 30).toFixed(1)} GiB, ${env.os}; Node ${env.node}; Playwright ${env.playwright}; browser ${res.browser.version}`);
  lines.push(`- Renderer: ${res.runs.find((r) => r.page?.webgl)?.page?.webgl?.renderer ?? "unknown"}; cross-origin isolated: ${res.runs.find((r) => r.page)?.page?.crossOriginIsolated ?? "unknown"}`);
  lines.push(`- ${res.config.reps} repetitions of ${modes.join(", ")}, each in a fresh browser process, order rotated by repetition; throttles ${res.config.throttles.join("x, ")}x`);
  lines.push(`- Scenarios: ${res.scenarios.map((s) => `${s.name} (${s.population} population, \`${s.sha256.slice(0, 12)}\`)`).join(", ")}`);
  lines.push(`- Download (production build, Brotli 11): engine worker chunk ${fmt(res.scripts.worker.brotli, "bytes")} (${fmt(res.scripts.worker.raw, "bytes")} raw); engine package (WASM modes) ${fmt(res.scripts.enginePackage.brotli, "bytes")} (${fmt(res.scripts.enginePackage.raw, "bytes")} raw); all other JavaScript ${fmt(res.scripts.otherJs.brotli, "bytes")}`);
  lines.push("");
  lines.push("Medians with their 95% order-statistic interval. Ratios are paired by repetition (mode over the column's reference); a verdict needs six pairs and an interval clear of a 5% band. `wasm-worker / wasm-frame` compares two hosts with the same sync changes, so it is the worker placement alone; `wasm-frame / wasm` is the sync changes alone. Ratios against TypeScript are in ratios.csv. A ratio marked with `(k zero)` dropped k repetitions where the reference was 0.");
  lines.push("");
  const groups: Metric["group"][] = ["startup", "raw", "hosted", "frames", "memory", "traffic"];
  for (const g of groups) {
    const rows = res.metrics.filter((m) => m.group === g);
    if (!rows.length) continue;
    lines.push(`## ${g}`);
    lines.push("");
    const keys = [...new Set(rows.map((m) => `${m.scenario}|${m.throttle}|${m.metric}|${m.unit}`))];
    const present = modes.filter((mode) => rows.some((m) => m.mode === mode && m.summary));
    const cols: [ModeName, ModeName][] = [...present.filter((m) => m !== "wasm").map((m) => [m, "wasm"] as [ModeName, ModeName]), ...(present.includes("wasm-worker") && present.includes("wasm-frame") ? [["wasm-worker", "wasm-frame"] as [ModeName, ModeName]] : [])];
    lines.push(`| scenario | throttle | metric | ${present.join(" | ")} | ${cols.map(([a, b]) => `${a} / ${b}`).join(" | ")} |`);
    lines.push(`|${"---|".repeat(3 + present.length + cols.length)}`);
    for (const k of keys) {
      const [scenario, throttle, metric, unit] = k.split("|");
      const of = (mode: ModeName) => rows.find((m) => m.scenario === scenario && m.throttle === throttle && m.metric === metric && m.mode === mode);
      const ratio = (mode: ModeName, against: ModeName) => res.ratios.find((r) => r.scenario === scenario && r.throttle === throttle && r.metric === metric && r.mode === mode && r.against === against);
      lines.push(`| ${scenario} | ${throttle}x | ${metric} (${unit}) | ${present.map((m) => cell(of(m))).join(" | ")} | ${cols.map(([a, b]) => ratioCell(ratio(a, b))).join(" | ")} |`);
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
