import { describe, it, expect } from "vitest";
import { ECON, carResaleRefund, resaleRefund } from "../../engine/econConfig";
import { hasWasmPackage, wasmRequired } from "../conformance/wasmEngine";
import { Simulation } from "../../engine/Simulation";
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
    expect(sim.tower.setCars(shaft.id, 2)).toBe(cars !== 2); // a known count, so both commands land
    expect(sim.addCar(shaft.id)).toEqual({ ok: true, delta: -ECON.addCarCost });
    expect(sim.removeCar(shaft.id)).toEqual({ ok: true, delta: carResaleRefund() });
    expect(shaft.cars).toBe(2);
    expect(sim.tower.setCars(shaft.id, shaft.cars > 1 ? shaft.cars - 1 : 2)).toBe(true); // the raw edit stays free
    sim.money += 1000;
    expect(sim.tower.setStop(shaft.id, 35, false)).toBe(true);
    expect(sim.tower.clearStops(shaft.id)).toBe(true);
    expect(sim.tower.setSchedule(shaft.id, { weekday: Array(24).fill(2), weekend: Array(24).fill(1) })).toBe(true);
    const grown = sim.tower.resizeTransport(shaft.id, 30, 47);
    expect(grown.ok).toBe(true);
    sim.money -= 5000;
    // A billed drag: out two floors, back one (free), out again within the mark.
    const hwm = { bottom: shaft.bottom, top: shaft.top };
    const out = sim.extendTransport(shaft.id, "up", shaft.top + 2, hwm);
    expect(out.ok).toBe(true);
    hwm.top = Math.max(hwm.top, out.top);
    expect(sim.extendTransport(shaft.id, "up", out.top - 1, hwm).ok).toBe(true);
    expect(sim.extendTransport(shaft.id, "up", out.top, hwm).delta).toBe(0);
    const money = sim.money;
    sim.money = 0; // a broke press is refused in both engines
    expect(sim.extendTransport(shaft.id, "up", shaft.top + 1).reason).toBe("Not enough money.");
    expect(sim.addCar(shaft.id).reason).toBe("Not enough money.");
    sim.money = money;
    expect(sim.tower.setLabel(office.id, "  Corner suite ")).toBe(true);
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
    // The founding hour's pass on the first step, then 8:00, 9:00 and 10:00.
    expect(report.checkpoints).toBe(4);
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
