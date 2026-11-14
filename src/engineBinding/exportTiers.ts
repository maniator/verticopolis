import type * as Binding from "./engine";
import type { WasmEngine } from "./binding";

/**
 * Every export of the WASM binding (`engine-rs/src/wasm.rs` and `engine-rs/src/wasm/`), sorted into a
 * tier (#946, cutover plan story S10, spine AD-3). One table, so a new export
 * has to pick a tier before it can ship: the typecheck fails on an export of
 * the declared package (`engine.d.ts`) missing here, and
 * `bindingExportTiers.guard.test.ts` parses `wasm.rs` and `wasm/` and fails on an export
 * missing here or listed but gone.
 *
 * - **Tier 1, player commands.** What a player can do, with the engine's own
 *   rules and charges, plus the few host writes the game makes on a player's
 *   behalf (the tower's name, the camera, a log line). Of the binding's own
 *   exports, the only tier the UI and game code (`src/ui/`, `src/game/`,
 *   `src/render/`, everything outside this folder and the host) may call to
 *   change the tower. They reach it, and the port's Tier 2 reads, through
 *   `EnginePort` (below).
 * - **The port's members** (`EnginePort`, `src/simport/enginePort.ts`) follow
 *   one rule: a member that writes the tower is Tier 1, and one that only
 *   reads (a quote, a query, a view, a text getter, `lastReason`) is Tier 2,
 *   as are the swaps and the drains. The UI reaches either tier only through
 *   the port, never by importing the binding.
 * - **Tier 2, restores and reads.** Constructors from a save or a seed,
 *   getters and views, and the save writers. Entries marked `hostLoop` drive,
 *   drain or free the running engine (`tick`, the frame and log reads, the
 *   event drain, wasm-bindgen's `free`) and belong to the host and tests;
 *   the guard fails on a call elsewhere to one whose name only the binding
 *   uses, and on any import of the binding's declaration from outside that
 *   scope.
 * - **Tier 3, raw edit, test and seed ops.** Raw edits that skip the charge
 *   rules or the simulation layer (`setMoney`, `setCars`, `resizeTransport`,
 *   the bare tower edits), scripted events with no player trigger
 *   (`startFire`, `bombThreat`, `evaluateStar`), and the seeding calls the
 *   tooling uses. They were added so the side-by-side run of the retired
 *   TypeScript engine could replay its edits on Rust, and the tooling and
 *   tests still use them. The guard fails on a call to one outside this
 *   folder, the host, the generated package, the tooling and tests, and on
 *   a write to `.money` anywhere outside them.
 *
 * Tier 3 is built only with the crate's `tooling` feature (#1057): every
 * tier 3 export sits behind `#[cfg(feature = "tooling")]`, so the player
 * package the game ships and npm publishes (`src/public/engine/`,
 * `engine-rs/pkg-player/`) has none of them. The tooling package
 * (`engine-rs/pkg/` for the Node suites, `engine-rs/pkg-web-tooling/` for a
 * `VC_TOOLING=1` build and a dev serve) has them all, and the guard checks
 * the gates against this table. Argument validation at the boundary is #923's.
 */
export type BindingTier = 1 | 2 | 3;

export interface TierEntry {
  tier: BindingTier;
  /** Tier 2 only: drives, drains or frees the running engine, for the host
   *  alone. */
  hostLoop?: true;
}

type InstanceExport = Exclude<keyof WasmEngine, symbol>;
type StaticExport = Exclude<keyof typeof Binding.Engine, "prototype">;
type ModuleExport = Exclude<keyof typeof Binding, "Engine">;
/** Every name the binding exports: the instance methods (wasm-bindgen's
 *  generated `free` included), the constructors and the module functions. */
export type BindingExport = InstanceExport | StaticExport | ModuleExport;

const T1: TierEntry = { tier: 1 };
const T2: TierEntry = { tier: 2 };
const LOOP: TierEntry = { tier: 2, hostLoop: true };
const T3: TierEntry = { tier: 3 };

export const BINDING_EXPORT_TIERS = {
  // Tier 1: player commands.
  build: T1,
  paintBrush: T1,
  buildTransport: T1,
  sellAt: T1,
  removeFacility: T1,
  addCar: T1,
  removeCar: T1,
  beginExtend: T1,
  extendTransport: T1,
  endExtend: T1,
  setSchedule: T1,
  setStop: T1,
  setExpressStops: T1,
  clearStops: T1,
  adjustRent: T1,
  setNoRate: T1,
  priceUnit: T1,
  applyRentBatch: T1,
  setFilmPolicy: T1,
  rerollSubtype: T1,
  toggleAutoBridge: T1,
  setAutoBridge: T1,
  callExterminator: T1,
  resolveChoice: T1,
  setLabel: T1,
  setTowerName: T1,
  setView: T1,
  emit: T1,

  // Tier 2: restores and reads.
  newGame: T2,
  fromSave: T2,
  fromVctower: T2,
  catalog: T2,
  engineIdentity: T2,
  importTdt: T2,
  exportTdt: T2,
  encodeVctower: T2,
  serialize: T2,
  serializeForSync: LOOP,
  saveDelta: LOOP,
  stateView: T2,
  crowdView: T2,
  stateDigest: T2,
  crowdDigest: T2,
  mode: T2,
  money: T2,
  fires: T2,
  autoBridge: T2,
  canBuild: T2,
  previewRentBatch: T2,
  validateTransport: T2,
  placeTransportDryRun: T2,
  unitAt: T2,
  transportAt: T2,
  pendingChoice: T2,
  bombSearch: T2,
  elevatorTelemetry: T2,
  housekeepingReport: T2,
  loopMemos: T2,
  // Tier 2, the panel getters (facade slice 6b): read-only answers for the
  // stats screen, HUD strip, inspector and editor cards, overlays and
  // onboarding checklist.
  towerStats: T2,
  statsReport: T2,
  housekeepingCoverage: T2,
  unitDetail: T2,
  transportDetail: T2,
  floorHeatmap: T2,
  peakCongestionHotspot: T2,
  onboardingFacts: T2,
  // Tier 2, the engine view (facade slice 6a): the layout, the structure
  // per revision, the metadata per meta revision and undo's signature.
  viewLayout: T2,
  viewStructure: T2,
  unitMetaSince: T2,
  towerSignature: T2,
  // Tier 2, the inspector's diagnostics facts (facade slice 6c).
  diagnosticFacts: T2,
  // Tier 2, the camera and the tower name a host with no TypeScript tower
  // reads once per engine (facade slice 7a).
  view: T2,
  towerName: T2,
  // Tier 1, the engine's own port (facade slice 7, the 2026-10-28 redesign):
  // numeric commands answering a result record. The editing commands are
  // named apart from the legacy exports the conformance suites still call.
  chooseAutoBridge: T1,
  answerChoice: T1,
  buildAt: T1,
  paintTiles: T1,
  setLobbyHeight: T1,
  buildShaft: T1,
  demolish: T1,
  demolishTile: T1,
  changeCars: T1,
  extendShaft: T1,
  bookExterminator: T1,
  setCamera: T1,
  setFilm: T1,
  changeFilm: T1,
  setTicketPrice: T1,
  markStop: T1,
  expressStops: T1,
  dropStops: T1,
  stepRent: T1,
  noRate: T1,
  setRent: T1,
  rentBatch: T1,
  rerollUnit: T1,
  flipAutoBridge: T1,
  startExtend: T1,
  stopExtend: T1,
  labelUnit: T1,
  nameTower: T1,
  // Tier 2, the port's reads: the refusal text, and the quotes and queries
  // the HUD and the build preview ask per UI tick or pointer move.
  lastReason: T2,
  quoteBuild: T2,
  lobbyHeights: T2,
  lobbyRise: T2,
  walkwayTop: T2,
  quoteShaft: T2,
  quoteRentBatch: T2,
  shaftSchedule: T2,
  autoTuneProposal: T2,
  scheduleFacts: T2,
  schedulePreset: T2,
  founder: T2,
  statsStrip: T2,
  hotspot: T2,
  onboarding: T2,
  evaluatedTower: T2,
  // Tier 2, the port's lifecycle, events, log and text getters (facade
  // slice 7, PR 1b): a swap per load, undo or new game, a drain per step,
  // and text read only for what changed.
  loadSave: T2,
  restore: T2,
  foundTower: T2,
  generation: T2,
  undoSignature: T2,
  // Tier 2, the engine's undo steps: a capture and a commit per edit gesture,
  // a step per undo or redo.
  undoCapture: T2,
  undoCommit: T2,
  undoDiscard: T2,
  undoClear: T2,
  undo: T2,
  redo: T2,
  undoNotice: T2,
  undoDepths: T2,
  drainEvents: T2,
  eventText: T2,
  setBackdrop: T2,
  unitMetaChanged: T2,
  unitLabel: T2,
  unitSubtype: T2,
  logAfter: T2,
  logText: T2,
  logLine: T1,
  scheduleShaft: T1,
  // Tier 2, the port's panel queries (facade slice 7, PR 1c): read-only
  // records for the heat overlay, the crew coverage and the unit and shaft
  // cards, in place of the slice 6b JSON getters.
  heatCells: T2,
  crewCoverage: T2,
  unitCard: T2,
  shaftCard: T2,
  // Tier 2, the rooms' evaluation and rent tiers the Map's Eval and Pricing
  // views read (#343 S7).
  roomTiers: T2,
  // Tier 2, the port's report queries and file members (facade slice 7, PR
  // 1d): the stats screen and diagnostics records in place of the JSON
  // getters, the .vctower and .TDT files in and out, and the staged .TDT
  // tower the import report shows before the player opens it.
  statsSheet: T2,
  unitFacts: T2,
  serviceDiagnostics: T2,
  loadVctower: T2,
  exportVctower: T2,
  loadTdt: T2,
  tdtNote: T2,
  tdtTowerName: T2,
  adoptTdt: T2,
  tdtExport: T2,
  tdtFile: T2,
  // Tier 2, the port's render queries (facade slice 7, PR 5b): what the
  // renderer reads beyond the view frame, per frame or per scene sync.
  congestion: T2,
  // A test and tooling read (one pass over the rooms), not a per-frame one.
  floorCongestion: T2,
  queueView: T2,
  parkingSet: T2,
  parkingUsage: T2,
  recyclingFill: T2,
  recyclingCapacity: T2,
  recyclingDemandMet: T2,
  positionReachable: T2,
  // Tier 2, the host loop and the engine's lifetime.
  tick: LOOP,
  advance: LOOP,
  frameView: LOOP,
  logSince: LOOP,
  drainGameplayEvents: LOOP,
  gameplayEventsPending: LOOP,
  gameplayEventsDropped: LOOP,
  commuteStress: LOOP,
  commuteStressRevision: LOOP,
  // The view's frame reader remembers what it last sent, so a second caller
  // would see only what moved since the host's read: the host's alone.
  viewFrame: LOOP,
  // The people window of that reader's frames: the host's camera, set each
  // frame before the read.
  setPeopleWindow: LOOP,
  free: LOOP,

  // The tooling harnesses' reads (src/game/toolingTower.ts, #1875 step 4): a
  // unit or a shaft as the save holds it, and the tower lookups a harness
  // builds and checks a tower with.
  unitRecord: T2,
  transportRecord: T2,
  roomAt: T2,
  structureKindAt: T2,
  floorHasLobby: T2,
  isFloorServed: T2,
  highestFloor: T2,

  // Tier 3: raw edit, test and seed ops.
  setMoney: T3,
  setCars: T3,
  resizeTransport: T3,
  removeUnit: T3,
  removeTransport: T3,
  startFire: T3,
  bombThreat: T3,
  evaluateStar: T3,
  setClock: T3,
  setUnitState: T3,
  setCustomersIn: T3,
  setWeather: T3,
  clearRetailTallies: T3,
  startFireAt: T3,
  vacateUnit: T3,
  setUnitRent: T3,
  advanceClock: T3,
  seedLoopMemos: T3,
  seedElevatorTelemetry: T3,
  // The tooling harnesses' bare placements (src/game/toolingTower.ts, #1875 step 4).
  placeBare: T3,
  placeTransportBare: T3,
} as const satisfies Record<BindingExport, TierEntry>;

/** The exports wasm-bindgen writes itself, which the Rust sources never name. */
export const GENERATED_EXPORTS: readonly BindingExport[] = ["free"];

/** The names in one tier, in table order. */
export function exportsInTier(tier: BindingTier): BindingExport[] {
  return (Object.keys(BINDING_EXPORT_TIERS) as BindingExport[]).filter((name) => BINDING_EXPORT_TIERS[name].tier === tier);
}
