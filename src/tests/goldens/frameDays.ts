import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SPEEDS } from "../../game/frameLoop";
import { swapDone } from "../../game/portLifecycle";
import type { EnginePort } from "../../simport/enginePort";
import { PortCodes } from "../../simport/portCodes";
import { canonicalJson, digestText } from "../conformance/canonical";
import { writeGoldenFile } from "./updateGate";

/**
 * The frame-day golden: the #945 Dual run row ("a day on every fixture at
 * every speed with no divergence, with the engine-owned step driver") pinned
 * as hashes. It is the proposed evidence for that row once the TypeScript
 * engine is gone (owner sign-off pending on #945).
 *
 * Each case loads a tower the way the game does (a fixture through
 * `loadVctower`, a new game through `foundTower`) and plays one game day
 * through `advance`, the call the game's frame loop makes every frame. The
 * frame times are the dual run's cycle, from a 120 Hz device to a 3-second
 * pause, so frames carry owed minutes between them, run several steps at once
 * and meet the 30-minute catch-up cap. Between frames it drains the gameplay
 * events, as the frame loop does. It records a checkpoint at the start, after the first frame
 * (where a new game runs its founding pass), after every frame that crosses
 * an hour, and after the last frame: the clock, the hashes of the state view
 * and the crowd view (the two views the conformance lock hashes), and the
 * hash and count of the events drained since the last checkpoint.
 *
 * `frame-days.json` holds the checkpoints. The Rust engine is checked against
 * it in `conformanceWasmFrameDays.integration.test.ts`, which also writes it
 * (`VC_FRAME_DAYS_UPDATE=1`, `updateGate.ts`). While the TypeScript engine exists,
 * `frameDaysReferee.integration.test.ts` runs the same cases on it against the
 * same file, so the golden is what the dual run compared, and the two engines
 * agree through it. That check goes with `src/engine/`.
 *
 * A moved hash tells you the hour; the field takes a dump. Dump the views of a
 * case before and after the change and diff the files:
 * `VC_FRAME_DAYS_DUMP=<dir> VC_FRAME_DAYS_CASE=<case id>` writes each
 * checkpoint's canonical views under `<dir>/<engine>/`.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
export const FRAME_DAYS_FILE = resolve(ROOT, "src/tests/goldens/frame-days.json");

/** The frame times the cases feed `advance`, in milliseconds: the reference
 *  rate, a 30 Hz device, a 120 Hz one, and two frames the shipped host never
 *  sends (a 400 ms hitch and a 3-second pause), since Excalibur turns any
 *  frame over 200 ms into 1 ms (`frameLoop.ts` notes it). The engine takes
 *  them as it would any frame, and they reach the catch-up cap, so they stay
 *  as the dual run had them. */
export const FRAME_TIMES_MS: readonly number[] = [1000 / 60, 1000 / 60, 1000 / 30, 1000 / 120, 1000 / 60, 400, 1000 / 60, 1000 / 60, 3000, 1000 / 60];

const DAY = 24 * 60;

/** Checkpoints every case takes at least: the start, the first frame and 24
 *  hour boundaries (the last frame adds one when the day does not end on a
 *  checkpoint). */
export const MIN_DAY_CHECKPOINTS = 26;

/** The checkpoint taken after the first frame: the first one a change made
 *  after the start can move. */
export const FIRST_FRAME_CHECKPOINT = 1;

/** The checkpoints before the day's own play: the start and the first frame,
 *  whose events are the load's or the founding's own. */
export const SETUP_CHECKPOINTS = 2;

/** The fixture whose day carries events during play. Today it is the only
 *  one, so the event check names it, and losing those events says so. */
export const EVENT_DAY_FIXTURE = "towerone-star1.vctower";

/** Frames in a row the clock may stand still before the run calls it stuck:
 *  the slowest case (speed 1 at the lunch dilation, 120 Hz frames) moves it
 *  within a few hundred. */
const MAX_STILL_FRAMES = 10_000;

/** `advance`'s last argument as the frame loop passes it: every frame it runs
 *  steps the minutes it owes (`false` would owe them without stepping). */
const STEP_OWED_MINUTES = true;

/** Where a case's tower comes from. */
export type FrameDayStart =
  | { readonly kind: "fixture"; readonly file: string }
  | { readonly kind: "found"; readonly seed: number; readonly mode: "classic" | "modern"; readonly calendar: "realWorld" | "canon"; readonly unbridged: boolean };

export interface FrameDayCase {
  readonly id: string;
  readonly start: FrameDayStart;
  /** The game's speed setting, 1 to 3 (`SPEEDS`). */
  readonly speed: number;
  readonly steadyClock: boolean;
  readonly frameTimes: readonly number[];
}

export interface FrameDayCheckpoint {
  /** The clock's minutes when the checkpoint was taken. */
  readonly minute: number;
  readonly state: string;
  readonly crowd: string;
  readonly events: string;
  /** How many events the batch holds. */
  readonly count: number;
}

/** One engine behind the port, with the two hashed views the conformance
 *  lock uses, as canonical JSON. `name` labels its dumps. */
export interface FrameDayLeg {
  readonly name: string;
  readonly port: EnginePort;
  stateView(): string;
  crowdView(): string;
}

const FIXTURE_DIR = resolve(ROOT, "conformance/fixtures");

/** Every save under the fixtures directory, so a new one is covered. */
export const FRAME_DAY_FIXTURES: readonly string[] = readdirSync(FIXTURE_DIR)
  .filter((f) => f.endsWith(".vctower"))
  .sort();

const fixtureCase = (file: string, speed: number): FrameDayCase => ({
  id: `${file.replace(/\.vctower$/, "")} at speed ${speed}`,
  start: { kind: "fixture", file },
  speed,
  steadyClock: false,
  frameTimes: FRAME_TIMES_MS,
});

const found = (seed: number, mode: "classic" | "modern", calendar: "realWorld" | "canon" = "realWorld", unbridged = false) =>
  ({ kind: "found", seed, mode, calendar, unbridged }) as const;

/** The dual run's day gate, case for case: every fixture at each speed, a
 *  new game of each mode, the canon calendar founded unbridged, one steady
 *  reference frame rate and the steady clock. */
export const FRAME_DAY_CASES: readonly FrameDayCase[] = [
  ...FRAME_DAY_FIXTURES.flatMap((file) => [1, 2, 3].map((speed) => fixtureCase(file, speed))),
  { id: "new Classic game at speed 3", start: found(4242, "classic"), speed: 3, steadyClock: false, frameTimes: FRAME_TIMES_MS },
  { id: "new Modern game at speed 3", start: found(4242, "modern"), speed: 3, steadyClock: false, frameTimes: FRAME_TIMES_MS },
  { id: "new Modern game on the canon calendar, unbridged, at speed 2", start: found(99, "modern", "canon", true), speed: 2, steadyClock: false, frameTimes: FRAME_TIMES_MS },
  { id: "split-tower at speed 3, one steady frame rate", start: { kind: "fixture", file: "split-tower.vctower" }, speed: 3, steadyClock: false, frameTimes: [1000 / 60] },
  { id: "towerone_6 at speed 3 on the steady clock", start: { kind: "fixture", file: "towerone_6.vctower" }, speed: 3, steadyClock: true, frameTimes: FRAME_TIMES_MS },
];

function begin(port: EnginePort, start: FrameDayStart): void {
  if (start.kind === "fixture") {
    swapDone(port, port.loadVctower(readFileSync(resolve(FIXTURE_DIR, start.file), "utf8")));
    return;
  }
  const codes = new PortCodes(port);
  swapDone(port, port.foundTower(start.seed, codes.code("modes", start.mode), codes.code("calendars", start.calendar), start.unbridged));
}

const dumpDir = process.env.VC_FRAME_DAYS_DUMP;
const dumpCase = process.env.VC_FRAME_DAYS_CASE;
if (dumpDir && !FRAME_DAY_CASES.some((c) => c.id === dumpCase)) {
  throw new Error(`VC_FRAME_DAYS_DUMP needs VC_FRAME_DAYS_CASE set to a case id; ${JSON.stringify(dumpCase)} names none`);
}

/** Play one case on one engine and return its checkpoints. `afterStart`
 *  runs once, right after the start checkpoint: the teeth test changes the
 *  tower there to show the next checkpoint catches it (such a run writes no
 *  dump). */
export function runFrameDay(leg: FrameDayLeg, c: FrameDayCase, afterStart?: () => void): FrameDayCheckpoint[] {
  const port = leg.port;
  if (c.frameTimes.length === 0) throw new Error(`${c.id}: no frame times`);
  const minutesPerSecond = SPEEDS[c.speed];
  if (!minutesPerSecond) throw new Error(`${c.id}: speed ${c.speed} is not a running speed`);
  const drain = (into: unknown[]) => {
    const [dropped, count] = port.drainEvents();
    if (dropped !== 0) throw new Error(`${c.id}: the engine dropped ${dropped} gameplay events`);
    for (let i = 0; i < count; i++) {
      const text = port.eventText(i);
      if (text === undefined) throw new Error(`${c.id}: event ${i} of ${count} has no text`);
      into.push(JSON.parse(text));
    }
  };
  // The placeholder tower the engine was made with is not the case's: its
  // events go, and the batch starts with the load's or the founding's own.
  drain([]);
  begin(port, c.start);
  const header = (JSON.parse(port.viewLayout()) as { header: Record<string, number> }).header;
  if (!Number.isInteger(header.minutes)) throw new Error(`${c.id}: the frame layout has no minutes slot`);
  // The frame loop reads a frame that is not full (only the rooms that
  // changed); its header is whole in every frame.
  const clock = () => port.viewFrame(false)[header.minutes];
  // The game freezes time while a choice waits for the player, and this run
  // answers none, so a case that opens one would pin a day no player sees.
  // The port answers with the choice's text while one is open.
  const choiceOpen = () => typeof port.pendingChoice() === "string";
  if (choiceOpen()) throw new Error(`${c.id}: the tower starts with a choice open; the golden plays no choices`);
  const dumping = dumpDir !== undefined && dumpCase === c.id && afterStart === undefined;
  const out: FrameDayCheckpoint[] = [];
  let batch: unknown[] = [];
  const checkpoint = (minute: number) => {
    const state = leg.stateView();
    const crowd = leg.crowdView();
    if (dumping) {
      const dir = resolve(dumpDir, leg.name);
      mkdirSync(dir, { recursive: true });
      writeFileSync(resolve(dir, `${String(out.length).padStart(2, "0")}-${minute}.json`), `${JSON.stringify({ state: JSON.parse(state), crowd: JSON.parse(crowd), events: batch }, null, 1)}\n`);
    }
    out.push({ minute, state: digestText(state), crowd: digestText(crowd), events: digestText(canonicalJson(batch)), count: batch.length });
    batch = [];
  };
  drain(batch);
  const from = clock();
  checkpoint(from);
  afterStart?.();
  let owed = 0;
  let frames = 0;
  let still = 0;
  let hour = Math.floor(from / 60);
  let now = from;
  let tookCheckpoint = true;
  while (now < from + DAY) {
    const dtMs = c.frameTimes[frames % c.frameTimes.length];
    // The answer is `[steps, owed]`.
    [, owed] = port.advance(owed, dtMs, minutesPerSecond, c.steadyClock, STEP_OWED_MINUTES);
    frames++;
    drain(batch);
    const before = now;
    now = clock();
    if (choiceOpen()) throw new Error(`${c.id}: a choice opened at minute ${now}; the golden plays no choices`);
    if (!(now >= before)) throw new Error(`${c.id}: the clock went from minute ${before} to ${now}`);
    still = now === before ? still + 1 : 0;
    if (still > MAX_STILL_FRAMES) throw new Error(`${c.id}: the clock stood still for ${still} frames at minute ${now}`);
    const nowHour = Math.floor(now / 60);
    // The catch-up cap keeps a frame inside one hour boundary; two would merge
    // two hours into one checkpoint.
    if (nowHour > hour + 1) throw new Error(`${c.id}: one frame crossed ${nowHour - hour} hours at minute ${now}`);
    tookCheckpoint = frames === 1 || nowHour !== hour;
    hour = nowHour;
    if (tookCheckpoint) checkpoint(now);
  }
  // The day rarely ends on the hour, so the minutes after the last hour get
  // their own checkpoint.
  if (!tookCheckpoint) checkpoint(now);
  return out;
}

/** Why a case's checkpoints are too thin to pin, or nothing. Hashes of an
 *  empty or frozen view would agree on every engine, so a case has to cover a
 *  day, a fixture's state and crowd have to change over it, and the event
 *  day has to carry an event during play. The writer checks its own output
 *  with this before it writes, and the golden's tests check the file. */
export function frameDayProblems(c: FrameDayCase, points: readonly FrameDayCheckpoint[]): string[] {
  const problems: string[] = [];
  if (points.length < MIN_DAY_CHECKPOINTS) problems.push(`${points.length} checkpoints, fewer than ${MIN_DAY_CHECKPOINTS}`);
  const span = points.length > 0 ? points[points.length - 1].minute - points[0].minute : 0;
  if (span < DAY) problems.push(`spans ${span} minutes, less than a day`);
  if (c.start.kind === "fixture") {
    for (const view of ["state", "crowd"] as const) {
      const distinct = new Set(points.map((p) => p[view])).size;
      if (distinct <= points.length / 2) problems.push(`the ${view} view has only ${distinct} distinct ${distinct === 1 ? "hash" : "hashes"} over ${points.length} checkpoints`);
    }
    if (c.start.file === EVENT_DAY_FIXTURE && !points.slice(SETUP_CHECKPOINTS).some((p) => p.count > 0)) problems.push("no event during play");
  }
  return problems;
}

export interface FrameDayGolden {
  readonly cases: Record<string, FrameDayCheckpoint[]>;
}

export function readFrameDays(): FrameDayGolden {
  return JSON.parse(readFileSync(FRAME_DAYS_FILE, "utf8")) as FrameDayGolden;
}

/** One checkpoint per line, cases in the order {@link FRAME_DAY_CASES} lists
 *  them, so a refresh diffs by the hour that moved. */
export function writeFrameDays(cases: Record<string, FrameDayCheckpoint[]>): void {
  const body = FRAME_DAY_CASES.map((c) => {
    const rows = cases[c.id].map((p) => `      ${JSON.stringify({ minute: p.minute, state: p.state, crowd: p.crowd, events: p.events, count: p.count })}`).join(",\n");
    return `    ${JSON.stringify(c.id)}: [\n${rows}\n    ]`;
  });
  writeGoldenFile(FRAME_DAYS_FILE, `{\n  "cases": {\n${body.join(",\n")}\n  }\n}\n`);
}

/** The first checkpoint where `got` departs from `want`, described, or null. */
export function firstFrameDayDifference(got: readonly FrameDayCheckpoint[], want: readonly FrameDayCheckpoint[] | undefined): string | null {
  if (!want) return "the golden has no entry for this case";
  const n = Math.max(got.length, want.length);
  for (let i = 0; i < n; i++) {
    const g = got[i];
    const w = want[i];
    if (!g || !w) return `checkpoint ${i}: ${g ? "extra" : "missing"} (ran ${got.length}, pinned ${want.length})`;
    const moved = (["minute", "state", "crowd", "events", "count"] as const).filter((k) => g[k] !== w[k]);
    if (moved.length > 0) return `checkpoint ${i} (minute ${w.minute}): ${moved.map((k) => `${k} ${String(g[k])} != pinned ${String(w[k])}`).join(", ")}`;
  }
  return null;
}
