/**
 * The seeded differential's compare: one run's checkpoints and details against
 * the native Rust run's, naming the first field that differs. The other run is
 * the shipped WASM build in Node (the nightly, `scripts/fuzz-compare.ts`) or a
 * corpus entry's pinned golden (`scripts/fuzz-corpus.ts`).
 */
import type { Checkpoint } from "./scenario";
import type { CheckpointDetail } from "./checkpointDetail";

export interface RunRecord {
  checkpoints: Checkpoint[];
  details: CheckpointDetail[];
}

/** Which part of a checkpoint differed first, in the order the compare looks:
 *  the label, the three hashes, then the detail (money, log, save field, fx slots). */
export type DivergenceKind = "count" | "label" | "state" | "crowd" | "events" | "money" | "log" | "save" | "fx";

/** What the native Rust run is compared with: the shipped WASM build in Node,
 *  or the golden record a corpus entry pins. The divergence's `other` field
 *  holds that side's value. */
export type Leg = "WASM" | "golden";

export interface Divergence {
  /** The checkpoint index, or the shorter run's length for `count`. */
  index: number;
  label: string;
  kind: DivergenceKind;
  /** The log part (`seq`, `count`, `digest`) or the save field's name. */
  field?: string;
  /** The compared leg's value (the WASM build's, or the golden's). */
  other: string;
  rust: string;
}

const HASHES = ["state", "crowd", "events"] as const;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Why a run record cannot be compared, or `null` when it can. A record that is
 *  short, relabeled or of the wrong shape must never read as agreement, so the
 *  command line reports it as a harness failure and not a divergence. */
export function recordProblem(run: RunRecord, what: string): string | null {
  if (run.details.length !== run.checkpoints.length) return `${what}: ${run.details.length} detail records for ${run.checkpoints.length} checkpoints`;
  for (let i = 0; i < run.checkpoints.length; i++) {
    const c: unknown = run.checkpoints[i];
    const d: unknown = run.details[i];
    if (!isObject(c) || !["label", "state", "crowd", "events"].every((k) => typeof c[k] === "string")) return `${what}: checkpoint ${i} is not a label with state, crowd and events hashes`;
    if (!isObject(d) || d.label !== c.label || typeof d.money !== "number" || !isObject(d.log) || !isObject(d.save) || !isObject(d.fx)) return `${what}: detail ${i} does not match checkpoint ${i} (${String(c.label)})`;
  }
  return null;
}

/** The first detail difference at one checkpoint, if any. */
function detailDivergence(a: CheckpointDetail, b: CheckpointDetail): Pick<Divergence, "kind" | "field" | "other" | "rust"> | null {
  if (a.money !== b.money) return { kind: "money", other: String(a.money), rust: String(b.money) };
  for (const part of ["seq", "count", "digest"] as const) {
    if (a.log[part] !== b.log[part]) return { kind: "log", field: part, other: String(a.log[part]), rust: String(b.log[part]) };
  }
  for (const key of [...new Set([...Object.keys(a.save), ...Object.keys(b.save)])].sort()) {
    if (a.save[key] !== b.save[key]) return { kind: "save", field: key, other: String(a.save[key] ?? "(absent)"), rust: String(b.save[key] ?? "(absent)") };
  }
  for (const key of [...new Set([...Object.keys(a.fx), ...Object.keys(b.fx)])].sort()) {
    if (a.fx[key] !== b.fx[key]) return { kind: "fx", field: key, other: String(a.fx[key] ?? "(absent)"), rust: String(b.fx[key] ?? "(absent)") };
  }
  return null;
}

/** The first divergence between two runs of one scenario, or `null` when they
 *  agree. A hash difference also names the first thing the detail records show
 *  differing (money, a log part or a save field), so the report points at the
 *  cause as well as the digest. Throws when a record cannot be compared. */
export function compareRuns(run: RunRecord, rust: RunRecord, leg: Leg = "WASM"): Divergence | null {
  const problem = recordProblem(run, leg) ?? recordProblem(rust, "Rust");
  if (problem) throw new Error(problem);
  const n = Math.min(run.checkpoints.length, rust.checkpoints.length);
  for (let i = 0; i < n; i++) {
    const a = run.checkpoints[i];
    const b = rust.checkpoints[i];
    if (a.label !== b.label) return { index: i, label: a.label, kind: "label", other: a.label, rust: b.label };
    const detail = detailDivergence(run.details[i], rust.details[i]);
    for (const h of HASHES) {
      if (a[h] !== b[h]) {
        return { index: i, label: a.label, kind: h, ...(detail ? { field: detail.field ?? detail.kind } : {}), other: a[h], rust: b[h] };
      }
    }
    if (detail) return { index: i, label: a.label, ...detail };
  }
  if (run.checkpoints.length !== rust.checkpoints.length) {
    return { index: n, label: "(count)", kind: "count", other: String(run.checkpoints.length), rust: String(rust.checkpoints.length) };
  }
  return null;
}

/** One line for the nightly's log and summary. */
export function describeDivergence(d: Divergence, leg: Leg = "WASM"): string {
  const where = d.kind === "count" ? "checkpoint count" : `checkpoint ${d.index} (${d.label}): ${d.kind}${d.field ? ` field ${d.field}` : ""}`;
  return `DIVERGED at ${where}, ${leg} ${d.other} vs Rust ${d.rust}`;
}
