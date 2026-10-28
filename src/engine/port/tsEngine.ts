import { Simulation } from "../Simulation";
import { towerStateSig } from "../UndoHistory";
import type { StepDebt } from "../sim/fixedStep";
import { advanceOwedMinutes } from "../sim/frameStep";
import type { GameplayEvent } from "../gameplayEventBuffer";
import { INVALID_REQUEST } from "../request";
import type { CalendarKind } from "../calendar";
import type { GameMode } from "../types";
import * as cmd from "./commands";
import { VIEW_LAYOUT, VIEW_LAYOUT_TEXT } from "./layout";
import { MetaLog } from "./metaLog";
import * as ask from "./queries";
import { flag, whole, type PortState } from "./record";
import { FrameEncoder, encodeStructure } from "./viewEncode";
import { watchRooms } from "../tower/rooms";

const LOG_KINDS = VIEW_LAYOUT.logKinds;
const MODES = VIEW_LAYOUT.modes as readonly GameMode[];
const CALENDARS = VIEW_LAYOUT.calendars as readonly CalendarKind[];

/**
 * The TypeScript engine behind the engine port (facade slice 7, PR 3; the
 * contract is `engine-port-contract.md`): the members the binding's Rust
 * `Engine` has, over a TypeScript `Simulation`, answering the same records
 * from the same layout (`viewLayout.json`), so the game holds one port and
 * never asks which engine runs. `src/simport/enginePort.types.test.ts` holds
 * both to `EnginePort`, and the golden-array tests hold their answers
 * together on one tower.
 *
 * Like the Rust `Engine`, it is one handle for the session: a done swap
 * (`loadSave`, `restore`, `foundTower`) replaces the simulation inside it and
 * moves `generation()`; a refused one changes nothing. The replaced tower's
 * undrained gameplay events go ahead of the new tower's own, unless it was
 * the title screen's backdrop (`setBackdrop`).
 *
 * The TypeScript engine writes rooms in place, and each write of a field the
 * view reads marks its room (`markRoom`). The engine watches its tower's
 * marks (`watchRooms`) and hands them to the meta log and the frame encoder
 * (`takeMarks`), so a frame or a listing costs the rooms written since the
 * last one, not every room (#1389).
 */
export class TsEngine implements PortState {
  reason: string | undefined;
  private current: Simulation;
  private gen = 0;
  private backdrop = false;
  private drained: GameplayEvent[] = [];
  private frames = new FrameEncoder();
  private readonly meta = new MetaLog();
  /** The step mode `advance` last stepped under, which outlives a swap as
   *  the web host's step debt outlives an adopted tower. */
  private readonly debt: StepDebt = { minutes: 0 };
  /** `advanceOwedMinutes`'s host over the current tower, counting steps. */
  private readonly stepHost = ((engine: TsEngine) => {
    const host = {
      accMinutes: 0,
      steps: 0,
      sim: {
        tick(dt: number): void {
          host.steps++;
          engine.current.tick(dt);
        },
        get clock() {
          return engine.current.clock;
        },
      },
    };
    return host;
  })(this);

  constructor(sim: Simulation) {
    this.current = sim;
    this.watch(sim);
  }

  static newGame(seed: number, mode?: GameMode, calendar?: CalendarKind, unbridged?: boolean): TsEngine {
    return new TsEngine(Simulation.newGame(seed, mode, calendar, unbridged));
  }

  /** The simulation this engine runs, for the TypeScript-only readers that
   *  have not moved to the port yet. */
  get sim(): Simulation {
    return this.current;
  }

  // ---- Lifecycle -----------------------------------------------------------

  tick(dtMinutes: number): void {
    this.current.tick(dtMinutes);
  }

  advance(owed: number, dtMs: number, minutesPerSecond: number, steadyClock: boolean, step: boolean): Float64Array {
    const host = this.stepHost;
    host.accMinutes = owed;
    host.steps = 0;
    advanceOwedMinutes(host, this.debt, dtMs, minutesPerSecond, steadyClock, step);
    return Float64Array.of(host.steps, host.accMinutes);
  }

  serialize(): string {
    return JSON.stringify(this.current.serialize());
  }

  loadSave(text: string): Float64Array {
    return this.swap(text, false);
  }

  /** An undo or redo snapshot: keeps the live camera and auto-bridge. */
  restore(text: string): Float64Array {
    return this.swap(text, true);
  }

  foundTower(seed: number, modeCode: number, calendarCode: number, unbridged: boolean): Float64Array {
    this.reason = undefined;
    const mode = whole(modeCode) ? MODES[modeCode] : undefined;
    const calendar = whole(calendarCode) ? CALENDARS[calendarCode] : undefined;
    if (!whole(seed) || seed < 0 || seed > 0xffffffff || !mode || !calendar) {
      this.reason = INVALID_REQUEST;
      return this.swapRecord(false);
    }
    this.adopt(Simulation.newGame(seed, mode, calendar, unbridged));
    return this.swapRecord(true);
  }

  generation(): number {
    return this.gen;
  }

  undoSignature(): string {
    return towerStateSig(this.current.tower, this.current.money);
  }

  drainEvents(): Float64Array {
    this.drained = this.current.drainGameplayEvents();
    return Float64Array.of(this.current.gameplayEvents.dropped, this.drained.length);
  }

  eventText(i: number): string | undefined {
    const e = whole(i) ? this.drained[i] : undefined;
    return e && JSON.stringify({ name: e.name, payload: e.payload });
  }

  setBackdrop(on: boolean): void {
    this.backdrop = on;
  }

  private swapRecord(done: boolean): Float64Array {
    return Float64Array.of(flag(done), this.gen);
  }

  private swap(text: string, keepLive: boolean): Float64Array {
    this.reason = undefined;
    let next: Simulation;
    try {
      next = Simulation.deserialize(JSON.parse(text));
    } catch (e) {
      this.reason = e instanceof Error ? e.message : String(e);
      return this.swapRecord(false);
    }
    if (keepLive) {
      next.autoBridge = this.current.autoBridge;
      next.view = this.current.view;
    }
    this.adopt(next);
    return this.swapRecord(true);
  }

  private adopt(next: Simulation): void {
    const prev = this.current.gameplayEvents;
    prev.discardOnHandOff = this.backdrop;
    next.gameplayEvents.inherit(prev);
    this.current = next;
    this.watch(next);
    // A new tower's frames count from 1 again, as the Rust engine's do.
    this.frames = new FrameEncoder();
    this.drained = [];
    this.backdrop = false;
    this.gen++;
  }

  // ---- The view and its text -----------------------------------------------

  viewLayout(): string {
    return VIEW_LAYOUT_TEXT;
  }

  viewStructure(): Float64Array {
    return encodeStructure(this.current);
  }

  viewFrame(full: boolean): Float64Array {
    this.takeMarks();
    return this.frames.frame(this.current, full === true, this.meta);
  }

  unitMetaChanged(since: number): Float64Array {
    this.takeMarks();
    return this.meta.changed(this.current.tower, since);
  }

  /** Start watching `sim`'s tower: its marks from here on, and the meta log's
   *  baseline as the text stands now. */
  private watch(sim: Simulation): void {
    watchRooms(sim.tower).clear();
    this.meta.sync(sim.tower);
  }

  /** Hand the rooms marked since the last call to the meta log, which logs
   *  their text changes now, and to the frame encoder, which compares their
   *  fields on the next frame. */
  private takeMarks(): void {
    const tower = this.current.tower;
    const marked = watchRooms(tower);
    this.meta.sync(tower, marked);
    this.frames.mark(marked);
    marked.clear();
  }

  unitLabel(id: number): string | undefined {
    return whole(id) ? this.current.tower.getUnit(id)?.label : undefined;
  }

  unitSubtype(id: number): string | undefined {
    return whole(id) ? this.current.tower.getUnit(id)?.subtype : undefined;
  }

  towerName(): string | undefined {
    return this.current.tower.towerName ?? undefined;
  }

  lastReason(): string | undefined {
    return this.reason;
  }

  /** `(seq, kindCode, minute)` per log line after `seq`, oldest first. */
  logAfter(seq: number): Float64Array {
    if (!whole(seq)) return new Float64Array(0);
    const { log, logSeq } = this.current;
    const first = logSeq - log.length + 1;
    const r: number[] = [];
    log.forEach((e, i) => {
      if (first + i > seq) r.push(first + i, LOG_KINDS.indexOf(e.kind), e.minute);
    });
    return Float64Array.from(r);
  }

  logText(seq: number): string | undefined {
    if (!whole(seq)) return undefined;
    const { log, logSeq } = this.current;
    return log[seq - (logSeq - log.length + 1)]?.text;
  }

  view(): string | undefined {
    const v = this.current.view;
    return v ? JSON.stringify(v) : undefined;
  }

  pendingChoice(): string | undefined {
    const c = this.current.pendingChoice;
    return c ? JSON.stringify({ kind: c.kind, cost: c.cost, message: c.message }) : undefined;
  }

  // ---- Commands --------------------------------------------------------------

  /** A command that may change unit `id`'s label or subtype, logged in the
   *  meta log at once (`MetaLog.edited`). */
  private edit(id: number, run: () => Float64Array): Float64Array {
    const tower = this.current.tower;
    const u = whole(id) ? tower.getUnit(id) : undefined;
    if (!u) return run();
    const { label, subtype } = u;
    const r = run();
    this.meta.edited(u, label, subtype);
    return r;
  }

  buildAt = (kind: number, floor: number, x: number) => cmd.buildAt(this, kind, floor, x);
  paintTiles = (kind: number, floor: number, tiles: Float64Array) => cmd.paintTiles(this, kind, floor, tiles);
  buildShaft = (kind: number, x: number, bottom: number, top: number) => cmd.buildShaft(this, kind, x, bottom, top);
  demolish = (id: number, bulldoze: boolean) => cmd.demolish(this, id, bulldoze);
  changeCars = (id: number, add: boolean) => cmd.changeCars(this, id, add);
  startExtend = (id: number) => cmd.startExtend(this, id);
  stopExtend = () => cmd.stopExtend(this);
  extendShaft = (id: number, up: boolean, targetFloor: number) => cmd.extendShaft(this, id, up, targetFloor);
  markStop = (id: number, floor: number, stop: boolean) => cmd.markStop(this, id, floor, stop);
  expressStops = (id: number) => cmd.expressStops(this, id);
  dropStops = (id: number) => cmd.dropStops(this, id);
  scheduleShaft = (id: number, slots: Float64Array) => cmd.scheduleShaft(this, id, slots);
  labelUnit = (id: number, text: string) => this.edit(id, () => cmd.labelUnit(this, id, text));
  stepRent = (id: number, dir: number) => cmd.stepRent(this, id, dir);
  noRate = (id: number) => cmd.noRate(this, id);
  setRent = (id: number, target: number) => cmd.setRent(this, id, target);
  rentBatch = (kind: number, target: number, onlyDefault: boolean) => cmd.rentBatch(this, kind, target, onlyDefault);
  setFilm = (id: number, policyCode: number) => cmd.setFilm(this, id, policyCode);
  rerollUnit = (id: number) => this.edit(id, () => cmd.rerollUnit(this, id));
  bookExterminator = () => cmd.bookExterminator(this);
  answerChoice = (accept: boolean) => cmd.answerChoice(this, accept);
  chooseAutoBridge = (value: boolean) => cmd.chooseAutoBridge(this, value);
  flipAutoBridge = () => cmd.flipAutoBridge(this);
  nameTower = (text?: string | null) => cmd.nameTower(this, text);
  setCamera = (tile: number, floor: number, zoom: number) => cmd.setCamera(this, tile, floor, zoom);
  logLine = (text: string, kindCode: number) => cmd.logLine(this, text, kindCode);

  // ---- Queries ---------------------------------------------------------------

  quoteBuild = (kind: number, floor: number, x: number) => ask.quoteBuild(this, kind, floor, x);
  quoteShaft = (kind: number, x: number, bottom: number, top: number) => ask.quoteShaft(this, kind, x, bottom, top);
  statsStrip = () => ask.statsStrip(this.current);
  hotspot = () => ask.hotspot(this.current);
  onboarding = () => ask.onboarding(this.current);
  heatCells = (modeCode: number) => ask.heatCells(this.current, modeCode);
  crewCoverage = () => ask.crewCoverage(this.current);
  unitCard = (id: number) => ask.unitCard(this.current, id);
  shaftCard = (id: number) => ask.shaftCard(this.current, id);
}
