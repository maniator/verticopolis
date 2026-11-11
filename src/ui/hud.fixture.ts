import type { GameMode } from "../shared/types";
import { PortCodes } from "../simport/portCodes";
import { mockPort, record } from "../tests/portKit/mockPort";
import type { UI } from "./UI";
import type { HudSource } from "./uiStatus";

/** A log line as the HUD reads it back. */
type LogKind = "info" | "good" | "bad" | "money";

/** The layout's codes, for the log kinds the answers carry. */
const CODES = new PortCodes(mockPort());

/**
 * A hand-built tower for the HUD pump: the header fields the pump reads, and
 * a log the test writes with {@link HudTower.emit}. The pump reads it through
 * a mock port's `logAfter` and `logText` answers, the way it reads the engine.
 * The log keeps the newest {@link HudTower.LOG_KEEP} lines and numbers every
 * line it was given, as the engine's ring does (`LOG_RING_CAP` in
 * `engine-rs/src/sim.rs`, pinned by the Rust test
 * `the_log_ring_keeps_the_newest_lines_and_counts_them_all`).
 */
export class HudTower {
  static readonly LOG_KEEP = 300;
  money = 2_000_000;
  star = 1;
  mode: GameMode = "classic";
  towerName = "Tower One";
  private seq = 0;
  private lines: { seq: number; text: string; kind: LogKind }[] = [];

  /** Add a line to the log, as an engine event does. */
  emit(text: string, kind: LogKind): void {
    this.seq += 1;
    this.lines.push({ seq: this.seq, text, kind });
    if (this.lines.length > HudTower.LOG_KEEP) this.lines.shift();
  }

  /** The number of the newest line (0 before the first). */
  get logSeq(): number {
    return this.seq;
  }

  /** The lines kept, oldest first. */
  get log(): readonly { readonly text: string; readonly kind: LogKind }[] {
    return this.lines;
  }

  /** `logAfter(seq)`: each kept line past `seq` as a (number, kind code,
   *  minute) triple; every line here is stamped 07:00. */
  logAfter(after: number): Float64Array {
    return Float64Array.from(this.lines.filter((l) => l.seq > after).flatMap((l) => [l.seq, CODES.code("logKinds", l.kind), 420]));
  }

  logText(seq: number): string | undefined {
    return this.lines.find((l) => l.seq === seq)?.text;
  }
}

/** One source per tower, as the app holds one engine and reader per tower. */
const sources = new WeakMap<HudTower, HudSource>();

function sourceOf(tower: HudTower): HudSource {
  let src = sources.get(tower);
  if (!src) {
    const port = mockPort({
      statsStrip: () => record("statsStrip", {}),
      logAfter: (seq: number) => tower.logAfter(seq),
      logText: (seq: number) => tower.logText(seq),
      undoDepths: () => Float64Array.of(0, 0),
    });
    const header = { minutes: 420, day: 0, dayOfWeek: 0, isWeekend: false, quarter: 0, year: 0, weekDays: 7, weekendDays: 2 };
    const reader = {
      get header() {
        return { ...header, money: tower.money, star: tower.star, mode: tower.mode, logSeq: tower.logSeq };
      },
      get tower() {
        return { towerName: tower.towerName };
      },
    } as unknown as HudSource["reader"];
    src = { reader, port, codes: new PortCodes(port) };
    sources.set(tower, src);
  }
  return src;
}

/** One throttled UI pass over `tower`. */
export function pump(ui: UI, tower: HudTower): void {
  ui.update(sourceOf(tower));
}

/** Rebase the UI's log cursor on `tower`, as a tower swap does. */
export function rebaseLog(ui: UI, tower: HudTower): void {
  ui.resetLog(sourceOf(tower));
}
