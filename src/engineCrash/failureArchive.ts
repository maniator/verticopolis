import { strToU8, zipSync } from "fflate";
import { APP_VERSION } from "../appVersion";
import type { EngineBootFailure } from "../wasmhost/engineBoot";
import { readRecoveryText } from "../storage/recoveryCopy";
import { downloadFile } from "../ui/downloadFile";

/** A failure screen has no usable engine. Build a report entirely from the
 * reason codes we already captured and the untouched browser autosave. Never
 * call serialize() on a trapped engine or invent a TypeScript fallback. */
export function engineFailureArchive(
  failure: EngineBootFailure,
  storedSave: string | null,
  version = APP_VERSION,
): { filename: string; bytes: Uint8Array } {
  const details = {
    report: "verticopolis-engine-failure",
    version,
    createdAt: new Date().toISOString(),
    failure: {
      stage: failure.stage,
      reason: failure.reason,
      ...(failure.cause ? { cause: failure.cause } : {}),
      ...(failure.package ? { package: failure.package } : {}),
    },
    savedTower: storedSave === null ? "unavailable" : "stored-copy",
  };
  const files: Record<string, Uint8Array> = {
    "engine-failure.json": strToU8(JSON.stringify(details, null, 2)),
  };
  if (storedSave !== null) files["recovery-copy.txt"] = strToU8(storedSave);
  return { filename: `verticopolis-engine-failure-${version}.zip`, bytes: zipSync(files) };
}

/** The player chooses this download from the stopped Rust engine screen.
 * A missing autosave does not prevent a useful error report. */
export function downloadEngineFailureArchive(
  failure: EngineBootFailure,
  read: () => string | null = readRecoveryText,
): "saved" | "failed" {
  try {
    const archive = engineFailureArchive(failure, read());
    downloadFile(archive.filename, archive.bytes, "application/zip");
    return "saved";
  } catch (error) {
    console.error("[engine-failure] could not save report:", error);
    return "failed";
  }
}
