import type { Preference, Selection } from "./policy";
import type { SafetyRecord } from "./records";

/**
 * What the Settings "Game engine" section shows (#1197): the stored choice,
 * the engine actually running, why it differs when it does, whether a retry
 * is offered, and whether a changed choice needs a restart. Plain data, so
 * the template renders it and the tests read it. Changing the choice never
 * reloads the page; the section says when a restart is needed instead.
 */

export type EngineOption = "auto" | "rust" | "typescript";

export interface EngineSettingsView {
  choice: EngineOption;
  /** A tester's stored experimental host (`wasm-frame`, `wasm-worker`). */
  testHost: boolean;
  running: "Rust engine" | "TypeScript engine";
  /** Why the game is not on the engine the choice asks for, in plain words. */
  note: string | null;
  /** Offer "Try the Rust engine again" (a suppression is on this device). */
  retry: boolean;
  restart: boolean;
  /** False when this browser cannot keep the choice. */
  storable: boolean;
}

export interface EngineSettingsInput {
  selection: Selection | null;
  running: "ts" | "wasm";
  /** The preference stored now (it may have changed since boot). */
  preference: Preference;
  /** The suppression stored now (a retry clears it). */
  suppression: SafetyRecord | null;
  /** The fallback code if the engine stopped during this page life. */
  pageFallback: string | null;
  /** The player pressed "Try the Rust engine again" in this page life. */
  retried?: boolean;
  storable: boolean;
  /** Only a `?engine=wasm` visit boots Rust for now (`RUST_ONLY_BY_URL`). */
  rustOnlyByUrl?: boolean;
}

/** A fallback code in words, for the note. */
export function reasonWords(code: string): string {
  switch (code) {
    case "trap-command":
    case "trap-tick":
    case "trap-undo":
      return "it stopped while running";
    case "boot-error":
      return "it could not start";
    case "boot-timeout":
      return "it took too long to load";
    case "unverifiable":
      return "this browser could not check its downloaded files";
    case "package-mismatch":
      return "its downloaded files did not match this version of the game";
    case "attach-refused":
      return "it could not open this tower";
    case "unclean-exit":
      return "the game closed unexpectedly while using it";
    case "corrupt":
      return "this device's record of an earlier problem could not be read";
    default:
      return "something went wrong";
  }
}

function optionOf(p: Preference): { choice: EngineOption; testHost: boolean } {
  if (p === "auto") return { choice: "auto", testHost: false };
  if (p === "ts") return { choice: "typescript", testHost: false };
  return { choice: "rust", testHost: p !== "wasm" };
}

/** The engine the stored choice asks for, before any suppression. */
function wantedEngine(i: EngineSettingsInput): "ts" | "wasm" {
  if (i.preference === "ts") return "ts";
  if (i.preference !== "auto") return "wasm";
  return i.selection?.assignedArm === "wasm" ? "wasm" : "ts";
}

/** The engine the stored choice gives at the next start. A browser that
 *  cannot keep the crash marker gets TypeScript again. */
function nextEngine(i: EngineSettingsInput): "ts" | "wasm" {
  return i.suppression || i.selection?.markerBlocked || i.rustOnlyByUrl ? "ts" : wantedEngine(i);
}

/** The engine this page life's boot started (any Rust host counts as Rust). */
function bootEngine(i: EngineSettingsInput): "ts" | "wasm" {
  if (!i.selection) return i.running;
  return i.selection.boot === "ts" ? "ts" : "wasm";
}

export function engineSettingsView(i: EngineSettingsInput): EngineSettingsView {
  const { choice, testHost } = optionOf(i.preference);
  const next = nextEngine(i);
  let note: string | null = null;
  if (i.pageFallback !== null) {
    note = `The Rust engine had a problem in this session (${reasonWords(i.pageFallback)}), so the game switched to the TypeScript engine.`;
  } else if (i.selection?.selectedBy === "safety" && i.selection.suppression) {
    note = `The Rust engine had a problem on this device earlier (${reasonWords(i.selection.suppression.reason)}), so the game uses the TypeScript engine.`;
  } else if (i.selection?.markerBlocked && wantedEngine(i) === "wasm") {
    note = "This browser could not save the Rust engine's crash check, so the game uses the TypeScript engine.";
  } else if (i.rustOnlyByUrl && i.running === "ts" && wantedEngine(i) === "wasm") {
    note = "For now the Rust engine runs only from a test link, so the game uses the TypeScript engine.";
  }
  return {
    choice,
    testHost,
    running: i.running === "wasm" ? "Rust engine" : "TypeScript engine",
    note,
    // Only where a retry would change something: the choice asks for Rust.
    retry: i.suppression !== null && wantedEngine(i) === "wasm",
    // A `?engine=` visit runs what the URL asked; the choice applies on the
    // next ordinary start, so no restart prompt. Nor when the next start
    // repeats what this one asked for (a tower the engine refused, say),
    // unless a retry cleared what kept this page life off Rust.
    restart: i.selection?.selectedBy !== "url" && next !== i.running && (next !== bootEngine(i) || i.retried === true),
    storable: i.storable,
  };
}
