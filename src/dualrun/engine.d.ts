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
     * limit and the balance and pays for the car itself.
     */
    addCar(id: number): string;
    /**
     * `adjustRent(id, dir)`: the new rent, or null when nothing moved.
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
    evaluateStar(): void;
    /**
     * `extendTransport(id, end, targetFloor, hwm?)` with the high-water mark
     * as JSON `{ bottom, top }` text or null: JSON `{ ok, reason?, delta,
     * bottom, top, added }`, the floors billed past the mark. A malformed
     * argument (#923) is refused with the shaft's ends as they stand.
     */
    extendTransport(id: number, end: string, target_floor: number, hwm?: string | null): string;
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
     * lastMonth }`: the live engine's boundary markers, which a save does
     * not carry (a load rebuilds them from the clock, a founded game keeps
     * them unset until the first boundary), so a shadow can start exactly
     * where the live engine stands.
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
     */
    removeCar(id: number): string;
    /**
     * `removeFacility(id, method)`: the player's sell or bulldoze of a unit
     * or shaft by id, paying the refund. JSON `{ ok, reason?, delta }`.
     */
    removeFacility(id: number, method: string): string;
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
     * reports `capacity_changed`: JSON
     * `{ ok, reason?, added, floorTilesCreated }`.
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
    sellAt(floor: number, x: number): boolean;
    /**
     * `serialize()` as JSON text.
     */
    serialize(): string;
    /**
     * `sim.autoBridge = value`, the direct write an undo restore makes.
     */
    setAutoBridge(value: boolean): void;
    /**
     * `setCars(id, cars)`: the simulation-layer edit, which reports
     * `capacity_changed`.
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
    setNoRate(id: number): boolean;
    /**
     * `Tower.setSchedule(id, schedule)` with the schedule as JSON text.
     */
    setSchedule(id: number, schedule: string): boolean;
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
     * in both engines (#906): the same JSON. Relay-only, as `towerSetCars`.
     */
    towerResizeTransport(id: number, bottom: number, top: number): string;
    /**
     * `tower.setCars(id, cars)`: the bare tower edit, silent in both
     * engines (#906). Relay-only: the dual-run mirror replays a bare
     * TypeScript tower edit with it. Player and UI edits use the charge commands
     * (`addCar`, `removeCar`, `extendTransport`), and
     * `towerRelayOps.guard.test.ts` keeps other callers out.
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
