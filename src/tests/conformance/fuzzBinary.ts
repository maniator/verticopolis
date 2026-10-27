/**
 * Run the Rust fuzzer's replay mode (`fuzz --replay <scenario> <out-dir>`) from
 * a script. The shrinker and the corpus job both go through it.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { REPO_ROOT } from "./scenario";

/** The release build of the fuzzer, or `VC_FUZZ_BIN`. */
export const FUZZ_BIN = process.env.VC_FUZZ_BIN ?? resolve(REPO_ROOT, "engine-rs/target/release/fuzz");

export interface RustReplay {
  /** 0 ran; 1 the Rust engine refused the scenario; 2 bad input; 101 a Rust panic. */
  code: number;
  stderr: string;
}

export function binaryProblem(): string | null {
  return existsSync(FUZZ_BIN) ? null : `no fuzzer at ${FUZZ_BIN} (cargo build --release --features conformance --bin fuzz, in engine-rs/)`;
}

/** `timeoutMs` caps the run (default 120 s); a run that hits it reports code 3. */
export function rustReplay(scenarioFile: string, outDir: string, timeoutMs: number = 120_000): RustReplay {
  const r = spawnSync(FUZZ_BIN, ["--replay", scenarioFile, outDir], { encoding: "utf8", timeout: Math.max(1, Math.ceil(timeoutMs)) });
  return { code: r.status ?? 3, stderr: r.stderr ?? "" };
}

/** The line of Rust stderr worth showing: the panic message (Rust prints
 *  `panicked at <place>:` and then the message) or else the last line that is
 *  not the `note: run with RUST_BACKTRACE` hint. */
export function rustMessage(stderr: string): string {
  const lines = stderr.split("\n").map((l) => l.trim()).filter((l) => l !== "");
  const at = lines.findIndex((l) => l.includes("panicked at"));
  if (at >= 0) return lines.slice(at, at + 2).filter((l) => !l.startsWith("note:")).join(" ");
  return lines.filter((l) => !l.startsWith("note:")).pop() ?? "no output";
}
