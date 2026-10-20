import { treeSummary } from "./treeRecord";
import { browserName, rendererBanners, rendererSummary } from "./renderer";
import { MIN_REPS, pairedDifference } from "./stats";
import type { CompareResults, Comparison, EngineName, MetricRow } from "./types";

/**
 * The comparison's written outputs (issue #972): a summary CSV (one row per
 * metric and engine), a raw CSV (one row per repetition's value), and a
 * generated Markdown report. The hand-written analysis lives in
 * docs/performance/ts-vs-wasm.md and cites these files.
 */

export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  let s = String(v);
  if (typeof v === "number" && !Number.isInteger(v)) s = v.toPrecision(6);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: string[], rows: unknown[][]): string {
  return [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\n") + "\n";
}

/** An A/A folder's CSVs end in a column naming the engine that ran in both
 *  slots, so a file read apart from results.json still says what it is. */
function csvOf(header: string[], rows: unknown[][], aa: EngineName | null): string {
  return aa ? toCsv([...header, "aa"], rows.map((r) => [...r, aa])) : toCsv(header, rows);
}

export function summaryCsv(rows: readonly MetricRow[], aa: EngineName | null): string {
  return csvOf(
    ["group", "scenario", "throttle", "metric", "unit", "engine", "n", "median", "median_ci_low", "median_ci_high", "p95", "mean", "sd", "cv", "min", "max"],
    rows.map((r) => [r.group, r.scenario, r.throttle, r.metric, r.unit, r.engine, r.values.length, r.summary?.median, r.summary?.medianCiLow, r.summary?.medianCiHigh, r.summary?.p95, r.summary?.mean, r.summary?.sd, r.summary?.cv, r.summary?.min, r.summary?.max]),
    aa,
  );
}

export function rawCsv(rows: readonly MetricRow[], aa: EngineName | null): string {
  const out: unknown[][] = [];
  for (const r of rows) r.values.forEach((v, i) => out.push([r.group, r.scenario, r.throttle, r.metric, r.unit, r.engine, r.reps[i], v]));
  return csvOf(["group", "scenario", "throttle", "metric", "unit", "engine", "rep", "value"], out, aa);
}

export function comparisonsCsv(rows: readonly Comparison[], aa: EngineName | null): string {
  return csvOf(
    ["group", "scenario", "throttle", "metric", "unit", "ts_median", "wasm_median", "wasm_over_ts_paired", "ci_low", "ci_high", "verdict", "n_ts", "n_wasm", "n_pairs"],
    rows.map((c) => [c.group, c.scenario, c.throttle, c.metric, c.unit, c.tsMedian, c.wasmMedian, c.ratio, c.ciLow, c.ciHigh, c.verdict, c.n.ts, c.n.wasm, c.n.pairs]),
    aa,
  );
}

/** A value in its unit, for tables. */
export function fmt(v: number | null | undefined, unit: string): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "n/a";
  if (unit === "bytes") {
    if (Math.abs(v) >= 1024 * 1024) return `${(v / (1024 * 1024)).toFixed(2)} MiB`;
    if (Math.abs(v) >= 1024) return `${(v / 1024).toFixed(1)} KiB`;
    return `${v.toFixed(0)} B`;
  }
  if (unit === "ratio") return `${(v * 100).toFixed(1)}%`;
  if (unit === "ms") {
    // By size, so a negative paired difference rounds like a positive one.
    const size = Math.abs(v);
    if (size >= 100) return `${v.toFixed(0)} ms`;
    return size >= 1 ? `${v.toFixed(2)} ms` : `${v.toFixed(3)} ms`;
  }
  return `${v.toFixed(2)} ${unit}`;
}

function ratioText(c: Comparison): string {
  const ci = c.ciLow !== null && c.ciHigh !== null ? ` (${c.ciLow.toFixed(2)} to ${c.ciHigh.toFixed(2)})` : "";
  return `${c.ratio.toFixed(2)}x${ci}`;
}

function table(header: string[], rows: string[][]): string {
  const line = (r: string[]) => `| ${r.join(" | ")} |`;
  return [line(header), line(header.map(() => "---")), ...rows.map(line)].join("\n");
}

/**
 * M5's statistic (protocol 6.1 step 2): the median of the cold start to ready,
 * wasm minus ts per repetition, with the 95% interval of the median. The upper
 * end is the value `perf:calibrate` reads against ε for a pass
 * (`coldStartDifference`); both come from `pairedDifference`.
 */
export function coldStartDifferenceLines(metrics: readonly MetricRow[], aa: EngineName | null): string[] {
  const rows = metrics.filter((m) => m.group === "startup" && m.metric === "cold game ready");
  const throttles = [...new Set(rows.map((m) => m.throttle))];
  const lines = throttles.flatMap((t) => {
    const wasm = rows.find((m) => m.throttle === t && m.engine === "wasm");
    const ts = rows.find((m) => m.throttle === t && m.engine === "ts");
    const d = wasm && ts ? pairedDifference(wasm, ts) : null;
    if (!d) return [];
    const ci = d.ciLow !== null && d.ciHigh !== null ? `${fmt(d.ciLow, "ms")} to ${fmt(d.ciHigh, "ms")}` : "no interval";
    return [[`${t}x`, fmt(d.median, "ms"), ci, d.n < MIN_REPS ? `${d.n} (below the gate's minimum of ${MIN_REPS})` : String(d.n)]];
  });
  if (!lines.length) return [];
  const sign = aa ? "slot wasm minus slot ts" : "WASM minus TypeScript";
  return ["", `Cold start to ready, paired difference (${sign}; above zero is worse):`, "", table(["CPU", "Median", "95% CI of median", "Pairs"], lines)];
}

export function markdownReport(res: CompareResults): string {
  const e = res.environment;
  const aa = res.config.aa;
  const out: string[] = [];
  out.push(`# ${aa ? "A/A pass" : "Engine comparison results"}: ${e.commitShort}`, "");
  out.push(
    `> **Snapshot, not a live figure.** Measured ${res.startedAt ?? "?"} to ${res.generatedAt} on commit \`${e.commit}\`${e.dirty ? " (dirty tree)" : ""} (app ${e.appVersion}), with public main at \`${e.mainCommit ?? "unknown"}\`${e.mainFetched === false ? " as last fetched (the fetch before the run failed)" : ""}.${preThree(e.appVersion) ? " A pre-3.0 baseline of an engine still being cut over (#945), not release performance." : ""} The live number comes from ${aa ? `\`npm run perf:calibrate\` over fresh A/A folders, made by re-running \`npm run perf:compare -- --aa ${aa}\`` : "re-running `npm run perf:compare`"} (src/tests/perfCompare, its tests beside it); this file never refreshes.`,
    "",
  );
  if (aa) {
    out.push(`> **A/A pass.** Both slots ran the ${aa === "wasm" ? "WASM" : "TypeScript"} engine. The "ts" and "wasm" labels below name the two slots, and every ratio is slot "wasm" over slot "ts". This folder is one input to \`npm run perf:calibrate\` (docs/performance/benchmark-protocol.md, section 6.1), which derives the candidate tolerances from many passes per engine. No tolerance is read off one folder, and there is no verdict: the intervals are the data. Rows the ${aa === "wasm" ? "TypeScript" : "WASM"} engine alone produces, and the cold WASM load steps, are left out.`, "");
  }
  out.push(`Generated by \`npm run perf:compare${aa ? ` -- --aa ${aa}` : ""}\` (${res.issue}). Machine-written; ${aa ? "A/A folders are not comparison results, and the engine analysis" : "the analysis"} is in \`docs/performance/ts-vs-wasm.md\`.`, "");
  for (const banner of rendererBanners(res.browser, res.config.quick)) out.push(banner, "");
  out.push(`**Validation: ${res.validation.ok ? "passed" : "FAILED"}.**`, "");
  for (const err of res.validation.errors) out.push(`- error: ${err}`);
  for (const w of res.validation.warnings) out.push(`- warning: ${w}`);
  out.push("", "## Environment", "");
  out.push(
    table(
      ["Item", "Value"],
      [
        ["Commit", `${e.commit}${e.dirty ? " (dirty tree)" : ""} on ${e.branch}`],
        ...(treeSummary(e.tree, e.dirty) ? [["Working tree", treeSummary(e.tree, e.dirty)!]] : []),
        ["Public main (origin/main as last fetched)", e.mainCommit ? `${e.mainCommit} (merge base ${e.mergeBase ?? "unknown"}; ${e.behindMain === 0 ? "this tree contains it" : `${e.behindMain ?? "?"} commit(s) of it missing here`})` : "unknown"],
        ["App version", e.appVersion],
        ["OS", `${e.os} (kernel ${e.kernel}, ${e.arch})`],
        ["CPU", `${e.cpuModel}, ${e.logicalCpus} logical CPUs`],
        ["Memory", fmt(e.totalMemoryBytes, "bytes")],
        ["Browser", `${browserName(res.browser.channel, res.browser.executable)} ${res.browser.version ?? "unknown"} (headless${res.browser.channel ? `, channel ${res.browser.channel}` : ""}${res.browser.executable ? `, ${res.browser.executable}` : ""}${res.browser.args?.length ? `, extra switches ${res.browser.args.join(" ")}` : ""})`],
        ["Node", e.node],
        ["Rust", e.rust ?? "not installed"],
        ["Playwright", e.playwright ?? "unknown"],
        ["Engine package bytes (SHA-256)", Object.entries(e.enginePackage ?? {}).map(([f, h]) => `${f} ${h.slice(0, 16)}`).join(", ") || "missing"],
        ["Engine package hash", `${e.engineBuildHash ?? "missing"}${e.engineSourceHash && e.engineBuildHash !== e.engineSourceHash ? ` (sources: ${e.engineSourceHash}, MISMATCH)` : ""}`],
        ["WebGL renderer", rendererSummary(res.runs)],
        ["Cross-origin isolated", String(res.runs.find((r) => r.page)?.page?.crossOriginIsolated ?? "unknown")],
        ["Timer resolution", fmt(res.runs.find((r) => r.page)?.page?.timerResolutionMs, "ms")],
      ],
    ),
  );
  const c = res.config;
  out.push("", "## Configuration", "");
  out.push(`${c.reps} repetitions per ${aa ? "slot" : "engine"}, each in a fresh browser process, ${aa ? "slot" : "engine"} order alternating. Simulation: ${c.steps} steps of ${c.dt} in-game minutes (${(c.steps * c.dt) / 60} in-game hours) after ${c.warmSteps} warmup steps on a throwaway instance. Frames: ${c.frameWindowMs} ms window after ${c.frameWarmMs} ms warmup at speed index ${c.speed}. CPU throttles: ${c.throttles.join("x, ")}x. Viewport ${c.viewport.width}x${c.viewport.height} at DPR 1.${c.quick ? " Quick mode (smoke test)." : ""}`, "");
  out.push(table(["Scenario", "Source", "Population", "Units", "Transports", "Save", "Save SHA-256"], res.scenarios.map((s) => [s.name, s.description, String(s.population), String(s.units), String(s.transports), fmt(s.saveBytes, "bytes"), `\`${s.sha256.slice(0, 16)}\``])));
  out.push("", "## Outcome checks (Node, conformance digests)", "");
  out.push(table(["Scenario", "Steps", "Start state", "End state", "End crowd", "Match"], res.nodeChecks.map((n) => [n.scenario, String(n.steps), n.start.tsState === n.start.wasmState ? "same" : "DIFFERENT", n.end.tsState === n.end.wasmState ? "same" : "DIFFERENT", n.end.tsCrowd === n.end.wasmCrowd ? "same" : "DIFFERENT", n.match ? "yes" : "NO"])));
  if (res.churn?.length) {
    out.push("", "## Hourly save churn (WASM engine, Node)", "");
    out.push("The share of the serialized save that changes from one in-game hour to the next, counted in units (each element of a top-level array, each property of a top-level object; src/tests/perfCompare/churn.ts). It sizes what a \"changed since last sent\" contract would send each hour. The character counts are the units' JSON text only, without keys and punctuation between units, and a unit that disappears counts as changed. Sections lists the five largest by size: their share of the save, then their own median hourly churn.", "");
    out.push(
      table(
        ["Scenario", "Unit text (characters)", "Hours", "Median", "p95", "Max", "Largest sections (share of save / own churn)"],
        res.churn.map((c) => [
          c.scenario,
          String(c.saveChars),
          String(c.hours),
          fmt(c.medianShare, "ratio"),
          fmt(c.p95Share, "ratio"),
          fmt(c.maxShare, "ratio"),
          Object.entries(c.sections)
            .sort((a, b) => b[1].saveShare - a[1].saveShare)
            .slice(0, 5)
            .map(([name, s]) => `${name} ${fmt(s.saveShare, "ratio")} / ${fmt(s.medianChurn, "ratio")}`)
            .join("; "),
        ]),
      ),
    );
  }
  const groups: [string, CompareResults["comparisons"][number]["group"]][] = [
    ["Startup (CPU column: 1x, or the throttled cold start)", "startup"],
    ...(aa ? [] : [["WASM load steps (TypeScript page, never compiled before)", "wasm-load"] as [string, CompareResults["comparisons"][number]["group"]]]),
    ["Simulation only, engine as the app hosts it", "sim-hosted"],
    ["Simulation only, bare engine", "sim-raw"],
    ["Gameplay frames, audio off (never started)", "frames"],
    ["Gameplay frames, audio on", "frames-audio"],
    ["Memory and save load", "memory"],
    ["Transfer (bytes the server sent)", "transfer"],
  ];
  for (const [title, g] of groups) {
    out.push("", `## ${title}`, "");
    const comps = res.comparisons.filter((x) => x.group === g);
    const single = res.metrics.filter((m) => m.group === g && !comps.some((x) => x.scenario === m.scenario && x.throttle === m.throttle && x.metric === m.metric));
    if (comps.length) {
      const head = aa ? ['slot "ts" median', 'slot "wasm" median', 'slot wasm / slot ts, paired (95% CI)'] : ["TypeScript median", "WASM median", "WASM / TS, paired (95% CI)"];
      out.push(table(["Scenario", "CPU", "Metric", ...head, ...(aa ? [] : ["Verdict"]), "n (ts/wasm/pairs)"], comps.map((x) => [x.scenario, `${x.throttle}x`, x.metric, fmt(x.tsMedian, x.unit), fmt(x.wasmMedian, x.unit), ratioText(x), ...(aa ? [] : [x.verdict]), `${x.n.ts}/${x.n.wasm}/${x.n.pairs}`])));
    }
    if (g === "startup") out.push(...coldStartDifferenceLines(res.metrics, aa));
    if (single.length) {
      out.push("");
      out.push(table(["Scenario", "CPU", "Metric", aa ? "Slot" : "Engine", "Median", "95% CI of median", "p95", "CV", "n"], single.map((m) => [m.scenario, `${m.throttle}x`, m.metric, m.engine, fmt(m.summary?.median, m.unit), m.summary?.medianCiLow != null ? `${fmt(m.summary.medianCiLow, m.unit)} to ${fmt(m.summary.medianCiHigh, m.unit)}` : "n/a", fmt(m.summary?.p95, m.unit), m.summary ? `${(m.summary.cv * 100).toFixed(1)}%` : "n/a", String(m.values.length)])));
      const reasons = [...new Set(single.flatMap((m) => (m.noVerdict ? [m.noVerdict] : [])))];
      for (const r of reasons) out.push("", `No engine comparison for ${[...new Set(single.filter((m) => m.noVerdict === r).map((m) => m.metric))].join(", ")}: ${r}.`);
    }
  }
  if (res.bundle) {
    out.push("", "## Production build sizes", "");
    out.push(table(["Category", "Files", "Raw", "gzip -9", "Brotli 11"], Object.entries(res.bundle.byCategory).sort((a, b) => b[1].raw - a[1].raw).map(([k, v]) => [k, String(v.files), fmt(v.raw, "bytes"), fmt(v.gzip, "bytes"), fmt(v.brotli, "bytes")])));
    const t = res.bundle.totals;
    out.push("", table(["Total", "Raw", "gzip -9", "Brotli 11"], [
      ["Game files (no source maps, help/gallery pages or dual-run worker)", fmt(t.game.raw, "bytes"), fmt(t.game.gzip, "bytes"), fmt(t.game.brotli, "bytes")],
      ["Game files without the WASM engine", fmt(t.gameWithoutWasm.raw, "bytes"), fmt(t.gameWithoutWasm.gzip, "bytes"), fmt(t.gameWithoutWasm.brotli, "bytes")],
      ["WASM engine files alone (binary, glue, BUILD.json)", fmt(t.wasmOnly.raw, "bytes"), fmt(t.wasmOnly.gzip, "bytes"), fmt(t.wasmOnly.brotli, "bytes")],
      ["Everything in dist/", fmt(t.everything.raw, "bytes"), fmt(t.everything.gzip, "bytes"), fmt(t.everything.brotli, "bytes")],
    ]));
    if (res.toolingBundleTotals) {
      const d = res.toolingBundleTotals.game.brotli - t.game.brotli;
      out.push("", `The timed runs used the VC_TOOLING=1 build of the same sources; its game files are ${fmt(res.toolingBundleTotals.game.brotli, "bytes")} Brotli (${d >= 0 ? "+" : ""}${fmt(d, "bytes")} against the production build above).`);
    }
    out.push("", `Precache: ${res.bundle.precache.entries} entries, ${fmt(res.bundle.precache.raw, "bytes")} raw, ${fmt(res.bundle.precache.brotli, "bytes")} Brotli.`);
    if (res.bundle.wasm) {
      out.push("", `WASM sections of \`${res.bundle.wasm.path}\` (${fmt(res.bundle.wasm.raw, "bytes")}; custom sections ${fmt(res.bundle.wasm.customBytes, "bytes")}):`, "");
      out.push(table(["Section", "Bytes"], res.bundle.wasm.sections.map((s) => [s.name, fmt(s.bytes, "bytes")])));
    }
  }
  const offlineOf = (r: CompareResults["runs"][number]): string => {
    const f = r.firstVisitWithServiceWorker!;
    const who = aa ? `slot ${r.engine}` : r.engine;
    if (f.error) return `${who}: failed (${f.error})`;
    if (!f.swActive) return `${who}: no service worker`;
    return `${who}: ${f.offlineEngineActive ?? "did not boot"}`;
  };
  const offline = res.runs.filter((r) => r.firstVisitWithServiceWorker).map(offlineOf);
  out.push("", "## Offline reload after a first visit", "", "Which engine the page booted on when reloaded with the network cut, per process:", "", offline.join("; ") || "not measured");
  out.push("", "## Process runs", "");
  out.push(table(["Rep", aa ? "Slot" : "Engine", "Order", "OK", "Error", "Page errors", "Audio"], res.runs.map((r) => [String(r.rep), aa ? `${r.engine} (ran ${r.ranEngine ?? r.engine})` : r.engine, String(r.order), r.ok ? "yes" : "NO", r.error ?? "", String(r.pageErrors.length), r.audio ? `${r.audio.started ? "started" : "not started"} (${r.audio.contexts.join(", ") || "no context"})` : "n/a"])));
  out.push("", "## Limitations", "");
  for (const l of res.limitations) out.push(`- ${l}`);
  return out.join("\n") + "\n";
}

/** True for an app version before 3.0.0, the release that makes the WASM
 *  engine the default (#945): such a run is a pre-cutover baseline. */
export function preThree(version: string): boolean {
  const major = Number(version.split(".")[0]);
  return Number.isFinite(major) && major < 3;
}
