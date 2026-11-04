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

/** Low-frequency keyed inspector facts. Rust produces the status verdicts
 * and the numbers; neither the UI nor the binding recomputes game rules. */
export interface ServiceDiagnosticFacts {
  readonly hotel: {
    readonly rating: "notApplicable" | "counts" | "excluded";
    readonly condition: "other" | "dirty" | "infested";
    readonly infestDays: number | null;
    readonly recovery: boolean | null;
  };
  readonly parking: {
    readonly status: "notApplicable" | "ramp" | "connected" | "disconnected";
    readonly shortage: boolean | null;
    readonly have: number | null;
    readonly total: number | null;
    readonly offices: number | null;
    readonly suites: number | null;
  };
  readonly housekeeping: {
    readonly status: "notApplicable" | "adequate" | "nominalShortfall" | "observedShortfall";
    readonly crews: number | null;
    readonly maids: number | null;
    readonly rooms: number | null;
    readonly maidsPerUnit: number | null;
    readonly roomsPerMaid: number | null;
    readonly cleaned: number | null;
    readonly leftover: number | null;
    readonly infested: number | null;
    readonly outOfReach: number | null;
    readonly hasInfested: boolean | null;
    readonly hasOutOfReach: boolean | null;
    readonly recovery: boolean | null;
  };
  readonly retail: {
    readonly active: boolean;
    readonly today: number | null;
    readonly barWidth: number | null;
    readonly tier: "notApplicable" | "noData" | "low" | "average" | "booming";
    readonly localDemandPct: number | null;
    readonly advice: "none" | "underServed" | "overBuilt";
    readonly profitYest: number | null;
    readonly rainy: boolean | null;
  };
  readonly commercial: {
    /** More than two floors from a (sky) lobby, which halves a venue's trade;
     *  null for a unit the penalty never applies to (a sky bar, or a venue that
     *  earns no traffic income in this mode). */
    readonly lobbyFar: boolean | null;
  };
}

/** How an Auto-tune proposal query ended. The engine decides every status;
 *  the host only picks wording and button state from it. */
export type AutoTuneStatus =
  | "available"
  | "insufficient-data"
  | "unavailable-in-mode"
  | "no-cars"
  | "not-an-elevator"
  | "missing-shaft"
  | "invalid-draft";

/** One day type's readiness: `warm` is what Auto-tune needs to tune that day.
 *  A warm day also carries its measured 24-hour `curve` (0 to 1 per hour of
 *  day), the ring the engine tuned from; a cold day has none. */
export interface AutoTuneDay {
  readonly warm: boolean;
  readonly sampledHours: number;
  readonly curve: readonly number[] | null;
}

/** What `autoTuneProposal` answers (engine-rs `schedule_authoring.rs`).
 *  `proposal` is present only for `available`. A day type that is not warm
 *  keeps the draft's own row (null when the draft has none). */
export interface AutoTuneProposal {
  readonly status: AutoTuneStatus;
  readonly weekday: AutoTuneDay;
  readonly weekend: AutoTuneDay;
  readonly proposal: {
    readonly weekday: readonly number[] | null;
    readonly weekend: readonly number[] | null;
    readonly homeFloors: readonly number[];
    /** True when the engine seeded the homes, false when they are the draft's own. */
    readonly homesSeeded: boolean;
  } | null;
}

/** A named schedule intent. The first three are the Modern presets;
 *  `stage-up-tower` is the staging-only play the raw grid offers in both modes. */
export type SchedulePresetName = "rush" | "balanced" | "feeder" | "stage-up-tower";

/** The three presets the dialog offers as buttons. */
export type AssistedPreset = Exclude<SchedulePresetName, "stage-up-tower">;

/** How a preset query ended. */
export type PresetStatus = "available" | "unavailable-in-mode" | "no-cars" | "not-an-elevator" | "missing-shaft" | "unknown-preset";

/** What `schedulePreset` answers (engine-rs `schedule_presets.rs`): the rows and
 *  homes the preset sets. `weekday` and `weekend` are null for the staging-only
 *  play and on every refusal. */
export interface PresetProposal {
  readonly status: PresetStatus;
  readonly weekday: readonly number[] | null;
  readonly weekend: readonly number[] | null;
  readonly homeFloors: readonly number[];
}

export type ScheduleFactsStatus = "available" | "not-an-elevator" | "missing-shaft" | "invalid-draft";

/** The advice comparison (engine-rs `schedule_facts.rs`). `ready` with empty
 *  `over` and `short` means the schedule and the measured load line up. */
export interface ScheduleAdvice {
  /** `no-cars`: the shaft holds none (a loaded save can). `refused`: the query
   *  itself was refused, and the answer's `status` says why. */
  readonly status: "ready" | "insufficient-data" | "unavailable-in-mode" | "no-cars" | "refused";
  /** Hours (0 to 23) where the authored cars are well above the measured want. */
  readonly over: readonly number[];
  /** Hours where they are well below it; never an hour that runs the whole fleet. */
  readonly short: readonly number[];
}

/** The Simulate staging summary: how the fleet is positioned. It promises no wait time. */
export interface StagingSummary {
  /** True when `peakHour` is the day's measured busiest hour, false when it is
   *  the assumed evening down-rush. */
  readonly measured: boolean;
  readonly peakHour: number;
  readonly activeAtPeak: number;
  readonly upTowerCars: number;
  readonly lobbyCars: number;
  readonly topLobby: number;
  readonly baseLobby: number;
}

/** What `scheduleFacts` answers. `recommended` is the preset to highlight, null
 *  where the mode offers no assisted presets; `staging` is null on a refusal. */
export interface ScheduleFacts {
  readonly status: ScheduleFactsStatus;
  readonly recommended: AssistedPreset | null;
  readonly advice: ScheduleAdvice;
  readonly staging: StagingSummary | null;
  /** The draft's homes as the shaft would hold them: one per car, each on the
   *  nearest served floor (ties to the lower), a car the draft lists no home for
   *  at the base lobby. Empty on a refusal. */
  readonly homeFloors: readonly number[];
}

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
  advance(
    owed: number,
    dtMs: number,
    minutesPerSecond: number,
    steadyClock: boolean,
    step: boolean,
  ): PortRecord;
  /** The save; JSON is the save format. */
  serialize(): string;
  /** The `stored` source: `[status, generation]`. A save with no
   *  `appVersion` is a founder's tower (before 2.0). */
  loadSave(text: string): PortRecord;
  /** The `history` source: keeps the live camera and auto-bridge
   *  preference, and never applies the founder rule. */
  restore(text: string): PortRecord;
  /** The `found` source. */
  foundTower(
    seed: number,
    modeCode: number,
    calendarCode: number,
    unbridged: boolean,
  ): PortRecord;
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
  /** The floor or lobby tile at a cell, which the view gives no id (#1417). */
  demolishTile(floor: number, x: number, bulldoze: boolean): PortRecord;
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
  /** What `rentBatch` would do, nothing written; `ok` 0 for an unpriced kind. */
  quoteRentBatch(kind: number, target: number, onlyDefault: boolean): PortRecord;
  /** A shaft's schedule as `scheduleShaft`'s slots; empty when it has none. */
  shaftSchedule(id: number): PortRecord;
  /** The read-only Auto-tune proposal for a shaft against the dialog's
   *  working schedule (`scheduleShaft`'s slots, empty for none, home count 0
   *  for staging the player has not set by hand). `weekendView` is the day tab
   *  on screen. Writes nothing; applying it is the ordinary `scheduleShaft`. */
  autoTuneProposal(id: number, draft: Float64Array, weekendView: boolean): AutoTuneProposal;
  /** The advice and staging facts for a shaft against the dialog's working
   *  schedule (`draft` in `scheduleShaft`'s slots, empty for none; here its
   *  homes are the staging being summarized). `weekendView` is the day tab on
   *  screen. Writes nothing. */
  scheduleFacts(id: number, draft: Float64Array, weekendView: boolean): ScheduleFacts;
  /** The rows and homes the named preset sets for a shaft. Writes nothing;
   *  applying it is the ordinary `scheduleShaft`. */
  schedulePreset(id: number, preset: SchedulePresetName): PresetProposal;
  /** Whether the tower came from a pre-2.0 save (the founder's welcome). */
  founder(): boolean;
  statsStrip(): PortRecord;
  hotspot(): PortRecord;
  /** Bits in the layout's `onboarding` order. */
  onboarding(): number;
  /** The auto-bridge preference the tower holds (always on in Classic). */
  autoBridge(): boolean;
  /** Whether the VIP has rated the tower a TOWER, the win. */
  evaluatedTower(): boolean;
  heatCells(modeCode: number): PortRecord;
  crewCoverage(): PortRecord;
  /** Empty for an id that names no unit. */
  unitCard(id: number): PortRecord;
  /** Empty for an id that names no shaft. */
  shaftCard(id: number): PortRecord;
  /** The stats screen: the `statsSheet` header, then the sections its last
   *  six slots count. */
  statsSheet(): PortRecord;
  /** One unit's diagnostics facts; empty for an id that names no unit. */
  unitFacts(id: number): PortRecord;
  /** Low-frequency structured service diagnostics for the inspector. */
  serviceDiagnostics(id: number): ServiceDiagnosticFacts | undefined;
}

/** The save files (contract section 2): `.vctower` and the 1994 `.TDT`. */
export interface EnginePortFiles {
  /** A `.vctower` file (the `stored` source): `[status, generation]`. */
  loadVctower(text: string): PortRecord;
  /** The tower as `.vctower` text; undefined, with `lastReason()`, when the
   *  stamp refuses the build name or the time. */
  exportVctower(appVersion: string, savedAtMs: number): string | undefined;
  /** Reads and stages a `.TDT` file and answers its report's numbers; the
   *  live tower is untouched until `adoptTdt`. */
  loadTdt(bytes: Uint8Array, filename: string): PortRecord;
  /** Note `i` of the staged file: the header's notes, then the warnings. */
  tdtNote(i: number): string | undefined;
  tdtTowerName(): string | undefined;
  /** Swaps the staged tower in (the `legacy` source): `[status, generation]`. */
  adoptTdt(): PortRecord;
  /** Writes the tower as a `.TDT` file and answers the report's numbers. */
  tdtExport(): PortRecord;
  /** The last done `tdtExport`'s bytes, handed over once. */
  tdtFile(): Uint8Array | undefined;
  /** Ready to read or write a `.TDT` file. Only an engine with no `.TDT`
   *  codec of its own has it (the TypeScript engine borrows the Rust one,
   *  which loads asynchronously); the Rust engine reads the file itself. */
  prepareTdt?(): Promise<void>;
}

/** The renderer's reads beyond the view frame (contract section 2, PR 5b).
 *  The overlay's peak congestion is `hotspot`'s ratio. */
export interface EnginePortRender {
  /** The mean congestion over populated floors; read per frame. */
  congestion(): number;
  /** The raw congestion ratio of one floor: the value `hotspot` takes its peak
   *  from, 0 for a floor with no reading (empty, stranded, or not a whole
   *  number). For tests and tools that need the number itself; the overlay's
   *  severity ramp saturates. It walks the rooms, so it is not a per-frame read. */
  floorCongestion(floor: number): number;
  /** The elevator queue projection as `queueView`, `queueLanding` and
   *  `queueCar` slots; kept per step and revision, so read per frame. */
  queueView(): PortRecord;
  /** `[count, ids...]`: the working garage spaces, ascending. */
  parkingSet(): PortRecord;
  /** The garage fill, 0 to 1, for `spots` working spaces. */
  parkingUsage(spots: number): number;
  /** The recycling bins' fill, 0 to 1. */
  recyclingFill(): number;
  /** The population the working recycling centers can process. */
  recyclingCapacity(): number;
  /** Whether the working recycling centers can process the whole population. */
  recyclingDemandMet(): boolean;
  /** Whether a walker can stand at `floor`, `x`; false off a whole tile. */
  positionReachable(floor: number, x: number): boolean;
}

/** The whole port: what the game holds, whichever engine runs. */
export interface EnginePort
  extends
    EnginePortLifecycle,
    EnginePortView,
    EnginePortCommands,
    EnginePortQueries,
    EnginePortFiles,
    EnginePortRender {}
