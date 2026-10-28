import type * as Binding from "./engine";
import type { WasmEngine } from "./binding";

/**
 * Every export of the WASM binding (`engine-rs/src/wasm.rs`), sorted into a
 * tier (#946, cutover plan story S10, spine AD-3). One table, so a new export
 * has to pick a tier before it can ship: the typecheck fails on an export of
 * the declared package (`engine.d.ts`) missing here, and
 * `bindingExportTiers.guard.test.ts` parses `wasm.rs` and fails on an export
 * missing here or listed but gone.
 *
 * - **Tier 1, player commands.** What a player can do, with the engine's own
 *   rules and charges, plus the few host writes the game makes on a player's
 *   behalf (the tower's name, the camera, a log line). The only tier the UI
 *   and game code (`src/ui/`, `src/game/`, `src/render/`, everything outside
 *   the engine, the relay and the host) may reach. They reach it through the
 *   TypeScript instance, which the relay mirrors (`mirror.ts`).
 * - **Tier 2, restores and reads.** Constructors from a save or a seed,
 *   getters and views, and the save writers. Entries marked `hostLoop` drive,
 *   drain or free the running engine (`tick`, the frame and log reads, the
 *   event drain, wasm-bindgen's `free`) and belong to the host, the dual run
 *   and tests; the guard fails on a call elsewhere to one whose name the
 *   TypeScript side does not share, and on any import of the binding's
 *   declaration from outside that scope.
 * - **Tier 3, relay, test and seed ops.** Raw edits that skip the charge
 *   rules or the simulation layer (`setMoney`, `setCars`, `resizeTransport`,
 *   the bare tower edits), scripted events with no player trigger
 *   (`startFire`, `bombThreat`, `evaluateStar`), and the seeding calls the
 *   tooling uses. They exist so the dual-run relay can replay the TypeScript
 *   instance's edits. The guard fails on a call to one outside the relay,
 *   the host, the TypeScript engine itself, the tooling and tests, including
 *   the TypeScript-side writes the relay would turn into one: an assignment
 *   to `sim.money`, `tower.setCars` and `tower.resizeTransport`.
 *
 * Tier 3 leaves the production binding, or moves behind a cargo feature,
 * when the TypeScript engine retires (#1057). Argument validation at the
 * boundary is #923's.
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
  // Tier 2, the host loop and the engine's lifetime.
  tick: LOOP,
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
  free: LOOP,

  // Tier 3: relay, test and seed ops.
  setMoney: T3,
  setCars: T3,
  resizeTransport: T3,
  towerSetCars: T3,
  towerResizeTransport: T3,
  removeUnit: T3,
  removeTransport: T3,
  startFire: T3,
  bombThreat: T3,
  evaluateStar: T3,
  advanceClock: T3,
  seedLoopMemos: T3,
  seedElevatorTelemetry: T3,
} as const satisfies Record<BindingExport, TierEntry>;

/** The exports wasm-bindgen writes itself, which `wasm.rs` never names. */
export const GENERATED_EXPORTS: readonly BindingExport[] = ["free"];

/** The names in one tier, in table order. */
export function exportsInTier(tier: BindingTier): BindingExport[] {
  return (Object.keys(BINDING_EXPORT_TIERS) as BindingExport[]).filter((name) => BINDING_EXPORT_TIERS[name].tier === tier);
}
