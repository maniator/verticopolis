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

/** `undo` and `redo` answer this status when there is no step to take. A done
 *  step is `1` and a refused one `0`, as for any swap. */
export const UNDO_NOTHING_TO_STEP = 2;

/** The status of a step the engine refused; `lastReason()` says why. */
export const UNDO_REFUSED = 0;

/** The status of a step the engine took: the tower changed and the
 *  generation moved, as after a done swap, so the host follows it. */
export const UNDO_DONE = 1;

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
  /** The engine keeps the undo and redo steps of the tower it runs. A gesture
   *  calls `undoCapture(label)` before its first change and `undoCommit()` at
   *  its end, which keeps the capture as a step only if the gesture changed
   *  the tower or moved cash (true when it did), so a room built and sold
   *  again in one gesture leaves the price it lost to undo; `undoDiscard()`
   *  drops a capture for a gesture
   *  canceled into inspection. A gesture that did change the tower is kept
   *  as a step all the same, by `undoDiscard()` and by a capture over it, so
   *  no gesture's edit is left out of the steps. An edit made with no
   *  gesture open is in no step, so a host stops a drag whose gesture an
   *  undo, a redo or another capture closed. A step holds only what the edit changed
   *  (the units and shafts it touched and the cash the edit commands moved),
   *  up to 50 steps each way; any adopted tower, `restore` included, forgets
   *  them, and `undoClear()` forgets them for a tooling swap that bypassed
   *  the port. */
  undoCapture(label: string): void;
  undoCommit(): boolean;
  undoDiscard(): void;
  undoClear(): void;
  /** Step back or forward: `[status, generation]` as `restore` answers, with
   *  `UNDO_NOTHING_TO_STEP` as the status when there is no step. A done step
   *  has already changed the tower and moved the generation, as a done swap
   *  does, and the host then follows it. Time is not rewound: the cash a step
   *  moves is exactly what its edit moved. A step that time can make apply
   *  is refused (status 0, `lastReason()` says why) and stays available:
   *  the balance cannot pay for it yet, or a room it would take out is
   *  burning. A step that can never apply again is refused and dropped, so
   *  an undo goes on to the edit before it and a redo ends the redo trail:
   *  it would take back a build in use since the step was made (a room that
   *  opened, or that a tenant, income or a fire used; a floor or lobby
   *  tile, or a shaft, that stood through an hourly pass, floor a room's
   *  build laid under it included, or a shaft anyone rode), or one used
   *  inside its own gesture before the gesture sold it, it would undo a dig
   *  that searched for treasure, reprice a condo that has sold, or sell
   *  again a room whose tenants changed, or something stands in its way (a
   *  room or shaft in the place of one it would put back, no floor under it
   *  or no story under a floor or lobby tile above the ground floor, a room
   *  on a sky lobby floor that keeps a lobby or a lobby on one that keeps a
   *  room, a room on the metro's row or below it, a tile below that row, a
   *  station it would put back over a tile below its row or onto a room on
   *  it, a cap that is full, a room on a floor or lobby tile it would take
   *  out or, from the ground floor up, the story above one, a shaft left
   *  with no floor on a story it spans, or ground-floor or basement tiles
   *  cut off from the oldest ground-floor tile of the part they stood in (in
   *  play the tower's first lobby tile, unless a sale parted the ground
   *  floor) once the ground-floor lobby tiles it would take out, and the
   *  tiles there it takes with them, are gone, unless each such run was all
   *  there before those lobby tiles or is the one run with a lobby tile that
   *  stands on its own, where no older ground-floor tile of that part stays
   *  or comes back with the step outside it), or it meets a tower it does
   *  not expect (a unit or shaft it would take out or restore gone or
   *  changed, or one it would put back already there). Only an edit clears
   *  what stands in the way, and undoing that edit puts it back. A gesture
   *  under way is committed first. A done step on the Rust engine raises the
   *  tower revision above earlier values; the renderer retains its scene
   *  after such a step and detects the change by that revision.
   *  The test-only TypeScript reference rebuilds a Simulation and resets its
   *  revision, so the host uses a full redraw if the revision did not advance. */
  undo(): PortRecord;
  redo(): PortRecord;
  /** What the last `undo` or `redo` says to the player ("Undid: Bulldoze",
   *  "Nothing to undo."); undefined after a refused step. */
  undoNotice(): string | undefined;
  /** `[undo, redo]`: how many steps each stack holds. */
  undoDepths(): PortRecord;
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
  /** The floors and tiles the next frames send people for (the camera, padded
   *  for riders); a number that is not finite clears it, and every person goes. */
  setPeopleWindow(floorLo: number, floorHi: number, xLo: number, xHi: number): void;
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
  /** The bomb search as JSON `{ deadline, sweeping, searched, seq, lockdown }`,
   *  read when the frame's `bombSearchSeq` moves; undefined when none runs.
   *  Rust only (#349): the TypeScript reference answers a ransom at once. */
  bombSearch?(): string | undefined;
}

/** The commands; each answers a result record (contract section 2). */
export interface EnginePortCommands {
  buildAt(kind: number, floor: number, x: number): PortRecord;
  paintTiles(kind: number, floor: number, tiles: Float64Array): PortRecord;
  /** The height, 1 to 3 stories, a floor's first lobby tile rises to from now
   *  on (#308); `buildAt`, `paintTiles` and `quoteBuild` all use it. */
  setLobbyHeight(height: number): void;
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
  /** Set the film screen `screen` (from 0) of a theater books again once its
   *  film is spent, by code (`filmPolicies`); a screen the theater does not
   *  run is refused (#1950). */
  setFilm(id: number, policyCode: number, screen: number): PortRecord;
  /** Show a film of tier `tier` (by code, `filmTiers`) on screen `screen`
   *  (from 0) of a theater: the record's `cost` slot is the price paid, or the
   *  price wanted on a "funds" refusal. A Modern theater runs two screens and
   *  a Classic one a single screen (`economy.cinemaScreens`, #1950). */
  changeFilm(id: number, tier: number, screen: number): PortRecord;
  /** Set a Modern theater's ticket price step by code (`ticketPrices`); the
   *  record's `priceCode` slot is the code stored (#1950). */
  setTicketPrice(id: number, priceCode: number): PortRecord;
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
  /** How many stories a lobby tile laid at `(floor, x)` now rises (#308):
   *  in Modern, the hall it is laid against (#2068). */
  lobbyRise(floor: number, x: number): number;
  /** The top a stairway or escalator at `x` asked from `bottom` to `top` is
   *  built to: out of a tall lobby a one-story flight climbs the whole lobby
   *  (#308), in Modern the hall under it (#2068). */
  walkwayTop(kind: number, x: number, bottom: number, top: number): number;
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
  /** A walking person's trip (#2092): why they are out, where the leg they
   *  are on began and ends, and their wait. Empty for an id that names
   *  nobody in the tower now. Read while the person card is open. */
  personCard(id: number): PortRecord;
  /** The stats screen: the `statsSheet` header, then the sections its last
   *  six slots count. */
  statsSheet(): PortRecord;
  /** One unit's diagnostics facts; empty for an id that names no unit. */
  unitFacts(id: number): PortRecord;
  /** Low-frequency structured service diagnostics for the inspector. */
  serviceDiagnostics(id: number): ServiceDiagnosticFacts | undefined;
  /** The Map's Eval and Pricing read (#343 S7): one `roomTier` row (id,
   *  floor, x, then codes from `evalTiers` and `rentTiers`) per room that
   *  carries an evaluation or a rent level, in the view's room order. One
   *  pass over the rooms, read through `RoomTierReader` (`roomTiers.ts`):
   *  S8 reads only on the triggers the Map SPEC lists (the Cost bullet of its
   *  S7 section), and not more than once a frame. Only the Rust engine answers it: the
   *  TypeScript reference has no Map views, and a reader takes its absence
   *  as no rows. */
  roomTiers?(): PortRecord;
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
  /** Every lobby hall taller than one story as flat `[floor, x0, x1,
   *  height, ...]` quads by floor and then column, `x1` the hall's last
   *  column (#308, #2068); read once per structure pass. */
  lobbyHeights(): PortRecord;
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
