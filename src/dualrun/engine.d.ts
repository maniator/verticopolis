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
    /**
     * Move the clock by `minutes` and run nothing: the TypeScript
     * `clock.advance(minutes)`. Whatever pass the move skips is owed and runs
     * on the next tick, as on the TypeScript engine. Tooling only (the
     * gallery's clock pin); no game command reaches it.
     */
    advanceClock(minutes: number): void;
    /**
     * `applyRentBatch(kind, target, onlyDefaultPriced)` with the target as
     * JSON text (a number, `"default"` or `"noRate"`): the result counters
     * as JSON, or null when the batch does not apply.
     */
    applyRentBatch(kind: string, target: string, only_default_priced: boolean): string | undefined;
    /**
     * `sim.autoBridge`.
     */
    autoBridge(): boolean;
    /**
     * `beginExtend(id)`: open an extend gesture on an elevator (#990), its
     * high-water mark starting at the shaft's span; any open gesture is
     * dropped first. False, with no gesture open, when `id` is not a whole
     * JS number or names no elevator. The id is read raw, as for `addCar`.
     */
    beginExtend(id: number): boolean;
    bombThreat(): void;
    /**
     * `buildTransport(kind, x, bottom, top)`: JSON `{ ok, reason? }`.
     */
    buildTransport(kind: string, x: number, bottom: number, top: number): string;
    /**
     * `build(kind, floor, x)`: JSON `{ ok, reason? }`.
     */
    build(kind: string, floor: number, x: number): string;
    /**
     * `callExterminator()`: JSON `{ ok, reason? }`.
     */
    callExterminator(): string;
    /**
     * `canBuild(kind, floor, x)`: JSON `{ ok, reason?, cost }`, the dry run
     * `build` makes first. When the placement fits, `cost` is its full
     * price: the facility, the floor tiles laid under a room, and the tiles
     * bridged to the tower when bridging is on; a "Not enough money."
     * refusal carries that same full price. Any other refusal (placement or
     * star gate) carries the reason `build` would give and the facility's
     * base price. An unknown kind answers the way TypeScript does, with
     * "Unknown facility." and a cost of 0.
     */
    canBuild(kind: string, floor: number, x: number): string;
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
    /**
     * The crowd view's hash, as the lock records it.
     */
    crowdDigest(): string;
    /**
     * The hashed crowd view (people, id source, rng), as canonical JSON.
     */
    crowdView(): string;
    /**
     * The gameplay events emitted since the last drain, oldest first, as
     * JSON `[{ name, payload }]` (`conformance/events/catalog.json`); the
     * buffer is empty afterwards.
     */
    drainGameplayEvents(): string;
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
    /**
     * `economy.housekeepingReport()`: yesterday's shift result as JSON
     * `{ cleaned, leftover }`, or nothing (`undefined`) before the first
     * morning checkout.
     */
    housekeepingReport(): string | undefined;
    /**
     * The log entries emitted after `seq` (the `logSeq` the host last saw),
     * oldest first, as JSON `[{ seq, minute, text, kind }]`. The engine keeps
     * a ring of the last entries, so a host that falls further behind than
     * the ring gets the ring.
     */
    logSince(seq: number): string;
    /**
     * The loop's pass memos as `[lastHour, lastDay, lastMonth, lastQuarter]`,
     * the counterpart of `seedLoopMemos`. Tooling only: the gallery's handoff
     * carries a hosted tower's owed passes across the load that restarts it.
     */
    loopMemos(): Float64Array;
    mode(): string;
    money(): number;
    /**
     * `Simulation.newGame(seed, mode, modernCalendar, startUnbridged)`; the
     * calendar defaults to the real-world one and the tower starts bridged,
     * as the TypeScript defaults do.
     */
    static newGame(seed: number, mode: string, modern_calendar?: string | null, start_unbridged?: boolean | null): Engine;
    /**
     * The pending player choice as JSON `{ kind, cost, message }`, or null.
     */
    pendingChoice(): string | undefined;
    /**
     * `priceUnit(u, target)`: the new price, or null when not repriceable.
     */
    priceUnit(id: number, target: number): number | undefined;
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
    /**
     * `rerollSubtype(id)`: the new subtype, or null.
     */
    rerollSubtype(id: number): string | undefined;
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
     * `serialize()` as JSON text, printed the way `JSON.stringify` prints the
     * TypeScript engine's save (an integer-valued double without `.0`).
     */
    serialize(): string;
    /**
     * `sim.autoBridge = value`, the direct write an undo restore makes.
     */
    setAutoBridge(value: boolean): void;
    /**
     * `setCars(id, cars)`: the simulation-layer edit, which reports
     * `capacity_changed`. Read raw (#996): an id or count that is not a
     * whole JS number within `Number.isSafeInteger` is refused with `false`.
     */
    setCars(id: number, cars: number): boolean;
    setExpressStops(id: number): void;
    /**
     * `setFilmPolicy(id, policy)`: the policy stored, or null.
     */
    setFilmPolicy(id: number, policy: string): string | undefined;
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
     * `sim.view = view`, the camera a save carries, as JSON text (null clears).
     */
    setView(view?: string | null): void;
    startFire(): void;
    /**
     * The state view's hash, as the lock records it.
     */
    stateDigest(): string;
    /**
     * The hashed state view: the saved game minus prose, as canonical JSON.
     */
    stateView(): string;
    tick(dt_minutes: number): void;
    /**
     * `toggleAutoBridge()`: the preference after the flip.
     */
    toggleAutoBridge(): boolean;
    /**
     * `tower.resizeTransport(id, bottom, top)`, the bare tower edit, silent
     * in both engines (#906): the same JSON, read raw the same way (#996).
     * Relay-only, as `towerSetCars`.
     */
    towerResizeTransport(id: number, bottom: number, top: number): string;
    /**
     * `tower.setCars(id, cars)`: the bare tower edit, silent in both
     * engines (#906). Relay-only: the dual-run mirror replays a bare
     * TypeScript tower edit with it. Player and UI edits use the charge commands
     * (`addCar`, `removeCar`, `extendTransport`), and
     * `towerRelayOps.guard.test.ts` keeps other callers out. Read raw
     * (#996), as `setCars`.
     */
    towerSetCars(id: number, cars: number): boolean;
    /**
     * The shaft covering a tile, serialized as the save would, or null.
     */
    transportAt(floor: number, x: number): string | undefined;
    /**
     * The unit covering a tile, serialized as the save would, or null.
     */
    unitAt(floor: number, x: number): string | undefined;
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
