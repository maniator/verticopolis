import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { UNDO_DONE, UNDO_NOTHING_TO_STEP, UNDO_REFUSED } from "../../simport/enginePort";
import { canonicalJson } from "../conformance/canonical";
import type { FrameDayStart } from "./frameDays";
import { writeGoldenFile } from "./updateGate";

/**
 * The port-edit golden's lines (`portEdits.ts` makes them): what one holds,
 * the thin checks each kind of line is held to, the file's reading and
 * writing, and the comparison of a run with the file.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
export const PORT_EDITS_FILE = resolve(ROOT, "src/tests/goldens/port-edits.json");

/** The status slot's values (contract section 2); only `undo` and `redo`
 *  answer `nothingToStep`. */
export const STATUS = { refused: UNDO_REFUSED, done: UNDO_DONE, nothingToStep: UNDO_NOTHING_TO_STEP } as const;

/** What a script says a command must answer, by `STATUS` name. */
export type Outcome = keyof typeof STATUS;

/** The `STATUS` name of a record's status slot, or undefined for a value
 *  the contract does not name. */
export function outcomeOf(status: number): Outcome | undefined {
  return (Object.keys(STATUS) as Outcome[]).find((name) => STATUS[name] === status);
}

/** A value an answer carries, as the golden writes it. */
export type AnswerValue = number | string | boolean | null | { readonly [key: string]: AnswerValue };

/** What a line records: the start, a command (`done` or `refused`), a swap
 *  (`restore`, `loadSave`), an undo or redo, an undo step opened or closed, a
 *  read, a tooling write (`setMoney`), a bare `tick`, or play. */
const LINE_KINDS = ["start", "command", "swap", "history", "undo step", "read", "tooling", "tick", "play"] as const;
export type LineKind = (typeof LINE_KINDS)[number];

export interface PortEditLine {
  readonly step: string;
  readonly kind: LineKind;
  readonly answer: AnswerValue;
  /** The clock's minutes after the step. */
  readonly minute: number;
  readonly state: string;
  readonly crowd: string;
  readonly events: string;
  readonly count: number;
}

/** A record slot as JSON holds it: NaN and the infinities as their names
 *  (JSON has neither), and -0 as 0. */
export function answerNumber(v: number): number | string {
  return Number.isFinite(v) ? v + 0 : String(v);
}

/** A slot of a line's answer, when the answer is a record. */
function slotOf(l: PortEditLine, slot: string): AnswerValue | undefined {
  const a = l.answer;
  return a !== null && typeof a === "object" ? a[slot] : undefined;
}

/** A line's status slot, when its answer is a record with one. */
function statusOf(l: PortEditLine): number | undefined {
  const status = slotOf(l, "status");
  return typeof status === "number" ? status : undefined;
}

/** Why a line that answers a status answers one its kind cannot, or nothing:
 *  every command, swap and undo or redo answers a status the contract
 *  names, only an undo or redo has nothing to step, and a swap lands. */
function statusProblem(l: PortEditLine, status: number | undefined): string | undefined {
  if (status === undefined) return `a ${l.kind} line with no status`;
  const outcome = outcomeOf(status);
  if (outcome === undefined) return `a ${l.kind} line with the status ${status}, which the contract does not name`;
  if (outcome === "nothingToStep" && l.kind !== "history") return `a ${l.kind} line with nothing to step, which only an undo or redo answers`;
  if (l.kind === "swap" && outcome !== "done") return "a swap that did not land";
  return undefined;
}

/** Why a case's lines are too thin to pin, or nothing, by each line's kind:
 *  - the first line, and only it, is the start, and every line has a kind;
 *  - every command, swap and undo or redo answers a status its kind can
 *    (`statusProblem`), and a command's money is a number;
 *  - a refused command (#923, #996), a refused undo or one with nothing to
 *    step, a read and an undo step opened or closed move nothing, so they
 *    keep the state and crowd hashes of the line before and drain no event,
 *    and a refused command moves no money;
 *  - a command that moved money, and an undo or redo taken, moved the state;
 *  - the case plays at least one hour, so the commands are pinned against a
 *    running tower, and a tower loaded from a fixture has people, so its
 *    crowd moves during play.
 *  The writer checks its own output with this before it writes, both suites
 *  check their runs, and the golden's tests check the file. */
export function portEditProblems(start: FrameDayStart, lines: readonly PortEditLine[]): string[] {
  const problems: string[] = [];
  lines.forEach((l, i) => {
    const at = `line ${i} (${l.step})`;
    if (!(LINE_KINDS as readonly string[]).includes(l.kind)) {
      problems.push(`${at}: no line kind is named ${JSON.stringify(l.kind)}`);
      return;
    }
    if ((l.kind === "start") !== (i === 0)) {
      problems.push(i === 0 ? `${at}: the first line is no start` : `${at}: a start after the first line`);
      return;
    }
    const before = lines[i - 1];
    if (!before) return;
    const status = statusOf(l);
    const answered = l.kind === "command" || l.kind === "swap" || l.kind === "history";
    const wrongStatus = answered ? statusProblem(l, status) : undefined;
    if (wrongStatus !== undefined) {
      problems.push(`${at}: ${wrongStatus}`);
      return;
    }
    const delta = l.kind === "command" ? slotOf(l, "delta") : undefined;
    if (delta !== undefined && typeof delta !== "number") {
      problems.push(`${at}: moved ${String(delta)} in money, which is no number`);
      return;
    }
    const still = l.state === before.state && l.crowd === before.crowd && l.count === 0;
    if (answered && status !== STATUS.done) {
      if (!still) problems.push(`${at}: ${status === STATUS.nothingToStep ? "nothing to step" : "refused"}, but it moved the tower or drained an event`);
      if (delta !== undefined && delta !== 0) problems.push(`${at}: refused, but it moved ${delta} in money`);
    }
    if ((l.kind === "read" || l.kind === "undo step") && !still) problems.push(`${at}: ${l.kind === "read" ? "a read" : "an undo step"} moved the tower or drained an event`);
    if (status === STATUS.done && l.state === before.state) {
      if (delta !== undefined && delta !== 0) problems.push(`${at}: moved ${delta} in money, but not the state`);
      if (l.kind === "history") problems.push(`${at}: took an undo step, but the state did not move`);
    }
  });
  const isPlay = (l: PortEditLine) => l.kind === "play";
  if (!lines.some((l) => isPlay(l) && typeof l.answer === "object" && l.answer !== null && "hour" in l.answer)) problems.push("plays no hour");
  if (start.kind === "fixture" && !lines.some((l, i) => i > 0 && isPlay(l) && l.crowd !== lines[i - 1].crowd)) problems.push("the crowd never moves during play");
  return problems;
}

export interface PortEditGolden {
  readonly cases: Record<string, PortEditLine[]>;
}

export function readPortEdits(): PortEditGolden {
  return JSON.parse(readFileSync(PORT_EDITS_FILE, "utf8")) as PortEditGolden;
}

/** Every field of a line, in the order the golden writes them. */
const LINE_FIELDS = ["step", "kind", "answer", "minute", "state", "crowd", "events", "count"] as const;
export type LineField = (typeof LINE_FIELDS)[number];
// A field added to the line and not to the list fails here, so the golden
// never drops a field it should write and compare.
const LINE_FIELDS_COMPLETE: Exclude<keyof PortEditLine, LineField> extends never ? true : never = true;
void LINE_FIELDS_COMPLETE;

/** One line per step, cases in `ids` order, so a refresh diffs by the step
 *  that moved. */
export function writePortEdits(ids: readonly string[], cases: Record<string, PortEditLine[]>): void {
  const body = ids.map((id) => {
    const rows = cases[id].map((l) => `      ${JSON.stringify(Object.fromEntries(LINE_FIELDS.map((k) => [k, l[k]])))}`).join(",\n");
    return `    ${JSON.stringify(id)}: [\n${rows}\n    ]`;
  });
  writeGoldenFile(PORT_EDITS_FILE, `{\n  "cases": {\n${body.join(",\n")}\n  }\n}\n`);
}

/** The first line where `got` departs from `want`, described, or null.
 *  `mayDiffer` names the fields of a line an engine differs in on purpose
 *  (the TypeScript referee's, with its reasons). */
export function firstPortEditDifference(
  got: readonly PortEditLine[],
  want: readonly PortEditLine[] | undefined,
  mayDiffer: (line: number, field: LineField) => boolean = () => false,
): string | null {
  if (!want) return "the golden has no entry for this case";
  const n = Math.max(got.length, want.length);
  for (let i = 0; i < n; i++) {
    const g = got[i];
    const w = want[i];
    if (!g || !w) return `line ${i}: ${g ? "extra" : "missing"} (ran ${got.length}, pinned ${want.length})`;
    const moved = LINE_FIELDS.filter((k) => !mayDiffer(i, k) && canonicalJson(g[k]) !== canonicalJson(w[k]));
    if (moved.length > 0) return `line ${i} (${w.step}): ${moved.map((k) => `${k} ${canonicalJson(g[k])} != pinned ${canonicalJson(w[k])}`).join(", ")}`;
  }
  return null;
}
