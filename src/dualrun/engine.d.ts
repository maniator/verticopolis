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
     * `adjustRent(id, dir)`: the new rent, or null when nothing moved.
     */
    adjustRent(id: number, dir: number): number | undefined;
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
     * `sim.emit(text, kind)`: a log entry at the engine's clock.
     */
    emit(text: string, kind: string): void;
    evaluateStar(): void;
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
     * and loaded. Nothing else the import path does (the founder mark) runs.
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
     * The log entries emitted after `seq` (the `logSeq` the host last saw),
     * oldest first, as JSON `[{ seq, minute, text, kind }]`. The engine keeps
     * a ring of the last entries, so a host that falls further behind than
     * the ring gets the ring.
     */
    logSince(seq: number): string;
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
     * `tower.resizeTransport(id, bottom, top)`: JSON
     * `{ ok, reason?, added, floorTilesCreated }`.
     */
    resizeTransport(id: number, bottom: number, top: number): string;
    /**
     * `resolveChoice(accept ? "accept" : "decline")`.
     */
    resolveChoice(accept: boolean): void;
    sellAt(floor: number, x: number): boolean;
    /**
     * `serialize()` as JSON text.
     */
    serialize(): string;
    /**
     * `sim.autoBridge = value`, the direct write an undo restore makes.
     */
    setAutoBridge(value: boolean): void;
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
     * The shaft covering a tile, serialized as the save would, or null.
     */
    transportAt(floor: number, x: number): string | undefined;
    /**
     * The unit covering a tile, serialized as the save would, or null.
     */
    unitAt(floor: number, x: number): string | undefined;
}
