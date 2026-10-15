import type { Metric, Ratio } from "./analysis";
import type { ReadModelResults, WorkerResults } from "./main";
import type { ModeName } from "./pageWorker";
import type { ReadModelShape, Slice } from "./readModel";

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

const pct = (share: number): string => (share > 0 && share < 0.0001 ? "<0.01%" : `${(share * 100).toFixed(share < 0.001 && share > 0 ? 2 : 1)}%`);
const slices = (xs: readonly Slice[], top: number): string => {
  const shown = xs.slice(0, top).map((s) => `${s.name}${s.count > 1 ? ` (${s.count.toLocaleString("en-US")})` : ""} ${pct(s.share)}`);
  const rest = xs.slice(top);
  if (rest.length) shown.push(`${rest.length} more ${pct(rest.reduce((a, s) => a + s.share, 0))}`);
  return shown.join(", ");
};

/** The read model's shape per scenario (readModel.ts): what the merged
 *  save is made of, and how much of it each merge changed. */
export function readModelSection(shapes: readonly ReadModelShape[]): string[] {
  if (!shapes.length) return [];
  const lines = ["## read model", "", "Measured once per scenario on the TypeScript engine in Node (see the limitations). Shares are of the whole save in JSON characters. A merge is counted where the worker host merges; \"changed\" is units present in both saves whose records differ, as a share of the units present; \"outside the frame\" counts the changed units whose changed fields are all ones the frame view's unit record does not carry.", ""];
  lines.push("| scenario | save | units | top-level keys | unit kinds | merges | units changed per merge, median / max | units touched per merge, median / max | changed outside the frame, median / max | unit fields changed | top-level keys changed |");
  lines.push(`|${"---|".repeat(11)}`);
  for (const s of shapes) {
    const c = s.composition;
    const unitKeys = [...new Set(s.merges.flatMap((m) => m.unitKeys))].sort();
    const topKeys = [...new Set(s.merges.flatMap((m) => m.topKeys))].sort();
    const share = s.changedShare ? `${pct(s.changedShare.median)} / ${pct(s.changedShare.max)}` : "n/a";
    const touched = s.touched ? `${s.touched.median} / ${s.touched.max}` : "n/a";
    const outside = s.outsideFrame ? `${s.outsideFrame.median} / ${s.outsideFrame.max}` : "n/a";
    lines.push(`| ${s.scenario} | ${c.totalChars.toLocaleString("en-US")} chars | ${c.units.toLocaleString("en-US")} | ${slices(c.keys, 4)} | ${slices(c.unitKinds, 4)} | ${s.merges.length} | ${share} | ${touched} | ${outside} | ${unitKeys.join(", ") || "none"} | ${topKeys.join(", ") || "none"} |`);
  }
  lines.push("");
  return lines;
}

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
  lines.push(`- Renderer: ${res.runs.find((r) => r.page?.webgl)?.page?.webgl?.renderer ?? "unknown"}; cross-origin isolated: ${res.runs.find((r) => r.page)?.page?.crossOriginIsolated ?? "unknown"}; frames at a ${res.config.viewport.width}x${res.config.viewport.height} CSS viewport`);
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
  lines.push(`- ${res.config.warmSteps} warm steps, then ${res.config.steps} steps of ${res.config.dt} minutes in batches of ${res.config.batch}${res.config.quick ? " (quick)" : ""}`);
  lines.push(`- Scenarios: ${res.scenarios.map((s) => `${s.name} (\`${s.sha256.slice(0, 12)}\`)`).join(", ")}`);
  lines.push("");
  lines.push(...readModelSection(res.readModel));
  lines.push("## Limitations", "");
  for (const l of res.limitations) lines.push(`- ${l}`);
  lines.push("");
  return lines.join("\n");
}
