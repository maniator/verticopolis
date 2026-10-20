/**
 * The seeded differential's compare: the TypeScript engine's checkpoints and
 * details against the Rust fuzzer's, naming the first field that differs.
 * `scripts/fuzz-compare.ts` is the command line around it.
 */
import type { Checkpoint } from "./scenario";
import type { CheckpointDetail } from "./checkpointDetail";

export interface RunRecord {
  checkpoints: Checkpoint[];
  details: CheckpointDetail[];
}

/** Which part of a checkpoint differed first, in the order the compare looks:
 *  the label, the three hashes, then the detail (money, log, save field). */
export type DivergenceKind = "count" | "label" | "state" | "crowd" | "events" | "money" | "log" | "save";

export interface Divergence {
  /** The checkpoint index, or the shorter run's length for `count`. */
  index: number;
  label: string;
  kind: DivergenceKind;
  /** The log part (`seq`, `count`, `digest`) or the save field's name. */
  field?: string;
  ts: string;
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
    if (!isObject(d) || d.label !== c.label || typeof d.money !== "number" || !isObject(d.log) || !isObject(d.save)) return `${what}: detail ${i} does not match checkpoint ${i} (${String(c.label)})`;
  }
  return null;
}

/** The first detail difference at one checkpoint, if any. */
function detailDivergence(a: CheckpointDetail, b: CheckpointDetail): Pick<Divergence, "kind" | "field" | "ts" | "rust"> | null {
  if (a.money !== b.money) return { kind: "money", ts: String(a.money), rust: String(b.money) };
  for (const part of ["seq", "count", "digest"] as const) {
    if (a.log[part] !== b.log[part]) return { kind: "log", field: part, ts: String(a.log[part]), rust: String(b.log[part]) };
  }
  for (const key of [...new Set([...Object.keys(a.save), ...Object.keys(b.save)])].sort()) {
    if (a.save[key] !== b.save[key]) return { kind: "save", field: key, ts: String(a.save[key] ?? "(absent)"), rust: String(b.save[key] ?? "(absent)") };
  }
  return null;
}

/** The first divergence between two runs of one scenario, or `null` when they
 *  agree. A hash difference also names the first thing the detail records show
 *  differing (money, a log part or a save field), so the report points at the
 *  cause as well as the digest. Throws when a record cannot be compared. */
export function compareRuns(ts: RunRecord, rust: RunRecord): Divergence | null {
  const problem = recordProblem(ts, "TypeScript") ?? recordProblem(rust, "Rust");
  if (problem) throw new Error(problem);
  const n = Math.min(ts.checkpoints.length, rust.checkpoints.length);
  for (let i = 0; i < n; i++) {
    const a = ts.checkpoints[i];
    const b = rust.checkpoints[i];
    if (a.label !== b.label) return { index: i, label: a.label, kind: "label", ts: a.label, rust: b.label };
    const detail = detailDivergence(ts.details[i], rust.details[i]);
    for (const h of HASHES) {
      if (a[h] !== b[h]) {
        return { index: i, label: a.label, kind: h, ...(detail ? { field: detail.field ?? detail.kind } : {}), ts: a[h], rust: b[h] };
      }
    }
    if (detail) return { index: i, label: a.label, ...detail };
  }
  if (ts.checkpoints.length !== rust.checkpoints.length) {
    return { index: n, label: "(count)", kind: "count", ts: String(ts.checkpoints.length), rust: String(rust.checkpoints.length) };
  }
  return null;
}

/** One line for the nightly's log and summary. */
export function describeDivergence(d: Divergence): string {
  const where = d.kind === "count" ? "checkpoint count" : `checkpoint ${d.index} (${d.label}): ${d.kind}${d.field ? ` field ${d.field}` : ""}`;
  return `DIVERGED at ${where}, TypeScript ${d.ts} vs Rust ${d.rust}`;
}
