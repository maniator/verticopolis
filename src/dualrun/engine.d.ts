/* tslint:disable */
/* eslint-disable */

/**
 * One running simulation. Construct with `newGame`, `fromSave` or
 * `fromVctower`; drive it with the command methods; read it back with
 * `serialize` and the two hashed views.
 */
export class Engine {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * `addCar(id)`: JSON `{ ok, reason?, delta }`; the engine checks the car
     * limit and the balance and pays for the car itself. The id is typed
     * `number` but read raw (#923): anything but a whole JS number within
     * `Number.isSafeInteger` is refused with `INVALID_REQUEST`, never coerced.
     */
    addCar(id: number): string;
    /**
     * `adjustRent(id, dir)`: the new rent, or null when nothing moved. Read
     * raw (#996): an id that is not a whole JS number within
     * `Number.isSafeInteger`, or a `dir` that is not exactly 1 or -1, is
     * refused with null.
     */
    adjustRent(id: number, dir: number): number | undefined;
    adoptTdt(): Float64Array;
    /**
     * Move the clock by `minutes` and run nothing: the TypeScript
     * `clock.advance(minutes)`. Whatever pass the move skips is owed and runs
     * on the next tick, as on the TypeScript engine. Tooling only (the
     * gallery's clock pin); no game command reaches it.
     */
    advanceClock(minutes: number): void;
    advance(owed: number, dt_ms: number, minutes_per_second: number, steady_clock: boolean, step: boolean): Float64Array;
    answerChoice(accept: boolean): Float64Array;
    /**
     * `applyRentBatch(kind, target, onlyDefaultPriced)` with the target as
     * JSON text (a number, `"default"` or `"noRate"`): the result counters
     * as JSON, or null when the batch does not apply: an unknown or unpriced
     * kind, a No Rate target off the ladder, or a target that is not
     * `"default"`, `"noRate"` or a finite number, as in TypeScript.
     */
    applyRentBatch(kind: string, target: string, only_default_priced: boolean): string | undefined;
    /**
     * `sim.autoBridge`.
     */
    autoBridge(): boolean;
    /**
     * The Auto-tune proposal for a shaft (`wasm_port_life.rs`): a keyed
     * object, read-only. `draft` is the dialog's working schedule in
     * `scheduleShaft`'s slots, or empty for none.
     */
    autoTuneProposal(id: number, draft: Float64Array, weekend_view: boolean): any;
    /**
     * `beginExtend(id)`: open an extend gesture on an elevator (#990), its
     * high-water mark starting at the shaft's span; any open gesture is
     * dropped first. False, with no gesture open, when `id` is not a whole
     * JS number or names no elevator. The id is read raw, as for `addCar`.
     */
    beginExtend(id: number): boolean;
    /**
     * Classic's bomb search while one runs, as JSON `{ deadline, sweeping,
     * searched, seq }` (`sweeping` holds `{ floor, left, right }` for each
     * floor a guard is on, `searched` the floors already clear), or null. The bomb's hiding place stays out. A host reads it
     * when the frame's `bombSearchSeq` moves.
     */
    bombSearch(): string | undefined;
    /**
     * Tooling: a bomb threat, outside an open gesture as a fire is.
     */
    bombThreat(): void;
    bookExterminator(): Float64Array;
    buildAt(kind: number, floor: number, x: number): Float64Array;
    buildShaft(kind: number, x: number, bottom: number, top: number): Float64Array;
    /**
     * `buildTransport(kind, x, bottom, top)`: JSON `{ ok, reason? }`. An
     * unknown kind is refused with "Unknown facility.".
     */
    buildTransport(kind: string, x: number, bottom: number, top: number): string;
    /**
     * `build(kind, floor, x)`: JSON `{ ok, reason? }`. An unknown kind is
     * refused with "Unknown facility.", as TypeScript's `build` does.
     */
    build(kind: string, floor: number, x: number): string;
    /**
     * `callExterminator()`: JSON `{ ok, reason?, cost?, rooms? }`, the
     * TypeScript `ExterminatorResult`: `cost` and `rooms` ride on a booking
     * and on the "funds" refusal, the other refusals carry the reason alone.
     */
    callExterminator(): string;
    /**
     * `canBuild(kind, floor, x)`: JSON `{ ok, reason?, cost }`, the dry run
     * `build` makes first. When the placement fits, `cost` is its full
     * price: the facility (a lobby tile where there is no floor yet with
     * that floor), the floor tiles laid under a room, and the tiles
     * bridged to the tower when bridging is on; a "Not enough money."
     * refusal carries that same full price. Any other refusal (placement or
     * star gate) carries the reason `build` would give and the facility's
     * base price. An unknown kind answers the way TypeScript does, with
     * "Unknown facility." and a cost of 0.
     */
    canBuild(kind: string, floor: number, x: number): string;
    changeCars(id: number, add: boolean): Float64Array;
    chooseAutoBridge(value: boolean): Float64Array;
    /**
     * Tooling only: clear every unit's four retail tallies (patronage and
     * profit, today and yesterday), the render-only fields no economy path
     * reads, so a test can show that clearing them changes no money.
     */
    clearRetailTallies(): void;
    clearStops(id: number): boolean;
    /**
     * Changes whenever a completed trip contributes a commute sample.
     */
    commuteStressRevision(): number;
    /**
     * `crowd.commuteStressByFloor`: the per-origin-floor commute-stress
     * average as JSON `[[floor, seconds], ...]`, by floor. No save carries
     * it; it rebuilds as trips finish, as on the TypeScript engine.
     */
    commuteStress(): string;
    congestion(): number;
    crewCoverage(): Float64Array;
    /**
     * The crowd view's hash, as the lock records it.
     */
    crowdDigest(): string;
    /**
     * The hashed crowd view (people, id source, rng), as canonical JSON.
     */
    crowdView(): string;
    demolishTile(floor: number, x: number, bulldoze: boolean): Float64Array;
    demolish(id: number, bulldoze: boolean): Float64Array;
    /**
     * The facts behind the inspector's diagnostics for one unit, as JSON
     * text (`diagnostics::DiagnosticFacts`); TypeScript keeps the wording.
     * Undefined for an id that names no unit (a transport's, zero or a
     * negative one) and for a malformed one (fractional, not finite, past
     * the safe integers), read raw so it cannot wrap onto a real unit.
     * The read may fill the engine's caches, which sit outside the save; it
     * changes nothing in the game.
     */
    diagnosticFacts(id: number): string | undefined;
    drainEvents(): Float64Array;
    /**
     * The gameplay events emitted since the last drain, oldest first, as
     * JSON `[{ name, payload }]` (`conformance/events/catalog.json`); the
     * buffer is empty afterwards.
     */
    drainGameplayEvents(): string;
    dropStops(id: number): Float64Array;
    /**
     * The hourly elevator telemetry (`elevatorUtil`, `elevatorHourly`,
     * `elevatorOrigins`) as JSON; see `Simulation::telemetry_json`.
     */
    elevatorTelemetry(): string;
    /**
     * `sim.emit(text, kind)`: a log entry at the engine's clock.
     */
    emit(text: string, kind: string): void;
    /**
     * `endExtend()`: close the open extend gesture, if any.
     */
    endExtend(): void;
    evaluateStar(): void;
    evaluatedTower(): boolean;
    eventText(i: number): string | undefined;
    exportVctower(app_version: string, saved_at_ms: number): string | undefined;
    expressStops(id: number): Float64Array;
    extendShaft(id: number, up: boolean, target_floor: number): Float64Array;
    /**
     * `extendTransport(id, end, targetFloor)`: JSON `{ ok, reason?, delta,
     * bottom, top, added }`, the floors billed past the high-water mark: the
     * open gesture's when `beginExtend` opened one on this shaft, the
     * shaft's span otherwise. Every argument is read raw (#923): an id or
     * floor that is not a whole JS number, or an `end` that is not exactly
     * `"up"` or `"down"`, is refused with `INVALID_REQUEST` and the shaft's
     * ends as they stand.
     */
    extendTransport(id: number, end: "up" | "down", target_floor: number): string;
    /**
     * The number of units on fire.
     */
    fires(): number;
    flipAutoBridge(): Float64Array;
    /**
     * The raw congestion ratio of one floor (0 for a floor with no reading
     * or one that is not a whole number): the value `hotspot` takes its peak
     * from.
     */
    floorCongestion(floor: number): number;
    /**
     * `floorHeatmap(mode)`'s cells as JSON; a mode that is not one of the
     * four overlays is an error.
     */
    floorHeatmap(mode: string): string;
    foundTower(seed: number, mode: number, calendar: number, unbridged: boolean): Float64Array;
    founder(): boolean;
    /**
     * The per-frame read model as one flat number array (see
     * `frame_view` for the layout): what the host reads every frame while
     * the engine runs the simulation.
     */
    frameView(): Float64Array;
    /**
     * `Simulation.deserialize(JSON.parse(text))`: a serialized game, migrated
     * and loaded, with a lone surrogate escape read as U+FFFD
     * (`load::parse_save_json`). Nothing else the import path does (the
     * founder mark) runs.
     * `markers`, when given, is JSON `{ lastHour, lastDay, lastQuarter,
     * lastMonth, extendGesture?, commuteStress? }`: the live engine's
     * boundary markers, open extend gesture `{ id, bottom, top }` (#990) and
     * commute-stress rows (#1083), which a save does not carry (a load
     * rebuilds the markers from the clock, a founded game keeps them unset
     * until the first boundary, and a load has no gesture and no averages),
     * so a shadow can start exactly where the live engine stands.
     */
    static fromSave(text: string, markers?: string | null): Engine;
    /**
     * The import path for a `.vctower` file: decode, migrate and load, then
     * mark a save from before 2.0 as a founder's tower. `mode`, when given,
     * overwrites the save's mode before loading, as a scenario start does.
     */
    static fromVctower(text: string, mode?: string | null): Engine;
    /**
     * How many gameplay events a full buffer has pushed out since this
     * engine was made (a host that drains every frame never sees one).
     */
    gameplayEventsDropped(): number;
    /**
     * How many gameplay events wait for the next drain. A host reads it
     * before draining, so a batch whose text it cannot read is counted as
     * lost (the drain empties the buffer either way).
     */
    gameplayEventsPending(): number;
    generation(): number;
    heatCells(mode: number): Float64Array;
    hotspot(): Float64Array;
    /**
     * `housekeepingCoverage()`, as JSON.
     */
    housekeepingCoverage(): string;
    /**
     * `economy.housekeepingReport()`: yesterday's shift result as JSON
     * `{ cleaned, leftover }`, or nothing (`undefined`) before the first
     * morning checkout.
     */
    housekeepingReport(): string | undefined;
    labelUnit(id: number, text: string): Float64Array;
    lastReason(): string | undefined;
    loadSave(text: string): Float64Array;
    loadTdt(bytes: Uint8Array, filename: string): Float64Array;
    loadVctower(text: string): Float64Array;
    logAfter(seq: number): Float64Array;
    logLine(text: string, kind: number): Float64Array;
    /**
     * The log entries emitted after `seq` (the `logSeq` the host last saw),
     * oldest first, as JSON `[{ seq, minute, text, kind }]`. The engine keeps
     * a ring of the last entries, so a host that falls further behind than
     * the ring gets the ring.
     */
    logSince(seq: number): string;
    logText(seq: number): string | undefined;
    /**
     * The loop's pass memos as `[lastHour, lastDay, lastMonth, lastQuarter]`,
     * the counterpart of `seedLoopMemos`. Tooling only: the gallery's handoff
     * carries a hosted tower's owed passes across the load that restarts it.
     */
    loopMemos(): Float64Array;
    markStop(id: number, floor: number, stop: boolean): Float64Array;
    mode(): string;
    money(): number;
    nameTower(text?: string | null): Float64Array;
    /**
     * `Simulation.newGame(seed, mode, modernCalendar, startUnbridged)`; the
     * calendar defaults to the real-world one and the tower starts bridged,
     * as the TypeScript defaults do.
     */
    static newGame(seed: number, mode: string, modern_calendar?: string | null, start_unbridged?: boolean | null): Engine;
    noRate(id: number): Float64Array;
    /**
     * The five onboarding facts as JSON.
     */
    onboardingFacts(): string;
    onboarding(): number;
    /**
     * `paintBrush(kind, floor, tiles)` with the tiles as JSON text: JSON
     * `{ placed, reason? }`, the floor and lobby brush (`brush.rs`) in one
     * call. Every argument is read raw, so a malformed brush is refused
     * with "That request is not valid." as TypeScript refuses it.
     */
    paintBrush(kind: string, floor: number, tiles: string): string;
    paintTiles(kind: number, floor: number, tiles: Float64Array): Float64Array;
    parkingSet(): Float64Array;
    parkingUsage(spots: number): number;
    /**
     * `peakCongestionHotspot()`: `{ ratio, floor }` as JSON.
     */
    peakCongestionHotspot(): string;
    /**
     * The pending player choice as JSON `{ kind, cost, message }`, or null.
     */
    pendingChoice(): string | undefined;
    /**
     * `tower.placeTransportDryRun(kind, x, bottom, top)`: whether
     * `validateTransport` accepts the shaft, read the same way.
     */
    placeTransportDryRun(kind: string, x: number, bottom: number, top: number): boolean;
    positionReachable(floor: number, x: number): boolean;
    /**
     * `previewRentBatch(kind, target, onlyDefaultPriced)` with the target as
     * JSON text, as for `applyRentBatch`: the counters that call would
     * report, as JSON, with nothing written; null where it would not apply.
     * A kind that is not a string is an unknown kind, and the flag is read
     * by JavaScript truthiness, as TypeScript's `opts.onlyDefaultPriced` is.
     */
    previewRentBatch(kind: string, target: string, only_default_priced: boolean): string | undefined;
    /**
     * `priceUnit(u, target)`: the new price, or null when not repriceable.
     */
    priceUnit(id: number, target: number): number | undefined;
    queueView(): Float64Array;
    quoteBuild(kind: number, floor: number, x: number): Float64Array;
    quoteRentBatch(kind: number, target: number, only_default: boolean): Float64Array;
    quoteShaft(kind: number, x: number, bottom: number, top: number): Float64Array;
    recyclingCapacity(): number;
    recyclingDemandMet(): boolean;
    recyclingFill(): number;
    redo(): Float64Array;
    /**
     * `removeCar(id)`: JSON `{ ok, reason?, delta }` with the half-back refund.
     * The id is read raw, as for `addCar` (#923).
     */
    removeCar(id: number): string;
    /**
     * `removeFacility(id, method)`: the player's sell or bulldoze of a unit
     * or shaft by id, paying the refund. JSON `{ ok, reason?, delta }`. Read
     * raw (#923): an id that is not a whole JS number or a method that is not
     * exactly `"sell"` or `"bulldoze"` is refused with `INVALID_REQUEST`.
     */
    removeFacility(id: number, method: "sell" | "bulldoze"): string;
    /**
     * `tower.removeTransport(id)`: whether a shaft went.
     */
    removeTransport(id: number): boolean;
    /**
     * `tower.removeUnit(id)`: whether a unit went.
     */
    removeUnit(id: number): boolean;
    rentBatch(kind: number, target: number, only_default: boolean): Float64Array;
    /**
     * `rerollSubtype(id)`: the new subtype, or null.
     */
    rerollSubtype(id: number): string | undefined;
    rerollUnit(id: number): Float64Array;
    /**
     * `resizeTransport(id, bottom, top)`, the simulation-layer edit that
     * reports `capacity_changed`: JSON `{ ok: true, added,
     * floorTilesCreated }` or `{ ok: false, reason }`. Read raw (#996): an
     * id or floor that is not a whole JS number within
     * `Number.isSafeInteger` is refused with `INVALID_REQUEST`.
     */
    resizeTransport(id: number, bottom: number, top: number): string;
    /**
     * `resolveChoice(accept ? "accept" : "decline")`.
     */
    resolveChoice(accept: boolean): void;
    restore(text: string): Float64Array;
    /**
     * The Map's Eval and Pricing read (#343 S7): one `roomTier` row (`id`,
     * `floor`, `x`, `evalTier`, `rentTier`) for each room that carries an
     * evaluation or a rent level, in the view's room order, with codes from
     * the layout's `evalTiers` and `rentTiers`. One pass over the rooms, so
     * S8 reads it only on the triggers the Map SPEC lists (the Cost bullet of
     * its S7 section), and not more than once a frame.
     */
    roomTiers(): Float64Array;
    /**
     * What moved in the save since the last sync: `{ units, rest }` as JSON
     * text (the changed unit records, and every other top-level key).
     * `undefined` when units were added, removed or reordered, or no full
     * save was taken yet: the host then takes a full one.
     */
    saveDelta(): string | undefined;
    /**
     * The advice and staging facts for a shaft (`wasm_port_life.rs`): a
     * keyed object, read-only. `draft` is the dialog's working schedule in
     * `scheduleShaft`'s slots, or empty for none.
     */
    scheduleFacts(id: number, draft: Float64Array, weekend_view: boolean): any;
    /**
     * The rows and homes a named preset (`rush`, `balanced`, `feeder` or
     * `stage-up-tower`) sets for a shaft (`wasm_port_life.rs`): a keyed
     * object, read-only.
     */
    schedulePreset(id: number, preset: string): any;
    scheduleShaft(id: number, slots: Float64Array): Float64Array;
    /**
     * Replace the elevator telemetry with an `elevatorTelemetry` document.
     * Tooling only (the gallery's engine leg); no game command reaches it.
     */
    seedElevatorTelemetry(json: string): void;
    /**
     * Set the loop's pass memos (`lastHour`, `lastDay`, `lastMonth`,
     * `lastQuarter`), which a load derives from the clock. Tooling only: the
     * gallery's engine leg hands over a tower built in place, whose memos
     * still owe its first passes, and this keeps them owed.
     */
    seedLoopMemos(last_hour: number, last_day: number, last_month: number, last_quarter: number): void;
    /**
     * `sellAt(floor, x)`: whether a facility went. Read raw (#996): a floor
     * or column that is not a whole JS number within `Number.isSafeInteger`
     * is refused with `false`, never coerced.
     */
    sellAt(floor: number, x: number): boolean;
    /**
     * `serialize()`, byte for byte, which also becomes the base the next
     * `saveDelta` is taken against (#1045, `crate::save_delta`).
     */
    serializeForSync(): string;
    /**
     * `serialize()` as JSON text.
     */
    serialize(): string;
    serviceDiagnostics(id: number): any;
    /**
     * `sim.autoBridge = value`, the direct write an undo restore makes.
     */
    setAutoBridge(value: boolean): void;
    setBackdrop(on: boolean): void;
    setCamera(tile: number, floor: number, zoom: number): Float64Array;
    /**
     * `setCars(id, cars)`: the simulation-layer edit, which reports
     * `capacity_changed`. Read raw (#996): an id or count that is not a
     * whole JS number within `Number.isSafeInteger` is refused with `false`.
     */
    setCars(id: number, cars: number): boolean;
    /**
     * Tooling only: put the clock at `minutes`, forward or back, and run
     * nothing: the TypeScript `sim.clock = new Clock(minutes, calendar)`
     * that tests use to pin an hour once the crowd exists. The loop's pass
     * memos stay as they are, as with `advanceClock`, so a pass the move
     * skips runs once on the next tick. A literal 0 is 07:00 on day 0, as at
     * founding. False, changing nothing, for a value that is not finite, is
     * below 0 or is past [`MAX_TOOL_CLOCK_MINUTES`].
     */
    setClock(minutes: number): boolean;
    /**
     * Tooling only: set a unit's live customer tally (`customersIn`), which
     * no save carries, so a test can fill a venue to capacity mid-run, with
     * the follow-ups a counted arrival makes (an attendance venue's occupants
     * mirror, the meal overlay revision). False for an unknown unit or a
     * count that is not a whole number from 0 to [`MAX_TOOL_OCCUPANTS`];
     * nothing changes then. The unit's kind and its venue cap are not
     * checked: any unit takes the stamp, at any count in that range.
     */
    setCustomersIn(id: number, count: number): boolean;
    /**
     * `setExpressStops(id)`: whether the id names a shaft, as TypeScript's
     * answers; a shaft's stops are rebuilt, an unknown id changes nothing.
     */
    setExpressStops(id: number): boolean;
    /**
     * `setFilmPolicy(id, policy)`: the policy stored, or null.
     */
    setFilmPolicy(id: number, policy: string): string | undefined;
    setFilm(id: number, policy: number): Float64Array;
    /**
     * The editor's rename of a unit.
     */
    setLabel(id: number, label: string): boolean;
    setMoney(amount: number): void;
    /**
     * `setNoRate(id)`: whether the unit is now off the market. The id is
     * read raw (#996), as for `sellAt`.
     */
    setNoRate(id: number): boolean;
    setRent(id: number, target: number): Float64Array;
    /**
     * `Tower.setSchedule(id, schedule)` with the schedule as JSON text. The
     * id is read raw (#996): one that is not a whole JS number within
     * `Number.isSafeInteger` is refused with `false` before the text is read.
     */
    setSchedule(id: number, schedule: string): boolean;
    /**
     * `tower.setStop(id, floor, stop)`: whether the stop is set. Read raw
     * (#996): an id or floor that is not a whole JS number within
     * `Number.isSafeInteger`, or a `stop` that is not a JS boolean, is
     * refused with `false`.
     */
    setStop(id: number, floor: number, stop: boolean): boolean;
    /**
     * `tower.towerName = name`; null clears it, as the host's `undefined`
     * leaves the key out of the save.
     */
    setTowerName(name?: string | null): void;
    /**
     * Tooling only: write unit `id`'s price as given, with no ladder snap
     * or band clamp, or clear it with null, the TypeScript `u.rent = value`.
     * A test uses it for a legacy off-ladder price or an unpriced room,
     * which a load would snap onto the ladder. False, changing nothing, for
     * an unknown unit or a price that is not finite or is below 0.
     */
    setUnitRent(id: number, rent?: number | null): boolean;
    /**
     * Tooling only: set a unit's state by its save name, and its occupants
     * when given (a test holds a venue open or a condo full). False for an
     * unknown unit or state, for "construction" and "fire" (each needs its
     * own timer or event record, which this write cannot make), or for
     * occupants that are not a whole number from 0 to
     * [`MAX_TOOL_OCCUPANTS`]; nothing changes then.
     */
    setUnitState(id: number, state: string, occupants?: number | null): boolean;
    /**
     * `sim.view = view`, the camera a save carries, as JSON text (null clears).
     */
    setView(view?: string | null): void;
    /**
     * Tooling only: set today's weather by its save name ("clear",
     * "cloudy" or "rain"), the TypeScript `sim.weather = w`. No save carries
     * it, and the next day's roll replaces it. False, changing nothing, for
     * any other name.
     */
    setWeather(name: string): boolean;
    shaftCard(id: number): Float64Array;
    shaftSchedule(id: number): Float64Array;
    startExtend(id: number): Float64Array;
    /**
     * Tooling only: the daily roll's fire outbreak in room `id`, with the
     * paid-rescue offer it raises, so a test can set a chosen room ablaze
     * mid-run (`startFire` picks a room at random and offers nothing). It
     * draws nothing from the random stream. False, changing nothing, while
     * a fire burns or a choice is pending, or when `id` names no room that
     * can catch fire. Like `startFire`, this is not part of an open undo step.
     */
    startFireAt(id: number): boolean;
    /**
     * Tooling: a fire, which is no edit, so it is no part of an open
     * gesture's undo step.
     */
    startFire(): void;
    /**
     * The state view's hash, as the lock records it.
     */
    stateDigest(): string;
    /**
     * The hashed state view: the saved game minus prose, as canonical JSON.
     */
    stateView(): string;
    /**
     * Everything the stats screen reads beyond `stats()`, as JSON.
     */
    statsReport(): string;
    statsSheet(): Float64Array;
    statsStrip(): Float64Array;
    stepRent(id: number, dir: number): Float64Array;
    stopExtend(): Float64Array;
    tdtExport(): Float64Array;
    tdtFile(): Uint8Array | undefined;
    tdtNote(i: number): string | undefined;
    tdtTowerName(): string | undefined;
    tick(dt_minutes: number): void;
    /**
     * `toggleAutoBridge()`: the preference after the flip.
     */
    toggleAutoBridge(): boolean;
    /**
     * The tower's name, or undefined when it has none (the save then leaves
     * the key out). Read on a new engine; `setTowerName` is how it changes.
     */
    towerName(): string | undefined;
    towerSignature(): bigint;
    /**
     * `stats()`: the HUD strip's counters, as JSON.
     */
    towerStats(): string;
    /**
     * The shaft covering a tile, serialized as the save would, or null.
     */
    transportAt(floor: number, x: number): string | undefined;
    /**
     * The transport inspector and editor card for shaft `id`, as JSON, or null.
     */
    transportDetail(id: number): string | undefined;
    undoCapture(label: string): void;
    undoClear(): void;
    undoCommit(): boolean;
    undoDepths(): Float64Array;
    undoDiscard(): void;
    undoNotice(): string | undefined;
    undoSignature(): string;
    undo(): Float64Array;
    /**
     * The unit covering a tile, serialized as the save would, or null.
     */
    unitAt(floor: number, x: number): string | undefined;
    unitCard(id: number): Float64Array;
    /**
     * The unit inspector and editor card for unit `id`, as JSON, or null.
     */
    unitDetail(id: number): string | undefined;
    unitFacts(id: number): Float64Array;
    unitLabel(id: number): string | undefined;
    unitMetaChanged(since: number): Float64Array;
    unitMetaSince(since: number): string;
    unitSubtype(id: number): string | undefined;
    /**
     * Tooling only: a tenant leaves unit `id` for `reason` (a departure
     * cause's save name), the TypeScript `sim.vacate(u, reason)`, so a test
     * can empty a chosen room mid-run. It is the churn pass's departure, so
     * a sold condo is bought back. Like a fire, it is not part of an open
     * undo step. The unit's kind is not checked. False, changing nothing,
     * for an unknown unit or cause.
     */
    vacateUnit(id: number, reason: string): boolean;
    /**
     * `tower.validateTransport(kind, x, bottom, top)`: JSON `{ ok, reason? }`,
     * nothing written. An unknown kind is refused with "Unknown facility."; a
     * coordinate that is not a whole JS number within `Number.isSafeInteger`
     * is refused with `INVALID_REQUEST`, never coerced (#923).
     */
    validateTransport(kind: string, x: number, bottom: number, top: number): string;
    viewFrame(full: boolean): Float64Array;
    viewLayout(): string;
    viewStructure(): Float64Array;
    /**
     * The camera the save carries, as JSON text, or undefined when there is
     * none. Read on a new engine; `setView` is how it changes.
     */
    view(): string | undefined;
}

/**
 * Every price, size and build rule a frontend shows, resolved for `mode`
 * (`classic` or `modern`), as canonical JSON in the shape of the `Catalog`
 * type (declared in `src/engine/catalogTypes.ts`, read through `readCatalog`
 * in `src/dualrun/catalog.ts`; see `verticopolis_engine::catalog`). It needs
 * no running game.
 */
export function catalog(mode: string): string;

/**
 * `encodeVctower(saveJson, appVersion, savedAtMs)`: the `.vctower` file
 * text for a serialized game (what `serialize` returns), stamped the way
 * `SaveGame.export` stamps it (`load::stamp_save`). Text that is not JSON,
 * a save that is not a tower, a time no `Date` holds, a build name that
 * reads as before 2.0 (which would mark the tower as a founder's) and a
 * save whose JSON passes 32 MiB (more than a reader will hold) are
 * JavaScript errors. A lone surrogate escape reads as U+FFFD
 * (`load::parse_save_json`).
 */
export function encodeVctower(save_json: string, app_version: string, saved_at_ms: number): string;

/**
 * Which engine this is and which contracts it speaks, as canonical JSON in
 * the shape of `verticopolis_engine::identity::identity`: the record's
 * schema, the crate's name and version, the save version it writes and the
 * oldest it loads, the frame layout version, the catalog version with each
 * mode's digest, and the conformance lock digest. It needs no running game
 * and holds no build hash: a hash of the sources cannot be compiled into
 * them, so the served package's `BUILD.json` records it.
 */
export function engineIdentity(): string;

/**
 * `exportTdt(saveJson)`: the `.TDT` bytes for a serialized game (what
 * `serialize` returns). A tower the format cannot hold is a JavaScript error
 * with the player-readable message.
 */
export function exportTdt(save_json: string): Uint8Array;

/**
 * `importTdt(bytes, filename)`: a 1994 `.TDT` file as JSON text
 * `{ "save": <serialized game>, "warnings": [...] }`, where `save` is what
 * `fromSave` takes. A file that cannot be read is a JavaScript error with
 * the player-readable message.
 */
export function importTdt(bytes: Uint8Array, filename: string): string;
