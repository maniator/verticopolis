// The engine port (facade slice 7, the 2026-10-28 redesign). The contract is
// `_bmad-output/planning-artifacts/architecture/architecture-rust-facade-2026-10-20/engine-port-contract.md`.
//
// One synchronous, numeric interface that the binding's `Engine` (Rust) and
// `TsEngine` (TypeScript) both implement, so the game holds one `EnginePort`
// and calls it directly. Arguments are numbers, booleans, a `Float64Array` or
// one of the few strings the contract's section 4 lists; answers are a number,
// a boolean, a `Float64Array` record, or a text getter's string. Kinds, modes,
// calendars, film policies, log kinds and states cross as codes into the
// tables of `viewLayout()`.
//
// A command answers a result record: slot 0 the status (1 done, 0 refused),
// slot 1 the money delta the engine measured around it, then the op's own
// slots named in `viewLayout().records`. Only the members that answer a
// status clear and set `lastReason()`.
//
// `src/simport/enginePort.types.test.ts` holds both engines to this shape; a
// member goes here only when both have it.

/** A `Float64Array` record whose slots `viewLayout().records` names. */
export type PortRecord = Float64Array;

/** Time, lifecycle and saves (contract section 2). */
export interface EnginePortLifecycle {
  /** The frame loop's step; `dtMinutes` is a finite real, 0 or more. */
  tick(dtMinutes: number): void;
  /** One frame's time through the fixed step (`advanceOwedMinutes`):
   *  `owed` is the minutes the host carried, and the answer is
   *  `[steps, owed]`, the steps run and the minutes still owed. The engine
   *  keeps the step mode they were owed under; `step` false owes the frame's
   *  minutes without stepping them. */
  advance(owed: number, dtMs: number, minutesPerSecond: number, steadyClock: boolean, step: boolean): PortRecord;
  /** The save; JSON is the save format. */
  serialize(): string;
  /** The `stored` and `legacy` sources: `[status, generation]`. */
  loadSave(text: string): PortRecord;
  /** The `history` source: keeps the live camera and auto-bridge preference. */
  restore(text: string): PortRecord;
  /** The `found` source. */
  foundTower(seed: number, modeCode: number, calendarCode: number, unbridged: boolean): PortRecord;
  /** Moves on every done swap; the reader rebuilds on a move. */
  generation(): number;
  undoSignature(): string;
  /** Takes the events since the last drain: `[dropped, count]`. */
  drainEvents(): PortRecord;
  /** Event `i` of the last drained batch, as `{ name, payload }` JSON. */
  eventText(i: number): string | undefined;
  /** Marks the tower as the title screen's scenery. */
  setBackdrop(on: boolean): void;
}

/** The view and its text (contract sections 2 and 5). */
export interface EnginePortView {
  /** Slots, widths, code tables and record slots, as JSON; read once. */
  viewLayout(): string;
  /** A fresh copy the caller owns, per tower revision. */
  viewStructure(): Float64Array;
  /** A fresh copy the caller owns, per frame. */
  viewFrame(full: boolean): Float64Array;
  /** `[revision, full, ids...]`: the rooms whose label or subtype changed. */
  unitMetaChanged(since: number): PortRecord;
  unitLabel(id: number): string | undefined;
  unitSubtype(id: number): string | undefined;
  towerName(): string | undefined;
  /** The refusal text of the last status call that refused. */
  lastReason(): string | undefined;
  /** `(seq, kindCode, minute)` triples after `seq`. */
  logAfter(seq: number): PortRecord;
  logText(seq: number): string | undefined;
  /** The saved camera as JSON, read once per tower. */
  view(): string | undefined;
  /** The emergency waiting on the player as JSON `{ kind, cost, message }`,
   *  read when the frame's `pendingChoice` flag rises. */
  pendingChoice(): string | undefined;
}

/** The commands; each answers a result record (contract section 2). */
export interface EnginePortCommands {
  buildAt(kind: number, floor: number, x: number): PortRecord;
  paintTiles(kind: number, floor: number, tiles: Float64Array): PortRecord;
  buildShaft(kind: number, x: number, bottom: number, top: number): PortRecord;
  demolish(id: number, bulldoze: boolean): PortRecord;
  changeCars(id: number, add: boolean): PortRecord;
  startExtend(id: number): PortRecord;
  stopExtend(): PortRecord;
  extendShaft(id: number, up: boolean, targetFloor: number): PortRecord;
  markStop(id: number, floor: number, stop: boolean): PortRecord;
  expressStops(id: number): PortRecord;
  dropStops(id: number): PortRecord;
  scheduleShaft(id: number, slots: Float64Array): PortRecord;
  labelUnit(id: number, text: string): PortRecord;
  stepRent(id: number, dir: number): PortRecord;
  noRate(id: number): PortRecord;
  setRent(id: number, target: number): PortRecord;
  rentBatch(kind: number, target: number, onlyDefault: boolean): PortRecord;
  setFilm(id: number, policyCode: number): PortRecord;
  rerollUnit(id: number): PortRecord;
  bookExterminator(): PortRecord;
  answerChoice(accept: boolean): PortRecord;
  chooseAutoBridge(value: boolean): PortRecord;
  flipAutoBridge(): PortRecord;
  nameTower(text?: string | null): PortRecord;
  setCamera(tile: number, floor: number, zoom: number): PortRecord;
  logLine(text: string, kindCode: number): PortRecord;
}

/** The queries (contract section 2). */
export interface EnginePortQueries {
  quoteBuild(kind: number, floor: number, x: number): PortRecord;
  quoteShaft(kind: number, x: number, bottom: number, top: number): PortRecord;
  statsStrip(): PortRecord;
  hotspot(): PortRecord;
  /** Bits in the layout's `onboarding` order. */
  onboarding(): number;
  /** Whether the VIP has rated the tower a TOWER, the win. */
  evaluatedTower(): boolean;
  heatCells(modeCode: number): PortRecord;
  crewCoverage(): PortRecord;
  /** Empty for an id that names no unit. */
  unitCard(id: number): PortRecord;
  /** Empty for an id that names no shaft. */
  shaftCard(id: number): PortRecord;
}

/** The renderer's reads beyond the view frame (contract section 2, PR 5b).
 *  The overlay's peak congestion is `hotspot`'s ratio. */
export interface EnginePortRender {
  /** The mean congestion over populated floors; read per frame. */
  congestion(): number;
  /** The elevator queue projection as `queueView`, `queueLanding` and
   *  `queueCar` slots; kept per step and revision, so read per frame. */
  queueView(): PortRecord;
  /** `[count, ids...]`: the working garage spaces, ascending. */
  parkingSet(): PortRecord;
  /** The garage fill, 0 to 1, for `spots` working spaces. */
  parkingUsage(spots: number): number;
  /** The recycling bins' fill, 0 to 1. */
  recyclingFill(): number;
  /** Whether a walker can stand at `floor`, `x`; false off a whole tile. */
  positionReachable(floor: number, x: number): boolean;
}

/** The whole port: what the game holds, whichever engine runs. */
export interface EnginePort extends EnginePortLifecycle, EnginePortView, EnginePortCommands, EnginePortQueries, EnginePortRender {}
