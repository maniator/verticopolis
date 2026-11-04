import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SPEEDS } from "../../game/frameLoop";
import { UNDO_NOTHING_TO_STEP, UNDO_REFUSED, type EnginePort, type EnginePortCommands, type PortRecord } from "../../simport/enginePort";
import { PortCodes, type CodeTable } from "../../simport/portCodes";
import { canonicalJson, digestText } from "../conformance/canonical";
import { FRAME_TIMES_MS, startTower, type FrameDayStart } from "./frameDays";
import { writeGoldenFile } from "./updateGate";

/**
 * The port-edit golden: the player's edits the dual run mirrored
 * (`dualRunEdits`, `dualRunBrush`), driven through the port's own commands
 * the way the game sends them, with every answer pinned. A case starts a
 * tower the way the game does, runs a script of commands, reads and play,
 * and after each step records the answer (the command's record by its slot
 * names, without the generation a swap or an undo answers, which #1802
 * changes, plus the refusal text), the clock, the hashes of the state and
 * crowd views and the hash and count of the events since the last step.
 * Each command in a script says whether it must land or be refused, so a
 * refresh cannot pin a setup build that failed or a malformed edit that
 * landed. Play runs whole frames through `advance` at speed 3, draining the
 * events every frame as the frame loop does, with a line after the first
 * frame a case plays (a new game's founding pass) and at every hour.
 *
 * `port-edits.json` holds the lines. The Rust engine is checked against it in
 * `conformanceWasmPortEdits.integration.test.ts`, which also writes it
 * (`VC_PORT_EDITS_UPDATE=1`, `updateGate.ts`), and while the TypeScript
 * engine exists `portEditsReferee.integration.test.ts` runs the same scripts
 * on it against the same file. That check goes with `src/engine/`.
 *
 * A moved hash tells you the step; the field takes a dump:
 * `VC_PORT_EDITS_DUMP=<dir> VC_PORT_EDITS_CASE=<case id>` writes each line's
 * canonical views under `<dir>/<engine>/`, to diff against a run of the
 * build before the change.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
export const PORT_EDITS_FILE = resolve(ROOT, "src/tests/goldens/port-edits.json");

/** The status slot's values (contract section 2); only `undo` and `redo`
 *  answer `nothingToStep`. */
export const STATUS = { refused: UNDO_REFUSED, done: 1, nothingToStep: UNDO_NOTHING_TO_STEP } as const;

/** What a script says a command must answer, by `STATUS` name. */
export type Outcome = keyof typeof STATUS;

/** The `STATUS` name of a record's status slot, or undefined for a value
 *  the contract does not name. */
function outcomeOf(status: number): Outcome | undefined {
  return (Object.keys(STATUS) as Outcome[]).find((name) => STATUS[name] === status);
}

/** The speed a case plays at: the fastest, so its hours cost the fewest frames. */
const PLAY_SPEED = 3;

/** `advance`'s last argument as the frame loop passes it. */
const STEP_OWED_MINUTES = true;

/** Frames in a row the clock may stand still before play calls it stuck. */
const MAX_STILL_FRAMES = 10_000;

/** The record slot a swap's or an undo's generation sits in; the golden
 *  leaves it out. */
const GENERATION = "generation";

/** The swap and undo answers are `restore`'s record (`[status, generation]`). */
const SWAP_RECORD = "restore";

/** The commands a script sends, by name: each takes its own arguments, so
 *  the slot names a line is decoded by belong to the method it called. */
type CommandOp = keyof EnginePortCommands;

/** One engine behind the port: the two hashed views in canonical form, and a
 *  way to set the money, which the dual run's host wrote directly (the Rust
 *  engine's tooling member `setMoney`, the TypeScript engine's field). `name`
 *  labels its dumps. */
export interface PortEditLeg {
  readonly name: string;
  readonly port: EnginePort;
  stateView(): string;
  crowdView(): string;
  setMoney(amount: number): void;
}

/** A value an answer carries, as the golden writes it. */
export type AnswerValue = number | string | boolean | null | { readonly [key: string]: AnswerValue };

export interface PortEditLine {
  readonly step: string;
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

interface SavedUnit {
  readonly id: number;
  readonly floor: number;
  readonly x: number;
  readonly width: number;
}

export interface SavedTransport {
  readonly id: number;
  readonly kind: string;
  readonly x: number;
  readonly width: number;
  readonly bottom: number;
  readonly top: number;
}

/**
 * A case's run on one engine. Each step appends one line; `play` appends one
 * after the case's first frame, one per hour it crosses and one at its end.
 */
export class PortEditSession {
  readonly lines: PortEditLine[] = [];
  readonly port: EnginePort;
  private readonly codes: PortCodes;
  private batch: unknown[] = [];
  private owed = 0;
  private played = false;
  private readonly clockSlot: number;

  constructor(
    private readonly leg: PortEditLeg,
    private readonly caseId: string,
    start: FrameDayStart,
    private readonly dumpDir?: string,
  ) {
    this.port = leg.port;
    this.codes = new PortCodes(this.port);
    const header = (JSON.parse(this.port.viewLayout()) as { header: Record<string, number> }).header;
    if (!Number.isInteger(header.minutes)) throw new Error(`${caseId}: the frame layout has no minutes slot`);
    this.clockSlot = header.minutes;
    // The placeholder tower's events are not the case's.
    this.drain([]);
    startTower(this.port, start);
    this.line("start", null);
  }

  /** The clock's minutes. */
  minute(): number {
    return this.port.viewFrame(false)[this.clockSlot];
  }

  /** The code for a name the script means, which must be in the table (the
   *  malformed cases pass NaN themselves). */
  code(table: CodeTable, name: string): number {
    const code = this.codes.code(table, name);
    if (Number.isNaN(code)) throw new Error(`${this.caseId}: ${table} has no ${JSON.stringify(name)}`);
    return code;
  }

  /** A facility kind's code; the kind must exist. */
  kind(name: string): number {
    return this.code("kinds", name);
  }

  /** Send a command that must land, and record its answer. */
  done<K extends CommandOp>(step: string, op: K, ...args: Parameters<EnginePortCommands[K]>): Record<string, number | string> {
    return this.command("done", step, op, args);
  }

  /** Send a command that must be refused, and record its answer. */
  refused<K extends CommandOp>(step: string, op: K, ...args: Parameters<EnginePortCommands[K]>): Record<string, number | string> {
    return this.command("refused", step, op, args);
  }

  private command(want: Outcome, step: string, op: CommandOp, args: unknown[]): Record<string, number | string> {
    const call = this.port[op] as (...a: unknown[]) => PortRecord;
    return this.answer(want, step, op, call.apply(this.port, args));
  }

  /** Load a save through `restore` (the history source), which must land. */
  restore(step: string, text: string): Record<string, number | string> {
    return this.answer("done", step, SWAP_RECORD, this.port.restore(text));
  }

  /** Load a save through `loadSave` (the stored source), which must land. */
  loadSave(step: string, text: string): Record<string, number | string> {
    return this.answer("done", step, SWAP_RECORD, this.port.loadSave(text));
  }

  /** Step the engine's undo trail back or forward, as the game's undo and
   *  redo buttons do; the answer adds the notice the game shows. */
  history(step: string, which: "undo" | "redo", want: Outcome): Record<string, number | string> {
    const rec = this.port[which]();
    const notice = this.port.undoNotice();
    const answer = this.answer(want, step, SWAP_RECORD, rec, { notice });
    return answer;
  }

  /** Open an undo step before an edit, as a tool's press does. */
  capture(label: string): void {
    this.port.undoCapture(label);
    this.line(`open an undo step: ${label}`, null);
  }

  /** Close the open undo step, as a tool's release does; the answer says
   *  whether the tower changed, so the step was kept. */
  commit(step: string): void {
    this.line(step, { kept: this.port.undoCommit() });
  }

  /** Decode `rec` by `op`'s slot names, check its status, and record it. */
  private answer(want: Outcome, step: string, op: string, rec: PortRecord, extra: Record<string, string | undefined> = {}): Record<string, number | string> {
    const fields = this.codes.fields(op);
    if (fields.length === 0) throw new Error(`${this.caseId}: ${op} has no record in the layout`);
    const reason = this.port.lastReason();
    if (rec.length !== fields.length) throw new Error(`${this.caseId}: ${step}: ${op} answered ${rec.length} slots, the layout names ${fields.length}`);
    const answer: Record<string, number | string> = {};
    fields.forEach((name, i) => {
      if (name !== GENERATION) answer[name] = answerNumber(rec[i]);
    });
    for (const [key, text] of Object.entries({ reason, ...extra })) {
      if (key in answer) throw new Error(`${this.caseId}: ${op}'s record has a slot named ${key}, which the answer's text would hide`);
      if (text !== undefined) answer[key] = text;
    }
    if (outcomeOf(rec[0]) !== want) throw new Error(`${this.caseId}: ${step}: the script says ${want}, the engine answered ${canonicalJson(answer)}`);
    this.line(step, answer);
    return answer;
  }

  /** Record what a read answers; a read with no value answers "(none)". */
  read(step: string, value: (port: EnginePort) => string | boolean | undefined): void {
    this.line(step, value(this.port) ?? "(none)");
  }

  /** Record a read that answers JSON text, parsed, so key order does not
   *  matter. */
  readJson(step: string, value: (port: EnginePort) => string | undefined): AnswerValue {
    const text = value(this.port);
    const parsed = text === undefined ? "(none)" : (JSON.parse(text) as AnswerValue);
    this.line(step, parsed);
    return parsed;
  }

  /** Stop the run when what a step must have done did not happen. */
  require(what: string, ok: boolean): void {
    if (!ok) throw new Error(`${this.caseId}: ${what}`);
  }

  /** The frame loop's bare step, which answers nothing. */
  tick(minutes: number): void {
    this.port.tick(minutes);
    this.line(`tick ${minutes} ${minutes === 1 ? "minute" : "minutes"}`, null);
  }

  /** A tooling write both engines have, recorded with no answer. */
  setMoney(amount: number): void {
    this.leg.setMoney(amount);
    this.line(`set money to ${amount}`, null);
  }

  /** The money the engine holds. */
  money(): number {
    return this.codes.slot(this.port.statsStrip(), "statsStrip", "money");
  }

  /** The save, parsed, to find ids by cell as the game's hit test does. */
  private save(): { units: SavedUnit[]; transports: SavedTransport[] } {
    return JSON.parse(this.port.serialize()) as { units: SavedUnit[]; transports: SavedTransport[] };
  }

  /** Whether a room covers a cell. */
  hasUnitAt(floor: number, x: number): boolean {
    return this.save().units.some((u) => u.floor === floor && x >= u.x && x < u.x + u.width);
  }

  /** The id of the room covering a cell; a case that names an empty cell is
   *  wrong, so it throws. */
  unitAt(floor: number, x: number): number {
    const u = this.save().units.find((s) => s.floor === floor && x >= s.x && x < s.x + s.width);
    if (!u) throw new Error(`${this.caseId}: no room at floor ${floor}, x ${x}`);
    return u.id;
  }

  /** The shaft covering a cell, if any. */
  findShaft(floor: number, x: number): SavedTransport | undefined {
    return this.save().transports.find((s) => floor >= s.bottom && floor <= s.top && x >= s.x && x < s.x + s.width);
  }

  /** The shaft covering a cell. */
  shaftAt(floor: number, x: number): SavedTransport {
    const t = this.findShaft(floor, x);
    if (!t) throw new Error(`${this.caseId}: no shaft at floor ${floor}, x ${x}`);
    return t;
  }

  /** The first shaft of a kind. */
  shaftOfKind(kind: string): SavedTransport {
    const t = this.save().transports.find((s) => s.kind === kind);
    if (!t) throw new Error(`${this.caseId}: no ${kind} shaft`);
    return t;
  }

  /** Play `minutes` of game time in whole frames, as the frame loop does:
   *  events drained every frame, a line after the case's first frame, after
   *  each frame that crosses an hour, and at the end. */
  play(minutes: number): void {
    const mps = SPEEDS[PLAY_SPEED];
    const step = `play ${minutes} minutes`;
    const from = this.minute();
    let now = from;
    let hour = Math.floor(now / 60);
    let frames = 0;
    let still = 0;
    let lastWasLine = false;
    while (now < from + minutes) {
      [, this.owed] = this.port.advance(this.owed, FRAME_TIMES_MS[frames % FRAME_TIMES_MS.length], mps, false, STEP_OWED_MINUTES);
      frames++;
      this.drain(this.batch);
      const before = now;
      now = this.minute();
      if (typeof this.port.pendingChoice() === "string") throw new Error(`${this.caseId}: a choice opened at minute ${now}; the golden plays no choices`);
      if (!(now >= before)) throw new Error(`${this.caseId}: the clock went from minute ${before} to ${now}`);
      still = now === before ? still + 1 : 0;
      if (still > MAX_STILL_FRAMES) throw new Error(`${this.caseId}: the clock stood still for ${still} frames at minute ${now}`);
      const nowHour = Math.floor(now / 60);
      // The catch-up cap keeps a frame inside one hour boundary; two would
      // merge two hours into one line.
      if (nowHour > hour + 1) throw new Error(`${this.caseId}: one frame crossed ${nowHour - hour} hours at minute ${now}`);
      const first = !this.played;
      this.played = true;
      lastWasLine = first || nowHour !== hour;
      if (lastWasLine) this.line(step, first && nowHour === hour ? "first frame" : { hour: nowHour });
      hour = nowHour;
    }
    if (!lastWasLine) this.line(step, "end");
  }

  private drain(into: unknown[]): void {
    const [dropped, count] = this.port.drainEvents();
    if (dropped !== 0) throw new Error(`${this.caseId}: the engine dropped ${dropped} gameplay events`);
    for (let i = 0; i < count; i++) {
      const text = this.port.eventText(i);
      if (text === undefined) throw new Error(`${this.caseId}: event ${i} of ${count} has no text`);
      into.push(JSON.parse(text));
    }
  }

  private line(step: string, answer: AnswerValue): void {
    this.drain(this.batch);
    const minute = this.minute();
    if (!Number.isFinite(minute)) throw new Error(`${this.caseId}: ${step}: the clock reads ${minute}`);
    const state = this.leg.stateView();
    const crowd = this.leg.crowdView();
    if (this.dumpDir !== undefined) {
      const dir = resolve(this.dumpDir, this.leg.name);
      mkdirSync(dir, { recursive: true });
      const file = resolve(dir, `${String(this.lines.length).padStart(3, "0")}.json`);
      writeFileSync(file, `${JSON.stringify({ step, answer, minute, state: JSON.parse(state), crowd: JSON.parse(crowd), events: this.batch }, null, 1)}\n`);
    }
    this.lines.push({ step, answer, minute, state: digestText(state), crowd: digestText(crowd), events: digestText(canonicalJson(this.batch)), count: this.batch.length });
    this.batch = [];
  }
}

const isPlay = (l: PortEditLine) => l.step.startsWith("play ");

/** Why a case's lines are too thin to pin, or nothing. A refused command
 *  (#923, #996) and an undo with nothing to step move nothing, so their
 *  lines keep the state and crowd hashes of the line before and drain no
 *  event; a command that moved money moved the state; the case plays at
 *  least one hour, so the commands are pinned against a running tower; and
 *  a tower loaded from a fixture has people, so its crowd moves during play.
 *  The writer checks its own output with this before it writes, and the
 *  golden's tests check the file. */
export function portEditProblems(start: FrameDayStart, lines: readonly PortEditLine[]): string[] {
  const problems: string[] = [];
  lines.forEach((l, i) => {
    const before = lines[i - 1];
    const a = l.answer;
    if (!before || a === null || typeof a !== "object" || !("status" in a)) return;
    if ((a.status === STATUS.refused || a.status === STATUS.nothingToStep) && (l.state !== before.state || l.crowd !== before.crowd || l.count > 0)) problems.push(`line ${i} (${l.step}): ${a.status === STATUS.refused ? "refused" : "nothing to step"}, but it moved the tower or drained an event`);
    if (a.status === STATUS.done && typeof a.delta === "number" && a.delta !== 0 && l.state === before.state) problems.push(`line ${i} (${l.step}): moved ${a.delta} in money, but not the state`);
  });
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

/** One line per step, cases in `ids` order, so a refresh diffs by the step
 *  that moved. */
export function writePortEdits(ids: readonly string[], cases: Record<string, PortEditLine[]>): void {
  const body = ids.map((id) => {
    const rows = cases[id].map((l) => `      ${JSON.stringify({ step: l.step, answer: l.answer, minute: l.minute, state: l.state, crowd: l.crowd, events: l.events, count: l.count })}`).join(",\n");
    return `    ${JSON.stringify(id)}: [\n${rows}\n    ]`;
  });
  writeGoldenFile(PORT_EDITS_FILE, `{\n  "cases": {\n${body.join(",\n")}\n  }\n}\n`);
}

const LINE_FIELDS = ["step", "answer", "minute", "state", "crowd", "events", "count"] as const;
export type LineField = (typeof LINE_FIELDS)[number];

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
