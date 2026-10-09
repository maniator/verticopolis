/* @ts-self-types="./verticopolis_engine.d.ts" */

/**
 * One running simulation. Construct with `newGame`, `fromSave` or
 * `fromVctower`; drive it with the command methods; read it back with
 * `serialize` and the two hashed views.
 */
export class Engine {
    static __wrap(ptr) {
        const obj = Object.create(Engine.prototype);
        obj.__wbg_ptr = ptr;
        EngineFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        EngineFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_engine_free(ptr, 0);
    }
    /**
     * `adjustRent(id, dir)`: the new rent, or null when nothing moved.
     * @param {number} id
     * @param {number} dir
     * @returns {number | undefined}
     */
    adjustRent(id, dir) {
        const ret = wasm.engine_adjustRent(this.__wbg_ptr, id, dir);
        return ret[0] === 0 ? undefined : ret[1];
    }
    /**
     * `applyRentBatch(kind, target, onlyDefaultPriced)` with the target as
     * JSON text (a number, `"default"` or `"noRate"`): the result counters
     * as JSON, or null when the batch does not apply.
     * @param {string} kind
     * @param {string} target
     * @param {boolean} only_default_priced
     * @returns {string | undefined}
     */
    applyRentBatch(kind, target, only_default_priced) {
        const ptr0 = passStringToWasm0(kind, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(target, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.engine_applyRentBatch(this.__wbg_ptr, ptr0, len0, ptr1, len1, only_default_priced);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        let v3;
        if (ret[0] !== 0) {
            v3 = getStringFromWasm0(ret[0], ret[1]);
            wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        }
        return v3;
    }
    /**
     * `sim.autoBridge`.
     * @returns {boolean}
     */
    autoBridge() {
        const ret = wasm.engine_autoBridge(this.__wbg_ptr);
        return ret !== 0;
    }
    bombThreat() {
        wasm.engine_bombThreat(this.__wbg_ptr);
    }
    /**
     * `buildTransport(kind, x, bottom, top)`: JSON `{ ok, reason? }`.
     * @param {string} kind
     * @param {number} x
     * @param {number} bottom
     * @param {number} top
     * @returns {string}
     */
    buildTransport(kind, x, bottom, top) {
        let deferred3_0;
        let deferred3_1;
        try {
            const ptr0 = passStringToWasm0(kind, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len0 = WASM_VECTOR_LEN;
            const ret = wasm.engine_buildTransport(this.__wbg_ptr, ptr0, len0, x, bottom, top);
            var ptr2 = ret[0];
            var len2 = ret[1];
            if (ret[3]) {
                ptr2 = 0; len2 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred3_0 = ptr2;
            deferred3_1 = len2;
            return getStringFromWasm0(ptr2, len2);
        } finally {
            wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
        }
    }
    /**
     * `build(kind, floor, x)`: JSON `{ ok, reason? }`.
     * @param {string} kind
     * @param {number} floor
     * @param {number} x
     * @returns {string}
     */
    build(kind, floor, x) {
        let deferred3_0;
        let deferred3_1;
        try {
            const ptr0 = passStringToWasm0(kind, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len0 = WASM_VECTOR_LEN;
            const ret = wasm.engine_build(this.__wbg_ptr, ptr0, len0, floor, x);
            var ptr2 = ret[0];
            var len2 = ret[1];
            if (ret[3]) {
                ptr2 = 0; len2 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred3_0 = ptr2;
            deferred3_1 = len2;
            return getStringFromWasm0(ptr2, len2);
        } finally {
            wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
        }
    }
    /**
     * `callExterminator()`: JSON `{ ok, reason? }`.
     * @returns {string}
     */
    callExterminator() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.engine_callExterminator(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @param {number} id
     * @returns {boolean}
     */
    clearStops(id) {
        const ret = wasm.engine_clearStops(this.__wbg_ptr, id);
        return ret !== 0;
    }
    /**
     * The crowd view's hash, as the lock records it.
     * @returns {string}
     */
    crowdDigest() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.engine_crowdDigest(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * The hashed crowd view (people, id source, rng), as canonical JSON.
     * @returns {string}
     */
    crowdView() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.engine_crowdView(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * `sim.emit(text, kind)`: a log entry at the engine's clock.
     * @param {string} text
     * @param {string} kind
     */
    emit(text, kind) {
        const ptr0 = passStringToWasm0(text, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(kind, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.engine_emit(this.__wbg_ptr, ptr0, len0, ptr1, len1);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    evaluateStar() {
        wasm.engine_evaluateStar(this.__wbg_ptr);
    }
    /**
     * The number of units on fire.
     * @returns {number}
     */
    fires() {
        const ret = wasm.engine_fires(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * The per-frame read model as one flat number array (see
     * `frame_view` for the layout): what the host reads every frame while
     * the engine runs the simulation.
     * @returns {Float64Array}
     */
    frameView() {
        const ret = wasm.engine_frameView(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * `Simulation.deserialize(JSON.parse(text))`: a serialized game, migrated
     * and loaded. Nothing else the import path does (the founder mark) runs.
     * `markers`, when given, is JSON `{ lastHour, lastDay, lastQuarter,
     * lastMonth }`: the live engine's boundary markers, which a save does
     * not carry (a load rebuilds them from the clock, a founded game keeps
     * them unset until the first boundary), so a shadow can start exactly
     * where the live engine stands.
     * @param {string} text
     * @param {string | null} [markers]
     * @returns {Engine}
     */
    static fromSave(text, markers) {
        const ptr0 = passStringToWasm0(text, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        var ptr1 = isLikeNone(markers) ? 0 : passStringToWasm0(markers, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        var len1 = WASM_VECTOR_LEN;
        const ret = wasm.engine_fromSave(ptr0, len0, ptr1, len1);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return Engine.__wrap(ret[0]);
    }
    /**
     * The import path for a `.vctower` file: decode, migrate and load, then
     * mark a save from before 2.0 as a founder's tower. `mode`, when given,
     * overwrites the save's mode before loading, as a scenario start does.
     * @param {string} text
     * @param {string | null} [mode]
     * @returns {Engine}
     */
    static fromVctower(text, mode) {
        const ptr0 = passStringToWasm0(text, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        var ptr1 = isLikeNone(mode) ? 0 : passStringToWasm0(mode, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        var len1 = WASM_VECTOR_LEN;
        const ret = wasm.engine_fromVctower(ptr0, len0, ptr1, len1);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return Engine.__wrap(ret[0]);
    }
    /**
     * The log entries emitted after `seq` (the `logSeq` the host last saw),
     * oldest first, as JSON `[{ seq, minute, text, kind }]`. The engine keeps
     * a ring of the last entries, so a host that falls further behind than
     * the ring gets the ring.
     * @param {number} seq
     * @returns {string}
     */
    logSince(seq) {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.engine_logSince(this.__wbg_ptr, seq);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @returns {string}
     */
    mode() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.engine_mode(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @returns {number}
     */
    money() {
        const ret = wasm.engine_money(this.__wbg_ptr);
        return ret;
    }
    /**
     * `Simulation.newGame(seed, mode, modernCalendar, startUnbridged)`; the
     * calendar defaults to the real-world one and the tower starts bridged,
     * as the TypeScript defaults do.
     * @param {number} seed
     * @param {string} mode
     * @param {string | null} [modern_calendar]
     * @param {boolean | null} [start_unbridged]
     * @returns {Engine}
     */
    static newGame(seed, mode, modern_calendar, start_unbridged) {
        const ptr0 = passStringToWasm0(mode, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        var ptr1 = isLikeNone(modern_calendar) ? 0 : passStringToWasm0(modern_calendar, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        var len1 = WASM_VECTOR_LEN;
        const ret = wasm.engine_newGame(seed, ptr0, len0, ptr1, len1, isLikeNone(start_unbridged) ? 0xFFFFFF : start_unbridged ? 1 : 0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return Engine.__wrap(ret[0]);
    }
    /**
     * The pending player choice as JSON `{ kind, cost, message }`, or null.
     * @returns {string | undefined}
     */
    pendingChoice() {
        const ret = wasm.engine_pendingChoice(this.__wbg_ptr);
        let v1;
        if (ret[0] !== 0) {
            v1 = getStringFromWasm0(ret[0], ret[1]);
            wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        }
        return v1;
    }
    /**
     * `priceUnit(u, target)`: the new price, or null when not repriceable.
     * @param {number} id
     * @param {number} target
     * @returns {number | undefined}
     */
    priceUnit(id, target) {
        const ret = wasm.engine_priceUnit(this.__wbg_ptr, id, target);
        return ret[0] === 0 ? undefined : ret[1];
    }
    /**
     * `tower.removeTransport(id)`: whether a shaft went.
     * @param {number} id
     * @returns {boolean}
     */
    removeTransport(id) {
        const ret = wasm.engine_removeTransport(this.__wbg_ptr, id);
        return ret !== 0;
    }
    /**
     * `tower.removeUnit(id)`: whether a unit went.
     * @param {number} id
     * @returns {boolean}
     */
    removeUnit(id) {
        const ret = wasm.engine_removeUnit(this.__wbg_ptr, id);
        return ret !== 0;
    }
    /**
     * `rerollSubtype(id)`: the new subtype, or null.
     * @param {number} id
     * @returns {string | undefined}
     */
    rerollSubtype(id) {
        const ret = wasm.engine_rerollSubtype(this.__wbg_ptr, id);
        let v1;
        if (ret[0] !== 0) {
            v1 = getStringFromWasm0(ret[0], ret[1]);
            wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        }
        return v1;
    }
    /**
     * `tower.resizeTransport(id, bottom, top)`: JSON
     * `{ ok, reason?, added, floorTilesCreated }`.
     * @param {number} id
     * @param {number} bottom
     * @param {number} top
     * @returns {string}
     */
    resizeTransport(id, bottom, top) {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.engine_resizeTransport(this.__wbg_ptr, id, bottom, top);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * `resolveChoice(accept ? "accept" : "decline")`.
     * @param {boolean} accept
     */
    resolveChoice(accept) {
        wasm.engine_resolveChoice(this.__wbg_ptr, accept);
    }
    /**
     * @param {number} floor
     * @param {number} x
     * @returns {boolean}
     */
    sellAt(floor, x) {
        const ret = wasm.engine_sellAt(this.__wbg_ptr, floor, x);
        return ret !== 0;
    }
    /**
     * `serialize()` as JSON text.
     * @returns {string}
     */
    serialize() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.engine_serialize(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * `sim.autoBridge = value`, the direct write an undo restore makes.
     * @param {boolean} value
     */
    setAutoBridge(value) {
        wasm.engine_setAutoBridge(this.__wbg_ptr, value);
    }
    /**
     * @param {number} id
     * @param {number} cars
     * @returns {boolean}
     */
    setCars(id, cars) {
        const ret = wasm.engine_setCars(this.__wbg_ptr, id, cars);
        return ret !== 0;
    }
    /**
     * @param {number} id
     */
    setExpressStops(id) {
        wasm.engine_setExpressStops(this.__wbg_ptr, id);
    }
    /**
     * `setFilmPolicy(id, policy)`: the policy stored, or null.
     * @param {number} id
     * @param {string} policy
     * @returns {string | undefined}
     */
    setFilmPolicy(id, policy) {
        const ptr0 = passStringToWasm0(policy, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.engine_setFilmPolicy(this.__wbg_ptr, id, ptr0, len0);
        let v2;
        if (ret[0] !== 0) {
            v2 = getStringFromWasm0(ret[0], ret[1]);
            wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        }
        return v2;
    }
    /**
     * The editor's rename of a unit.
     * @param {number} id
     * @param {string} label
     * @returns {boolean}
     */
    setLabel(id, label) {
        const ptr0 = passStringToWasm0(label, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.engine_setLabel(this.__wbg_ptr, id, ptr0, len0);
        return ret !== 0;
    }
    /**
     * @param {number} amount
     */
    setMoney(amount) {
        wasm.engine_setMoney(this.__wbg_ptr, amount);
    }
    /**
     * @param {number} id
     * @returns {boolean}
     */
    setNoRate(id) {
        const ret = wasm.engine_setNoRate(this.__wbg_ptr, id);
        return ret !== 0;
    }
    /**
     * `Tower.setSchedule(id, schedule)` with the schedule as JSON text.
     * @param {number} id
     * @param {string} schedule
     * @returns {boolean}
     */
    setSchedule(id, schedule) {
        const ptr0 = passStringToWasm0(schedule, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.engine_setSchedule(this.__wbg_ptr, id, ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return ret[0] !== 0;
    }
    /**
     * @param {number} id
     * @param {number} floor
     * @param {boolean} stop
     * @returns {boolean}
     */
    setStop(id, floor, stop) {
        const ret = wasm.engine_setStop(this.__wbg_ptr, id, floor, stop);
        return ret !== 0;
    }
    /**
     * `tower.towerName = name`; null clears it, as the host's `undefined`
     * leaves the key out of the save.
     * @param {string | null} [name]
     */
    setTowerName(name) {
        var ptr0 = isLikeNone(name) ? 0 : passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        var len0 = WASM_VECTOR_LEN;
        wasm.engine_setTowerName(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * `sim.view = view`, the camera a save carries, as JSON text (null clears).
     * @param {string | null} [view]
     */
    setView(view) {
        var ptr0 = isLikeNone(view) ? 0 : passStringToWasm0(view, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        var len0 = WASM_VECTOR_LEN;
        const ret = wasm.engine_setView(this.__wbg_ptr, ptr0, len0);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    startFire() {
        wasm.engine_startFire(this.__wbg_ptr);
    }
    /**
     * The state view's hash, as the lock records it.
     * @returns {string}
     */
    stateDigest() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.engine_stateDigest(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * The hashed state view: the saved game minus prose, as canonical JSON.
     * @returns {string}
     */
    stateView() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.engine_stateView(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @param {number} dt_minutes
     */
    tick(dt_minutes) {
        wasm.engine_tick(this.__wbg_ptr, dt_minutes);
    }
    /**
     * `toggleAutoBridge()`: the preference after the flip.
     * @returns {boolean}
     */
    toggleAutoBridge() {
        const ret = wasm.engine_toggleAutoBridge(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * The shaft covering a tile, serialized as the save would, or null.
     * @param {number} floor
     * @param {number} x
     * @returns {string | undefined}
     */
    transportAt(floor, x) {
        const ret = wasm.engine_transportAt(this.__wbg_ptr, floor, x);
        let v1;
        if (ret[0] !== 0) {
            v1 = getStringFromWasm0(ret[0], ret[1]);
            wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        }
        return v1;
    }
    /**
     * The unit covering a tile, serialized as the save would, or null.
     * @param {number} floor
     * @param {number} x
     * @returns {string | undefined}
     */
    unitAt(floor, x) {
        const ret = wasm.engine_unitAt(this.__wbg_ptr, floor, x);
        let v1;
        if (ret[0] !== 0) {
            v1 = getStringFromWasm0(ret[0], ret[1]);
            wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        }
        return v1;
    }
}
if (Symbol.dispose) Engine.prototype[Symbol.dispose] = Engine.prototype.free;
function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg_Error_30c8987f7c2ed4e2: function(arg0, arg1) {
            const ret = Error(getStringFromWasm0(arg0, arg1));
            return ret;
        },
        __wbg___wbindgen_throw_41e9ee4f547fc59a: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbindgen_init_externref_table: function() {
            const table = wasm.__wbindgen_externrefs;
            const offset = table.grow(4);
            table.set(0, undefined);
            table.set(offset + 0, undefined);
            table.set(offset + 1, null);
            table.set(offset + 2, true);
            table.set(offset + 3, false);
        },
    };
    return {
        __proto__: null,
        "./verticopolis_engine_bg.js": import0,
    };
}

const EngineFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_engine_free(ptr, 1));

function getArrayF64FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getFloat64ArrayMemory0().subarray(ptr / 8, ptr / 8 + len);
}

let cachedFloat64ArrayMemory0 = null;
function getFloat64ArrayMemory0() {
    if (cachedFloat64ArrayMemory0 === null || cachedFloat64ArrayMemory0.byteLength === 0) {
        cachedFloat64ArrayMemory0 = new Float64Array(wasm.memory.buffer);
    }
    return cachedFloat64ArrayMemory0;
}

function getStringFromWasm0(ptr, len) {
    return decodeText(ptr >>> 0, len);
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function isLikeNone(x) {
    return x === undefined || x === null;
}

function passStringToWasm0(arg, malloc, realloc) {
    if (realloc === undefined) {
        const buf = cachedTextEncoder.encode(arg);
        const ptr = malloc(buf.length, 1) >>> 0;
        getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
        WASM_VECTOR_LEN = buf.length;
        return ptr;
    }

    let len = arg.length;
    let ptr = malloc(len, 1) >>> 0;

    const mem = getUint8ArrayMemory0();

    let offset = 0;

    for (; offset < len; offset++) {
        const code = arg.charCodeAt(offset);
        if (code > 0x7F) break;
        mem[ptr + offset] = code;
    }
    if (offset !== len) {
        if (offset !== 0) {
            arg = arg.slice(offset);
        }
        ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
        const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
        const ret = cachedTextEncoder.encodeInto(arg, view);

        offset += ret.written;
        ptr = realloc(ptr, len, offset, 1) >>> 0;
    }

    WASM_VECTOR_LEN = offset;
    return ptr;
}

function takeFromExternrefTable0(idx) {
    const value = wasm.__wbindgen_externrefs.get(idx);
    wasm.__externref_table_dealloc(idx);
    return value;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(ptr, len) {
    numBytesDecoded += len;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
        cachedTextDecoder.decode();
        numBytesDecoded = len;
    }
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

const cachedTextEncoder = new TextEncoder();

if (!('encodeInto' in cachedTextEncoder)) {
    cachedTextEncoder.encodeInto = function (arg, view) {
        const buf = cachedTextEncoder.encode(arg);
        view.set(buf);
        return {
            read: arg.length,
            written: buf.length
        };
    };
}

let WASM_VECTOR_LEN = 0;

let wasmModule, wasmInstance, wasm;
function __wbg_finalize_init(instance, module) {
    wasmInstance = instance;
    wasm = instance.exports;
    wasmModule = module;
    cachedFloat64ArrayMemory0 = null;
    cachedUint8ArrayMemory0 = null;
    wasm.__wbindgen_start();
    return wasm;
}

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (!module.ok) {
            throw new Error(`failed to fetch Wasm: ${module.status} ${module.statusText} fetching '${module.url}'`);
        }

        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);
            } catch (e) {
                const validResponse = expectedResponseType(module.type);

                if (validResponse && module.headers.get('Content-Type') !== 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else { throw e; }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);
    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };
        } else {
            return instance;
        }
    }

    function expectedResponseType(type) {
        switch (type) {
            case 'basic': case 'cors': case 'default': return true;
        }
        return false;
    }
}

function initSync(module) {
    if (wasm !== undefined) return wasm;


    if (module !== undefined) {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();
    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }
    const instance = new WebAssembly.Instance(module, imports);
    return __wbg_finalize_init(instance, module);
}

async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;


    if (module_or_path !== undefined) {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (module_or_path === undefined) {
        module_or_path = new URL('verticopolis_engine_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync, __wbg_init as default };
