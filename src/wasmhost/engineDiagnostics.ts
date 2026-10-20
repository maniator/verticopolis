import type { EngineBootState } from "./engineBoot";
import { parseEngineIdentity, type EngineIdentity } from "./engineIdentity";
import { shortId, type ExpectedEnginePackage } from "./enginePackageRecord";

/**
 * The engine diagnostics report (#963): one plain-data answer to "which build
 * and which engine was that?" for About and its Copy Diagnostics button. It
 * joins the app version, the engine boot settled on, the host's status, what
 * the shell was built to run (`__ENGINE_PACKAGE__`) and the record the engine
 * itself reports. Every input is optional, so the report builds, and copies,
 * when the engine never loaded.
 *
 * The text carries no tower, save or player data: versions, codes, digests and
 * the engine's own error text.
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
}

/** An engine message can be long; the clipboard text keeps the start. */
const MESSAGE_CAP = 300;

const cap = (s: string): string =>
  s.length > MESSAGE_CAP ? `${s.slice(0, MESSAGE_CAP)}...` : s;

/** The fields the engine's record and the shell's build record disagree on. */
export function identityMismatches(
  identity: EngineIdentity,
  expected: ExpectedEnginePackage | null | undefined,
): string[] {
  const crate = expected?.crate;
  if (!crate) return [];
  const out: string[] = [];
  if (crate.name !== identity.crate.name)
    out.push(
      `crate name (engine ${identity.crate.name}, this page was built for ${crate.name})`,
    );
  if (crate.version !== identity.crate.version)
    out.push(
      `crate version (engine ${identity.crate.version}, this page was built for ${crate.version})`,
    );
  return out;
}

function engineName(input: DiagnosticsInput): string {
  if (input.boot?.engine === "none") return "none";
  if (
    input.host?.hosted ||
    (input.boot?.engine === "wasm" && !input.boot.failure)
  )
    return input.host?.placement === "worker"
      ? "WASM engine (worker)"
      : "WASM engine";
  return "TypeScript engine";
}

export function buildDiagnostics(input: DiagnosticsInput): DiagnosticsReport {
  const { boot, host, expected } = input;
  const failure = boot?.failure ?? null;
  const identity = parseEngineIdentity(boot?.identity);
  const wasmRunning = !!host?.hosted || (boot?.engine === "wasm" && !failure);
  const mismatches = identity ? identityMismatches(identity, expected) : [];

  let state: DiagnosticsState;
  let summary: string;
  if (failure) {
    state = "not-loaded";
    summary =
      boot?.engine === "none"
        ? "The WASM engine did not start, and this build has no other engine."
        : "The WASM engine did not start, so the game is running on the TypeScript engine.";
  } else if (!wasmRunning) {
    state = "typescript";
    summary = "The game is running on the TypeScript engine.";
  } else if (!identity) {
    state = "unavailable";
    summary =
      "The WASM engine is running, but this package does not report its identity.";
  } else if (mismatches.length > 0) {
    state = "mismatch";
    summary = "The WASM engine does not match the build this page expected.";
  } else {
    state = "ok";
    summary = "The WASM engine is running and matches this build.";
  }

  const rows: DiagnosticsRow[] = [
    {
      label: "App",
      value: `v${input.appVersion}${input.appSha ? ` (${input.appSha})` : ""}`,
    },
  ];
  rows.push({ label: "Engine in use", value: engineName(input) });
  if (boot) rows.push({ label: "Build", value: boot.build });
  if (failure) {
    rows.push({ label: "Failed at", value: failure.stage });
    rows.push({ label: "Reason", value: failure.reason });
    rows.push({ label: "Detail", value: cap(failure.message) });
  }
  if (host?.lastError)
    rows.push({ label: "Last engine error", value: cap(host.lastError) });
  if (host?.droppedErrors)
    rows.push({ label: "Errors not kept", value: String(host.droppedErrors) });
  if (expected) {
    rows.push({
      label: "Package this page expects",
      value: shortId(expected.package),
    });
    if (expected.crate)
      rows.push({
        label: "Crate this page expects",
        value: `${expected.crate.name} ${expected.crate.version}`,
      });
  }
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
    summary,
    ...rows.map((r) => `${r.label}: ${r.value}`),
  ].join("\n");
  return { state, summary, rows, text };
}
