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

export function rustReplay(scenarioFile: string, outDir: string): RustReplay {
  const r = spawnSync(FUZZ_BIN, ["--replay", scenarioFile, outDir], { encoding: "utf8", timeout: 120_000 });
  return { code: r.status ?? 3, stderr: r.stderr ?? "" };
}
