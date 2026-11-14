import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { EnginePort, EnginePortCommands, PortRecord } from "../../simport/enginePort";
import { PortCodes, type CodeTable } from "../../simport/portCodes";
import { canonicalJson, digestText } from "../conformance/canonical";
import { GOLDEN_SPEEDS } from "./goldenSpeeds";
import { FRAME_TIMES_MS, freshDumpDir, startTower, type FrameDayStart } from "./frameDays";
import { crowdProblem, midRouteAvoiding, shaftsBetween, walkingTo, type CrowdView } from "./portEditCrowd";
import { answerNumber, outcomeOf, STATUS_SLOT, type AnswerValue, type LineKind, type Outcome, type PortEditLine } from "./portEditLines";

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
 * frame a case plays (a new game's founding pass), at every hour, and at the
 * end of a play whose last frame wrote no line. Each line names its kind (a
 * command, a read, an undo step and so on), and the thin checks
 * (`portEditProblems`) hold each command, swap and undo or redo to a status
 * its kind can answer, and each of those, each read and each undo step
 * opened or closed to what it may move.
 *
 * `port-edits.json` holds the lines (`portEditLines.ts` reads, writes,
 * checks and compares them). The Rust engine is checked against it in
 * `conformanceWasmPortEdits.integration.test.ts`, which also writes it
 * (`VC_PORT_EDITS_UPDATE=1`, `updateGate.ts`). Until #1875 a TypeScript
 * referee ran the same scripts on that engine against the same file.
 *
 * A moved hash tells you the step; the field takes a dump:
 * `VC_PORT_EDITS_DUMP=<dir> VC_PORT_EDITS_CASE=<case id>` writes each line's
 * canonical views under `<dir>/<engine>/`, to diff against a run of the
 * build before the change.
 */

/** The speed a case plays at: the fastest, so its hours cost the fewest frames. */
const PLAY_SPEED = 3;

/** `advance`'s last argument as the frame loop passes it. */
const STEP_OWED_MINUTES = true;

/** `advance`'s `steadyClock`, off: the frame loop passes the frame times
 *  it measured. */
const STEADY_CLOCK_OFF = false;

/** `viewFrame`'s `full`, off: the light frame, whose header holds the
 *  clock. */
const FULL_FRAME_OFF = false;

/** The kinds a save's structure tiles have; they carry no width, and a room
 *  lookup passes over them. */
const STRUCTURE_KINDS: ReadonlySet<string> = new Set(["floor", "lobby"]);

/** Frames in a row the clock may stand still before play calls it stuck. */
const MAX_STILL_FRAMES = 10_000;

/** The record slot a swap's or an undo's generation sits in; the golden
 *  leaves it out. */
const GENERATION = "generation";

/** The record the undo and redo answers are decoded by: `restore`'s
 *  (`[status, generation]`), since the layout has no record of their own. */
const UNDO_RECORD = "restore";

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

interface SavedUnit {
  readonly id: number;
  readonly kind: string;
  readonly floor: number;
  readonly x: number;
  /** Rooms carry it; the structure tiles (`STRUCTURE_KINDS`) do not. */
  readonly width?: number;
}

export interface SavedTransport {
  readonly id: number;
  readonly kind: string;
  readonly x: number;
  readonly width: number;
  readonly bottom: number;
  readonly top: number;
  /** The floors the shaft skips, when it skips any. */
  readonly skipFloors?: readonly number[];
}

/** A mark the people who set out after it are told apart by: the id the
 *  crowd's next person takes at the mark, and the engine's generation,
 *  which a done swap, undo or redo moves (each can start the crowd's ids
 *  again from 1). */
export interface PeopleMark {
  readonly nextId: number;
  readonly generation: number;
}

/**
 * A case's run on one engine. Each step appends one line; `play` appends one
 * after the case's first frame and one per hour it crosses, and one at its
 * end when its last frame wrote none.
 */
export class PortEditSession {
  readonly lines: PortEditLine[] = [];
  readonly port: EnginePort;
  private readonly codes: PortCodes;
  private batch: unknown[] = [];
  private owed = 0;
  private played = false;
  private readonly clockSlot: number;
  private readonly dumpTo: string | undefined;

  constructor(
    private readonly leg: PortEditLeg,
    private readonly caseId: string,
    start: FrameDayStart,
    dumpDir?: string,
  ) {
    this.port = leg.port;
    this.dumpTo = dumpDir === undefined ? undefined : freshDumpDir(dumpDir, leg.name);
    this.codes = new PortCodes(this.port);
    const header = (JSON.parse(this.port.viewLayout()) as { header: Record<string, number> }).header;
    if (!Number.isInteger(header.minutes)) throw new Error(`${caseId}: the frame layout has no minutes slot`);
    this.clockSlot = header.minutes;
    // The placeholder tower's events are not the case's.
    this.drain([]);
    startTower(this.port, start);
    this.line("start", "start", null);
  }

  /** The clock's minutes. */
  minute(): number {
    return this.port.viewFrame(FULL_FRAME_OFF)[this.clockSlot];
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
    return this.answer("command", want, step, op, call.apply(this.port, args));
  }

  /** Load a save through `restore` (the history source), which must land.
   *  The game drops the minutes its frame loop owed when it follows a swap
   *  (`followSwap`), so play after it starts owing none. */
  restore(step: string, text: string): Record<string, number | string> {
    const answer = this.answer("swap", "done", step, "restore", this.port.restore(text));
    this.owed = 0;
    return answer;
  }

  /** Load a save through `loadSave` (the stored source), which must land;
   *  the owed minutes go as for `restore`. */
  loadSave(step: string, text: string): Record<string, number | string> {
    const answer = this.answer("swap", "done", step, "loadSave", this.port.loadSave(text));
    this.owed = 0;
    return answer;
  }

  /** Step the engine's undo trail back or forward, as the game's undo and
   *  redo buttons do; the answer adds the notice the game shows. The game
   *  follows a step taken as the same tower (`followSwap("step")`), whose
   *  time does not go back, so the owed minutes stay. */
  history(step: string, which: "undo" | "redo", want: Outcome): Record<string, number | string> {
    const rec = this.port[which]();
    const notice = this.port.undoNotice();
    return this.answer("history", want, step, UNDO_RECORD, rec, { notice });
  }

  /** Open an undo step before an edit, as a tool's press does. */
  capture(label: string): void {
    this.port.undoCapture(label);
    this.line(`open an undo step: ${label}`, "undo step", null);
  }

  /** Close the open undo step, as a tool's release does; the answer says
   *  whether the tower changed, so the step was kept. */
  commit(step: string): void {
    this.line(step, "undo step", { kept: this.port.undoCommit() });
  }

  /** Decode `rec` by `op`'s slot names, check its status, and record it. */
  private answer(
    kind: LineKind,
    want: Outcome,
    step: string,
    op: string,
    rec: PortRecord,
    extra: Record<string, string | undefined> = {},
  ): Record<string, number | string> {
    const fields = this.codes.fields(op);
    if (fields.length === 0) throw new Error(`${this.caseId}: ${op} has no record in the layout`);
    const statusAt = fields.indexOf(STATUS_SLOT);
    if (statusAt < 0) throw new Error(`${this.caseId}: ${op}'s record has no ${STATUS_SLOT} slot`);
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
    if (outcomeOf(rec[statusAt]) !== want) throw new Error(`${this.caseId}: ${step}: the script says ${want}, the engine answered ${canonicalJson(answer)}`);
    this.line(step, kind, answer);
    return answer;
  }

  /** Record what a read answers; a read with no value answers "(none)". */
  read(step: string, value: (port: EnginePort) => string | boolean | undefined): void {
    this.line(step, "read", value(this.port) ?? "(none)");
  }

  /** Record a read that answers JSON text, parsed, so key order does not
   *  matter. */
  readJson(step: string, value: (port: EnginePort) => string | undefined): AnswerValue {
    const text = value(this.port);
    const parsed = text === undefined ? "(none)" : (JSON.parse(text) as AnswerValue);
    this.line(step, "read", parsed);
    return parsed;
  }

  /** The crowd view's people and the id its next person takes; a view the
   *  scripts cannot read throws, saying why. */
  private crowd(): CrowdView {
    const view: unknown = JSON.parse(this.leg.crowdView());
    const problem = crowdProblem(view);
    if (problem !== undefined) throw new Error(`${this.caseId}: the crowd view ${problem}`);
    return view as CrowdView;
  }

  /** The ids of the people walking to the shaft their current leg takes. */
  walkingTo(id: number): number[] {
    return walkingTo(this.crowd(), id);
  }

  /** The ids of the people midway on a route that never takes the shaft
   *  (`MIDWAY_LEGS_AHEAD`). */
  midRouteAvoiding(id: number): number[] {
    return midRouteAvoiding(this.crowd(), id);
  }

  /** The ids of the people in the crowd. */
  personIds(): Set<number> {
    return new Set(this.crowd().people.map((p) => p.id));
  }

  /** Mark the crowd, to tell the people who set out after this apart. */
  markPeople(): PeopleMark {
    return { nextId: this.crowd().nextId, generation: this.port.generation() };
  }

  /** The shafts of the route legs between two floors, either way, of the
   *  people who set out after the mark. A swap, undo or redo since it
   *  throws, as the ids can start again. */
  shaftsBetween(a: number, b: number, since: PeopleMark): number[] {
    if (this.port.generation() !== since.generation) throw new Error(`${this.caseId}: a swap, undo or redo since the mark can start the crowd's ids again`);
    const view = this.crowd();
    if (view.nextId < since.nextId) throw new Error(`${this.caseId}: the crowd's next person id went from ${since.nextId} to ${view.nextId} with no swap, undo or redo`);
    return shaftsBetween(view, a, b, since.nextId);
  }

  /** Stop the run when what a step must have done did not happen. */
  require(what: string, ok: boolean): void {
    if (!ok) throw new Error(`${this.caseId}: ${what}`);
  }

  /** The frame loop's bare step, which answers nothing. */
  tick(minutes: number): void {
    this.port.tick(minutes);
    this.line(`tick ${minutes} ${minutes === 1 ? "minute" : "minutes"}`, "tick", null);
  }

  /** A tooling write both engines have, recorded with no answer. */
  setMoney(amount: number): void {
    this.leg.setMoney(amount);
    this.line(`set money to ${amount}`, "tooling", null);
  }

  /** The money the engine holds. */
  money(): number {
    const money = this.codes.slot(this.port.statsStrip(), "statsStrip", "money");
    if (!Number.isFinite(money)) throw new Error(`${this.caseId}: the stats strip reads ${money} for the money`);
    return money;
  }

  /** The save, parsed, to find ids by cell as the game's hit test does. */
  private save(): { units: SavedUnit[]; transports: SavedTransport[] } {
    return JSON.parse(this.port.serialize()) as { units: SavedUnit[]; transports: SavedTransport[] };
  }

  /** The room on a floor (a tall room's lowest) covering x, passing over
   *  the floor and lobby tiles under it. A room with no width is a save
   *  this lookup cannot read, so it throws. */
  private roomAt(floor: number, x: number): SavedUnit | undefined {
    let found: SavedUnit | undefined;
    for (const u of this.save().units) {
      if (STRUCTURE_KINDS.has(u.kind)) continue;
      if (typeof u.width !== "number" || !Number.isFinite(u.width)) throw new Error(`${this.caseId}: the ${u.kind} with id ${u.id} has no width`);
      if (!found && u.floor === floor && x >= u.x && x < u.x + u.width) found = u;
    }
    return found;
  }

  /** Whether a room on a floor covers x. */
  hasUnitAt(floor: number, x: number): boolean {
    return this.roomAt(floor, x) !== undefined;
  }

  /** The id of the room on a floor covering x; a case that names an empty
   *  cell is wrong, so it throws. */
  unitAt(floor: number, x: number): number {
    const u = this.roomAt(floor, x);
    if (!u) throw new Error(`${this.caseId}: no room at floor ${floor}, x ${x}`);
    return u.id;
  }

  /** The shaft with an id, if the tower has one. */
  shaftById(id: number): SavedTransport | undefined {
    return this.save().transports.find((t) => t.id === id);
  }

  /** The floors that hold a lobby tile. */
  lobbyFloors(): ReadonlySet<number> {
    return new Set(this.save().units.flatMap((u) => (u.kind === "lobby" ? [u.floor] : [])));
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

  /** Play `minutes` of game time in whole frames, as the frame loop does:
   *  events drained every frame, a line after the case's first frame and
   *  after each frame that crosses an hour, and one at the end when the
   *  last frame wrote none. */
  play(minutes: number): void {
    this.playFrames(minutes);
  }

  /** Play as `play` does, and answer the ids of the people in the crowd
   *  after its first frame that moves the clock. The session reads them
   *  itself, so no script code runs inside a play. */
  playReadingFirstMove(minutes: number): Set<number> {
    return this.playReadingFirstMoveOf(minutes, () => this.personIds());
  }

  /** `read`'s answer after the first frame of `play(minutes)` that moves
   *  the clock. */
  playReadingFirstMoveOf<T>(minutes: number, read: () => T): T {
    const seen: { value?: T } = {};
    let moved = false;
    this.playFrames(minutes, () => {
      if (!moved) seen.value = read();
      moved = true;
    });
    if (!moved) throw new Error(`${this.caseId}: play ${minutes} minutes: the clock never moved`);
    return seen.value as T;
  }

  /** `play`'s frames; `onMove` runs after each frame that moves the clock. */
  private playFrames(minutes: number, onMove?: () => void): void {
    if (!(Number.isFinite(minutes) && minutes > 0)) throw new Error(`${this.caseId}: play needs a positive number of minutes, and got ${minutes}`);
    const mps = GOLDEN_SPEEDS[PLAY_SPEED];
    const step = `play ${minutes} minutes`;
    const from = this.minute();
    let now = from;
    let hour = Math.floor(now / 60);
    let frames = 0;
    let still = 0;
    let lastWasLine = false;
    while (now < from + minutes) {
      [, this.owed] = this.port.advance(this.owed, FRAME_TIMES_MS[frames % FRAME_TIMES_MS.length], mps, STEADY_CLOCK_OFF, STEP_OWED_MINUTES);
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
      if (lastWasLine) this.line(step, "play", first && nowHour === hour ? "first frame" : { hour: nowHour });
      hour = nowHour;
      if (now > before) onMove?.();
    }
    if (!lastWasLine) this.line(step, "play", "end");
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

  private line(step: string, kind: LineKind, answer: AnswerValue): void {
    this.drain(this.batch);
    const minute = this.minute();
    if (!Number.isFinite(minute)) throw new Error(`${this.caseId}: ${step}: the clock reads ${minute}`);
    const state = this.leg.stateView();
    const crowd = this.leg.crowdView();
    if (this.dumpTo !== undefined) {
      const file = resolve(this.dumpTo, `${String(this.lines.length).padStart(3, "0")}.json`);
      writeFileSync(file, `${JSON.stringify({ step, kind, answer, minute, state: JSON.parse(state), crowd: JSON.parse(crowd), events: this.batch }, null, 1)}\n`);
    }
    this.lines.push({ step, kind, answer, minute, state: digestText(state), crowd: digestText(crowd), events: digestText(canonicalJson(this.batch)), count: this.batch.length });
    this.batch = [];
  }
}
