import type { EngineBootState } from "./engineBoot";
import {
  buildDiagnostics,
  type DiagnosticsHost,
  type DiagnosticsReport,
} from "./engineDiagnostics";

/** The page globals the report reads: what boot published and the host's handle. */
export interface DiagnosticsGlobals {
  __vcEngineBoot?: EngineBootState;
  __vcEngine?: { status?: DiagnosticsHost };
}

/** The report for the running page. Every source can be missing (a boot that
 *  never published, a build with no engine package), and a report that cannot
 *  be built at all comes back as an unavailable one with the reason, so this
 *  never throws: Copy diagnostics has to work when the engine is the thing
 *  that failed. */
export function liveDiagnostics(
  g: DiagnosticsGlobals = globalThis as DiagnosticsGlobals,
): DiagnosticsReport {
  try {
    return buildDiagnostics({
      appVersion:
        typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "dev",
      appSha: typeof __APP_SHA__ !== "undefined" ? __APP_SHA__ : undefined,
      boot: g.__vcEngineBoot,
      host: g.__vcEngine?.status,
      expected:
        typeof __ENGINE_PACKAGE__ !== "undefined" ? __ENGINE_PACKAGE__ : null,
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent : undefined,
      date: new Date().toISOString(),
    });
  } catch (e) {
    const summary = `The report could not be built: ${e instanceof Error ? e.message : String(e)}`;
    return { state: "unavailable", summary, rows: [], text: `Verticopolis diagnostics\n${summary}` };
  }
}
