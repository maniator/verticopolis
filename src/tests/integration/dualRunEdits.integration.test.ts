import { describe, it, expect } from "vitest";
import { ECON, carResaleRefund, resaleRefund } from "../../engine/econConfig";
import { hasWasmPackage, wasmRequired } from "../conformance/wasmEngine";
import { Simulation } from "../../engine/Simulation";
import { INVALID_REQUEST } from "../../engine/sim/charges";
import { DualRun, FrameDriver, loadFixture } from "../dualrun/dualRunHarness";

/**
 * The mirror under a player's hands: every edit the host can make to the
 * live simulation, including the writes it makes to fields directly (money
 * on a sale, the camera on a save, the tower's name, a log line), an undo
 * restore, and hours of play around them, all shadowed without divergence.
 * And the converse: a shadow that drifts is caught at the next hour, with
 * the path where it drifted.
 */

if (wasmRequired() && !hasWasmPackage()) throw new Error("VC_REQUIRE_WASM=1 but engine-rs/pkg/ is not built; run npm run wasm:build");

describe.skipIf(!hasWasmPackage())("dual run: player edits are mirrored", () => {
  it("every host-side edit on the four-star tower stays in step", () => {
    const sim = loadFixture("src/tests/fixtures/towerone-star4.vctower");
    const run = new DualRun().follow(sim);
    const drive = new FrameDriver(sim, 3);
    drive.run(90);

    // Engine commands the UI calls.
    expect(sim.build("office", 58, 120).ok).toBe(true);
    for (let x = 129; x < 136; x++) expect(sim.build("floor", 58, x).ok).toBe(true);
    expect(sim.buildTransport("stairs", 130, 57, 58).ok).toBe(true);
    const cinema = sim.tower.unitAt(10, 240)!;
    expect(sim.setFilmPolicy(cinema.id, "blockbuster")).toBe("blockbuster");
    const shop = sim.tower.unitAt(13, 238)!;
    expect(sim.rerollSubtype(shop.id)).toBeDefined();
    const office = sim.tower.unitAt(2, 150)!;
    expect(sim.adjustRent(office.id, 1)).not.toBeNull();
    expect(sim.priceUnit(office, 10000)).not.toBeNull();
    expect(sim.setNoRate(sim.tower.unitAt(2, 159)!.id)).toBe(true);
    expect(sim.applyRentBatch("hotelSingle", 160, { onlyDefaultPriced: true })).not.toBeNull();
    sim.callExterminator(); // refused without an infestation; the refusal is mirrored too
    sim.emit("Edited by hand", "good");

    // Tower edits from the editor card.
    const shaft = sim.tower.transportAt(30, 196)!;
    // The engine-owned charges (#914): each command moves the money itself.
    const cars = shaft.cars;
    expect(sim.setCars(shaft.id, 2)).toBe(cars !== 2); // a known count, so both commands land
    expect(sim.addCar(shaft.id)).toEqual({ ok: true, delta: -ECON.addCarCost });
    expect(sim.removeCar(shaft.id)).toEqual({ ok: true, delta: carResaleRefund() });
    expect(shaft.cars).toBe(2);
    expect(sim.setCars(shaft.id, shaft.cars > 1 ? shaft.cars - 1 : 2)).toBe(true); // the uncharged edit stays free
    // The bare tower edits are silent in both engines (#906): the shadow
    // applies them as its silent tower ops, so the event streams still agree.
    expect(sim.tower.setCars(shaft.id, shaft.cars > 1 ? shaft.cars - 1 : 2)).toBe(true);
    expect(sim.tower.resizeTransport(shaft.id, shaft.bottom, shaft.top + 1).ok).toBe(true);
    expect(sim.tower.resizeTransport(shaft.id, shaft.bottom, shaft.top - 1).ok).toBe(true);
    sim.money += 1000; // a host's direct write is still mirrored as setMoney
    expect(sim.tower.setStop(shaft.id, 35, false)).toBe(true);
    expect(sim.tower.clearStops(shaft.id)).toBe(true);
    expect(sim.tower.setSchedule(shaft.id, { weekday: Array(24).fill(2), weekend: Array(24).fill(1) })).toBe(true);
    const grown = sim.resizeTransport(shaft.id, 30, 47);
    expect(grown.ok).toBe(true);
    sim.money -= 5000;
    // A billed drag: out two floors, back one (free), out again within the mark.
    const hwm = { bottom: shaft.bottom, top: shaft.top };
    const start = shaft.top;
    const out = sim.extendTransport(shaft.id, "up", start + 2, hwm);
    expect(out).toMatchObject({ ok: true, top: start + 2, added: 2, delta: -2 * ECON.transportFloorCost });
    hwm.top = Math.max(hwm.top, out.top);
    expect(sim.extendTransport(shaft.id, "up", out.top - 1, hwm)).toMatchObject({ ok: true, top: start + 1, delta: 0 });
    expect(sim.extendTransport(shaft.id, "up", out.top, hwm)).toMatchObject({ ok: true, top: start + 2, added: 0, delta: 0 });
    const money = sim.money;
    sim.money = 0; // a broke press is refused in both engines
    expect(sim.extendTransport(shaft.id, "up", shaft.top + 1).reason).toBe("Not enough money.");
    expect(sim.addCar(shaft.id).reason).toBe("Not enough money.");
    sim.money = money;
    expect(sim.tower.setLabel(office.id, "  Corner suite ")).toBe(true);
    // A name cut through an emoji: both engines hold U+FFFD for the half (#936).
    expect(sim.tower.setLabel(office.id, "Corner " + String.fromCharCode(0xd83c))).toBe(true);
    expect(sim.tower.getUnit(office.id)?.label).toBe("Corner \uFFFD");
    sim.tower.towerName = "Dual Run Tower";
    sim.view = { tile: 180, floor: 12, zoom: 1.5 };
    drive.run(60);
    (sim.tower as { towerName?: string }).towerName = undefined; // the name cleared leaves the key out of the save
    expect(sim.tower.setLabel(office.id, "   ")).toBe(true); // back to the catalog name

    // A sale and a bulldoze the way the UI does them: the engine's removal
    // command pays the refund.
    const sold = sim.tower.unitAt(58, 120)!;
    expect(sim.removeFacility(sold.id, "sell")).toEqual({ ok: true, delta: resaleRefund(sold.kind) });
    const stairs = sim.tower.transportAt(58, 130)!;
    expect(sim.removeFacility(stairs.id, "bulldoze")).toEqual({ ok: true, delta: resaleRefund(stairs.kind) });
    const lobby = sim.tower.unitAt(1, 180)!;
    expect(sim.removeFacility(lobby.id, "bulldoze").ok).toBe(false); // refused in both engines
    drive.run(60);

    // Undo: the app rebuilds the sim from a snapshot and adopts it.
    const snapshot = JSON.stringify(sim.serialize());
    const restored = run.restore(snapshot);
    new FrameDriver(restored, 3).run(120);

    const report = run.stop();
    expect(report.divergences).toEqual([]);
    // 90 + 60 + 60 minutes before the restore, then 120 after it.
    expect(report.checkpoints).toBe(5);
    // The edits' gameplay events agree too: nine placements, three price
    // changes (the hotel batch moves no price on this tower), the capacity
    // changes (the two raw car counts, the first only when it moved the
    // count, the paid car added and removed, the raw resize, and the drag's
    // three moves; the refused presses report nothing) and the two removals,
    // sold and bulldozed.
    expect(report.eventDivergences).toEqual([]);
    expect(report.events).toBe(cars !== 2 ? 22 : 21);
  });

  it("a founded game edited before the shadow attaches still starts in step", () => {
    // The app founds a tower, then sets things on it, and only then adopts
    // it; the shadow starts from that state with the founding's markers.
    const sim = Simulation.newGame(31, "classic");
    sim.money = 1e9;
    for (let x = 170; x < 200; x++) expect(sim.build("lobby", 1, x).ok).toBe(true);
    sim.tower.towerName = "Founded then edited";
    sim.tick(1);
    const run = new DualRun().follow(sim);
    new FrameDriver(sim, 3).run(26 * 60); // across the first day boundary
    const report = run.stop();
    expect(report.divergences).toEqual([]);
    expect(report.eventDivergences).toEqual([]);
    expect(report.checkpoints).toBe(26);
  });

  it("the Modern bridging toggle and the undo path's direct write are mirrored", () => {
    const { sim, run } = DualRun.found(77, "modern");
    sim.money = 1e9;
    for (let x = 170; x < 210; x++) expect(sim.build("lobby", 1, x).ok).toBe(true);
    expect(sim.toggleAutoBridge()).toBe(false);
    expect(sim.build("office", 2, 180).ok).toBe(true);
    sim.autoBridge = true; // what an undo restore writes
    expect(sim.build("office", 2, 195).ok).toBe(true);
    new FrameDriver(sim, 3).run(180);
    const report = run.stop();
    expect(report.divergences).toEqual([]);
    expect(report.eventDivergences).toEqual([]);
    // The founding hour's pass on the first step, then 8:00, 9:00 and 10:00.
    expect(report.checkpoints).toBe(4);
  });

  it("a malformed charge command is refused in both engines and stays in step (#923)", () => {
    // A second frontend's bad arguments: before #923 the TypeScript engine
    // acted on some of them while the binding truncated or threw.
    const { sim, run } = DualRun.found(9, "classic");
    sim.money = 1e9;
    for (let x = 170; x < 200; x++) expect(sim.build("lobby", 1, x).ok).toBe(true);
    for (let x = 170; x < 200; x++) expect(sim.build("floor", 2, x).ok).toBe(true);
    expect(sim.buildTransport("elevatorStandard", 172, 1, 2).ok).toBe(true);
    const lift = sim.tower.transportAt(1, 172)!;
    const refused = { ok: false, reason: INVALID_REQUEST, delta: 0 };
    expect(sim.addCar(lift.id + 0.5)).toEqual(refused);
    expect(sim.removeCar(Number.NaN)).toEqual(refused);
    expect(sim.extendTransport(lift.id, "up", 3.5)).toMatchObject(refused);
    expect(sim.extendTransport(lift.id, "sideways" as "up", 3)).toMatchObject({ ...refused, bottom: 1, top: 2 });
    expect(sim.extendTransport(lift.id, "up", 3, { bottom: 1, top: 2.5 })).toMatchObject(refused);
    expect(sim.removeFacility(lift.id, "burn" as "sell")).toEqual(refused);
    expect(sim.removeFacility(lift.id - 0.5, "sell")).toEqual(refused);
    // Non-numbers and non-strings: the binding would coerce or throw on
    // these, so the mirror relays them as NaN and "" for Rust to refuse too.
    const loose = (v: unknown) => v as number;
    expect(sim.addCar(loose(String(lift.id)))).toEqual(refused);
    expect(sim.addCar(loose(null))).toEqual(refused);
    expect(sim.removeCar(loose(true))).toEqual(refused);
    expect(sim.extendTransport(lift.id, "up", loose("3"))).toMatchObject(refused);
    expect(sim.extendTransport(lift.id, loose(null) as unknown as "up", 3)).toMatchObject(refused);
    expect(sim.extendTransport(lift.id, loose(5) as unknown as "up", 3)).toMatchObject(refused);
    expect(sim.extendTransport(lift.id, "up", 3, loose(0) as unknown as { bottom: number; top: number })).toMatchObject(refused);
    expect(sim.extendTransport(lift.id, "up", 3, { bottom: loose("1"), top: 2 })).toMatchObject(refused);
    expect(sim.removeFacility(lift.id, loose(null) as unknown as "sell")).toEqual(refused);
    expect(sim.removeFacility(lift.id, loose(7) as unknown as "sell")).toEqual(refused);
    const live = () => sim.tower.transportById(lift.id)!;
    expect(live().cars).toBe(1);
    expect(live().top).toBe(2);
    expect(sim.addCar(lift.id).ok).toBe(true); // a well-formed call still lands
    // A mark whose fields answer differently on a second read: the mirror
    // reads it once, before the call, so both engines bill the same floors.
    // The first read never reaches past the shaft, so no floor goes free.
    let reads = 0;
    const shifting = { bottom: 1, get top() { return reads++ === 0 ? 2 : 5; } };
    expect(sim.extendTransport(lift.id, "up", 6, shifting)).toMatchObject({ ok: true, bottom: 1, top: 6, added: 4 });
    let readsB = 0;
    const halving = { get bottom() { return readsB++ === 0 ? 1 : 0.5; }, top: 6 };
    expect(sim.extendTransport(lift.id, "up", 7, halving)).toMatchObject({ ok: true, bottom: 1, top: 7, added: 1 });
    let readsC = 0; // a callable mark carries fields too
    const callable = Object.assign(() => undefined, { bottom: 1 });
    Object.defineProperty(callable, "top", { get: () => (readsC++ === 0 ? 7 : 2.5) });
    expect(sim.extendTransport(lift.id, "up", 8, loose(callable) as unknown as { bottom: number; top: number })).toMatchObject({ ok: true, bottom: 1, top: 8, added: 1 });
    new FrameDriver(sim, 3).run(60);
    const report = run.stop();
    expect(report.divergences).toEqual([]);
    expect(report.eventDivergences).toEqual([]);
    // 60 frames at speed 3 from the founding hour: its pass, then 8:00.
    expect(report.checkpoints).toBe(2);
  });

  it("a shadow that drifts is caught at the next hour with the path", () => {
    const { sim, run } = DualRun.found(5, "classic");
    sim.money = 1e9;
    for (let x = 170; x < 200; x++) expect(sim.build("lobby", 1, x).ok).toBe(true);
    run.shadow.apply({ op: "setMoney", amount: 1 }); // the shadow alone
    new FrameDriver(sim, 3).run(60);
    const report = run.stop();
    expect(report.divergences.length).toBeGreaterThan(0);
    expect(report.divergences[0]).toMatchObject({ view: "state", path: "$.money", shadow: 1 });
  });
});
