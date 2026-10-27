import type { EngineBootState } from "./engineBoot";
import { parseEngineIdentity, type EngineIdentity } from "./engineIdentity";
import { shortId, type ExpectedEnginePackage } from "./enginePackageRecord";
import type { BuildMetadataResult } from "./buildSection";

/**
 * The engine diagnostics report (#963): one plain-data answer to "which build
 * and which engine was that?" for About and its Copy Diagnostics button. It
 * joins the app version, the engine boot settled on, the host's status, what
 * the shell was built to run (`__ENGINE_PACKAGE__`) and the record the engine
 * itself reports. Every input is optional, so the report builds, and copies,
 * when the engine never loaded.
 *
 * Two hashes appear and are different facts. The package id is a SHA-256 over
 * the digests of the served glue and compiled binary (it says which files
 * these are). The source hash is the hash of the Rust sources the binary was
 * built from, stamped into the binary's `verticopolis.build` section by the
 * build (it says which engine code those files came from). The core engine
 * does not carry it, so a missing or malformed section leaves the engine
 * running and the source hash unavailable.
 *
 * The text carries versions, codes, digests, the browser and the engine's own
 * error text. It holds no save and no player data, but an engine error message
 * can quote a tower name (a hand-edited save controls it), so it is something
 * the player sends on purpose, never something the page sends by itself.
 */
export type DiagnosticsState =
  | "ok"
  | "typescript"
  | "not-loaded"
  | "mismatch"
  | "unavailable";

export interface DiagnosticsRow {
  label: string;
  value: string;
}

export interface DiagnosticsReport {
  state: DiagnosticsState;
  /** One sentence for the top of the block. */
  summary: string;
  rows: DiagnosticsRow[];
  /** The rows as `Label: value` lines under a heading, for the clipboard. */
  text: string;
}

export interface DiagnosticsHost {
  hosted?: boolean;
  placement?: "worker";
  lastError?: string | null;
  droppedErrors?: number;
  /** The code and stage of the latest fallback to the TypeScript engine
   *  (`WasmHostStatus.lastFallback`); the worker host has none yet (#1086). */
  lastFallback?: { reason: string; stage: string } | null;
}

export interface DiagnosticsInput {
  appVersion: string;
  appSha?: string;
  /** `window.__vcEngineBoot`. */
  boot?: EngineBootState;
  /** `window.__vcEngine.status`. */
  host?: DiagnosticsHost;
  /** `__ENGINE_PACKAGE__`: what this shell was built to run. */
  expected?: ExpectedEnginePackage | null;
  /** `navigator.userAgent` and the time of the report, for a support ticket. */
  userAgent?: string;
  date?: string;
}

/** An engine message can be long; the clipboard text keeps the start. */
const MESSAGE_CAP = 300;

const cap = (s: string): string =>
  s.length > MESSAGE_CAP ? `${s.slice(0, MESSAGE_CAP)}...` : s;

/** One row is one line of the clipboard text, so a message that spans lines
 *  (a stack, a multi-line engine error) is folded onto one. */
const oneLine = (s: string): string => s.replace(/\s*[\r\n]+\s*/g, " ");

/** The source hash the binary was stamped with against the one this page was
 *  built for, or null when they agree or either is unknown. It needs only the
 *  binary and the page's record, so a package that fails to link, or reports no
 *  identity, still gets it. */
export function sourceMismatch(
  expected: ExpectedEnginePackage | null | undefined,
  build: BuildMetadataResult | undefined,
): string | null {
  if (build?.state !== "ok" || !expected?.sources) return null;
  if (build.sourceHash === expected.sources) return null;
  return `source hash (engine binary ${shortId(build.sourceHash)}, this page was built for ${shortId(expected.sources)})`;
}

/** The fields the engine's record and the shell's build record disagree on. */
export function identityMismatches(
  identity: EngineIdentity,
  expected: ExpectedEnginePackage | null | undefined,
  build?: BuildMetadataResult,
): string[] {
  const out: string[] = [];
  const crate = expected?.crate;
  if (crate && crate.name !== identity.crate.name)
    out.push(
      `crate name (engine ${identity.crate.name}, this page was built for ${crate.name})`,
    );
  if (crate && crate.version !== identity.crate.version)
    out.push(
      `crate version (engine ${identity.crate.version}, this page was built for ${crate.version})`,
    );
  const source = sourceMismatch(expected, build);
  if (source) out.push(source);
  return out;
}

/** Why the source hash cannot be shown, or null when it can (or was not read). */
function buildUnavailable(build: BuildMetadataResult | undefined): string | null {
  if (build?.state === "missing")
    return "its binary carries no build metadata section";
  if (build?.state === "malformed")
    return `its build metadata section is malformed (${build.why})`;
  return null;
}

function buildValue(build: BuildMetadataResult): string {
  if (build.state === "ok") return shortId(build.sourceHash);
  if (build.state === "missing") return "unavailable (no build metadata section)";
  return `unavailable (malformed: ${build.why})`;
}

/** Whether the current tower runs on the WASM engine. The host's status is the
 *  authority when there is one: a later tower can be hosted after the first
 *  was refused, and a tower can fall back with no boot failure recorded. The
 *  boot state decides only when no host handle exists. */
function wasmRunning(input: DiagnosticsInput): boolean {
  if (input.host) return !!input.host.hosted;
  return input.boot?.engine === "wasm" && !input.boot.failure;
}

function engineName(input: DiagnosticsInput): string {
  if (input.boot?.engine === "none") return "none";
  if (wasmRunning(input))
    return input.host?.placement === "worker"
      ? "Rust engine (worker)"
      : "Rust engine";
  return "TypeScript engine";
}

/** The sentence for an engine that is not running, by where it stopped. */
function failureSummary(
  boot: EngineBootState,
  stage: string,
): string {
  const WHAT: Record<string, string> = {
    host: "The Rust engine stopped after a fault",
    start: "The Rust engine did not take the first tower",
  };
  const what = WHAT[stage] ?? "The Rust engine did not load";
  return boot.engine === "none"
    ? `${what}, and this build has no other engine.`
    : `${what}, so the game is running on the TypeScript engine.`;
}

export function buildDiagnostics(input: DiagnosticsInput): DiagnosticsReport {
  const { boot, host, expected } = input;
  const failure = boot?.failure ?? null;
  const identity = parseEngineIdentity(boot?.identity);
  const running = wasmRunning(input);
  const mismatches = identity
    ? identityMismatches(identity, expected, boot?.binary)
    : [sourceMismatch(expected, boot?.binary)].filter(
        (m): m is string => m !== null,
      );
  const noBuild = buildUnavailable(boot?.binary);
  // "Matches" is claimed only when a comparison ran.
  const compared =
    (!!identity && !!expected?.crate) ||
    (boot?.binary?.state === "ok" && !!expected?.sources);

  let state: DiagnosticsState;
  let summary: string;
  if (!running && failure) {
    state = "not-loaded";
    summary = failureSummary(boot as EngineBootState, failure.stage);
  } else if (!running) {
    state = "typescript";
    summary = host?.lastFallback
      ? "The game fell back to the TypeScript engine for this tower."
      : "The game is running on the TypeScript engine.";
  } else if (mismatches.length > 0) {
    state = "mismatch";
    summary = "The Rust engine does not match the build this page expected.";
  } else if (!identity) {
    state = "unavailable";
    summary =
      "The Rust engine is running, but this package does not report its identity.";
  } else if (noBuild) {
    state = "unavailable";
    summary = `The Rust engine is running, but ${noBuild}, so its source hash is unavailable.`;
  } else if (compared) {
    state = "ok";
    summary = "The Rust engine is running and matches this build.";
  } else {
    state = "ok";
    summary =
      "The Rust engine is running. This page has no build record to compare it with.";
  }

  const rows: DiagnosticsRow[] = [
    {
      label: "App",
      value: `v${input.appVersion}${input.appSha ? ` (${input.appSha})` : ""}`,
    },
  ];
  if (input.date) rows.push({ label: "Date", value: input.date });
  if (input.userAgent)
    rows.push({ label: "Browser", value: cap(input.userAgent) });
  rows.push({ label: "Engine in use", value: engineName(input) });
  if (boot) rows.push({ label: "Build", value: boot.build });
  if (failure) {
    rows.push({ label: "Failed at", value: failure.stage });
    rows.push({ label: "Reason", value: failure.reason });
    rows.push({ label: "Detail", value: cap(failure.message) });
  }
  if (host?.lastFallback)
    rows.push({
      label: "Last fallback",
      value: `${host.lastFallback.reason} at ${host.lastFallback.stage}`,
    });
  if (host?.lastError)
    rows.push({ label: "Last engine error", value: cap(host.lastError) });
  if (host?.droppedErrors)
    rows.push({ label: "Errors not kept", value: String(host.droppedErrors) });
  if (expected) {
    rows.push({
      label: "Package id this page expects",
      value: shortId(expected.package),
    });
    if (expected.sources)
      rows.push({
        label: "Source hash this page expects",
        value: shortId(expected.sources),
      });
    if (expected.crate)
      rows.push({
        label: "Crate this page expects",
        value: `${expected.crate.name} ${expected.crate.version}`,
      });
  }
  if (boot?.binary)
    rows.push({
      label: "Source hash in the engine binary",
      value: buildValue(boot.binary),
    });
  if (identity) {
    rows.push({
      label: "Engine crate",
      value: `${identity.crate.name} ${identity.crate.version}`,
    });
    rows.push({
      label: "Save version",
      value: `${identity.saveVersion} (loads back to ${identity.oldestSaveVersion})`,
    });
    rows.push({
      label: "Frame layout",
      value: String(identity.frameLayoutVersion),
    });
    rows.push({
      label: "Catalog",
      value: `${identity.catalogVersion} (classic ${identity.catalogDigests.classic}, modern ${identity.catalogDigests.modern})`,
    });
    rows.push({ label: "Conformance lock", value: identity.lockDigest });
  }
  for (const m of mismatches) rows.push({ label: "Mismatch", value: m });

  const text = [
    "Verticopolis diagnostics",
    oneLine(summary),
    ...rows.map((r) => `${r.label}: ${oneLine(r.value)}`),
  ].join("\n");
  return { state, summary, rows, text };
}
