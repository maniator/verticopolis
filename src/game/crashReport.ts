import { strToU8, zipSync } from "fflate";
import type { Simulation } from "../engine/Simulation";
import { SaveGame } from "../storage/SaveGame";

/**
 * Crash-report packaging. When the game dies (today: the GPU drops the WebGL
 * context), the crash screen offers the player a downloadable zip that holds
 * everything a bug report needs: a small JSON of crash details and the full
 * tower save. The player attaches it to a GitHub issue; nothing is uploaded
 * automatically and the report contains only what this module writes into it.
 */

/** One captured tick-guard failure (see GameApp's frame-error ring buffer). */
export interface FrameErrorEntry {
  /** ISO timestamp of the throw. */
  at: string;
  message: string;
}

export interface CrashDescription {
  /** What killed the game. The GPU reset is the only crash surfaced today. */
  kind: "webgl-context-lost";
  /** A previous crash happened within the last 90 seconds. */
  repeat: boolean;
  /** An in-place renderer recovery was attempted for this loss and failed
   *  (rebuild error or the restore signal never came inside the visible-time
   *  budget). False when the crash screen showed without an attempt (repeat,
   *  behind the splash, or a failed flush). */
  recoveryFailed: boolean;
  /** Whether the tower was persisted going into the crash: the pre-crash
   *  autosave flush succeeded, or nothing needed flushing (the crash happened
   *  behind the splash, which pauses the sim). False only when a flush was
   *  attempted and failed. */
  saveFlushed: boolean;
  /** The crash happened while the boot splash was still up (no game was in
   *  progress, no flush was attempted). Lets a report reader tell a boot-time
   *  driver death from a mid-game crash with a clean flush. */
  behindSplash: boolean;
}

/** The crash-details JSON written into the zip. Field names are part of the
 *  report format; renaming them breaks tooling that reads old reports. */
export interface CrashDetails {
  report: "verticopolis-crash";
  version: string;
  createdAt: string;
  crash: CrashDescription;
  userAgent: string;
  viewport: { width: number; height: number; dpr: number };
  /** Chrome-only heap numbers when present; absent elsewhere. */
  memoryMB?: { usedJSHeap: number; totalJSHeap: number; jsHeapLimit: number };
  tower: {
    name: string;
    star: number;
    population: number;
    money: number;
    minutes: number;
    units: number;
    transports: number;
    speed: number;
  };
  recentFrameErrors: FrameErrorEntry[];
}

export function buildCrashDetails(
  sim: Simulation,
  crash: CrashDescription,
  opts: { version: string; speed: number; frameErrors: readonly FrameErrorEntry[] },
): CrashDetails {
  const details: CrashDetails = {
    report: "verticopolis-crash",
    version: opts.version,
    createdAt: new Date().toISOString(),
    crash,
    userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "unknown",
    viewport:
      typeof window !== "undefined"
        ? { width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio || 1 }
        : { width: 0, height: 0, dpr: 1 },
    tower: {
      name: sim.tower.towerName,
      star: sim.star,
      population: sim.population,
      money: sim.money,
      minutes: sim.clock.minutes,
      units: sim.tower.units.length,
      transports: sim.tower.transports.length,
      speed: opts.speed,
    },
    recentFrameErrors: [...opts.frameErrors],
  };
  // performance.memory is a Chrome extension; include it when the browser has
  // it (it is the strongest signal for memory-pressure crashes on Android).
  const mem = (globalThis.performance as { memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number } } | undefined)?.memory;
  if (mem) {
    const mb = (n: number) => Math.round(n / 1e6);
    details.memoryMB = { usedJSHeap: mb(mem.usedJSHeapSize), totalJSHeap: mb(mem.totalJSHeapSize), jsHeapLimit: mb(mem.jsHeapSizeLimit) };
  }
  return details;
}

/**
 * Pack the crash details and the tower save into a zip. The save travels in
 * the normal `.vctower` container so it opens through the regular import flow;
 * if this browser can't build one (no CompressionStream), the raw save JSON
 * goes in instead, which the devs can still load.
 */
export async function buildCrashReportZip(
  sim: Simulation,
  details: CrashDetails,
): Promise<{ filename: string; bytes: Uint8Array }> {
  const files: Record<string, Uint8Array> = {
    "crash-report.json": strToU8(JSON.stringify(details, null, 2)),
  };
  try {
    files["tower.vctower"] = strToU8(await SaveGame.export(sim));
  } catch {
    files["tower.json"] = strToU8(JSON.stringify(sim.serialize()));
  }
  // Timestamp in the name so repeated crashes don't overwrite each other in
  // the downloads folder. Colons are not filename-safe; keep digits and dashes.
  const stamp = details.createdAt.replace(/[:.]/g, "-").replace("T", "-").slice(0, 19);
  return {
    filename: `verticopolis-crash-report-${stamp}.zip`,
    // Already-deflated payloads gain nothing from recompression; level 6 (the
    // default) still shrinks the JSON half nicely at trivial cost.
    bytes: zipSync(files),
  };
}

/**
 * A prefilled GitHub bug-report URL for this crash. Issue forms accept field
 * ids as query parameters, so the version input and the description arrive
 * filled in; attachments can't travel by URL, which is why the description
 * tells the reporter to attach the downloaded zip.
 */
export function bugReportUrl(details: Pick<CrashDetails, "version" | "crash">): string {
  const params = new URLSearchParams({
    template: "bug_report.yml",
    title: "[Bug]: Game crashed (graphics context lost)",
    version: details.version,
    "what-happened": [
      "The game crashed: the graphics context was lost while playing.",
      details.crash.repeat ? "It crashed twice in a row." : "",
      "",
      "A crash-report zip (crash details plus my tower save) was downloaded from the crash screen.",
      "I am attaching it to this issue by dragging the zip file into this text box.",
    ]
      .filter((line, i) => line !== "" || i === 2) // keep the single blank separator
      .join("\n"),
  });
  return `https://github.com/maniator/verticopolis/issues/new?${params.toString()}`;
}
