import { describe, expect, it } from "vitest";
import type { Simulation } from "../../engine/Simulation";
import { loadCommand } from "../../dualrun/mirror";
import { ShadowEngine } from "../../dualrun/shadow";
import type { WasmEngine } from "../../dualrun/binding";
import { hasWasmPackage, wasm, wasmRequired } from "../conformance/wasmEngine";
import { FIXTURES, loadFixture } from "../dualrun/dualRunHarness";

/**
 * The log's prose on both engines. The conformance view drops log text (it
 * pins each entry's minute and kind), so a line the WASM engine words or
 * formats differently (a dollar amount without its thousands separators, a
 * flattened plural) would reach a player on the WASM engine unnoticed. Each
 * fixture runs a day, then both clocks jump to just before the next quarter
 * and the next maintenance period and run across them, so the rent,
 * maintenance and checkout lines with their large amounts are written.
 */

if (wasmRequired() && !hasWasmPackage()) throw new Error("VC_REQUIRE_WASM=1 but engine-rs/pkg/ is not built; run npm run wasm:build");

const texts = (log: { text: string }[]) => log.map((e) => e.text);
const engineLog = (engine: WasmEngine) => texts((JSON.parse(engine.serialize()) as { log: { text: string }[] }).log);

function run(sim: Simulation, engine: WasmEngine, hours: number): void {
  for (let h = 0; h < hours; h++) {
    sim.tick(60);
    engine.tick(60);
  }
}

/** Move both clocks, raw, to an hour before the next multiple of `period`
 *  days that lies at least an hour ahead. */
function jumpBefore(sim: Simulation, engine: WasmEngine, period: number): void {
  let day = (Math.floor(sim.clock.day / period) + 1) * period;
  while (day * 1440 - 60 <= sim.clock.minutes) day += period;
  const delta = day * 1440 - 60 - sim.clock.minutes;
  sim.clock.advance(delta);
  engine.advanceClock(delta);
}

/** One fixture's run; returns every line the two engines agreed on. */
function compare(fixture: string): string[] {
  const sim = loadFixture(fixture);
  const shadow = new ShadowEngine(wasm());
  shadow.apply(loadCommand(sim, 0));
  const engine = shadow.handle();
  try {
    run(sim, engine, 24);
    expect(engineLog(engine), `${fixture}: the first day`).toEqual(texts(sim.log));
    const cal = sim.clock.calendar;
    jumpBefore(sim, engine, cal.quarterDays);
    run(sim, engine, 48);
    expect(engineLog(engine), `${fixture}: across a quarter`).toEqual(texts(sim.log));
    jumpBefore(sim, engine, cal.maintPeriodDays);
    run(sim, engine, 48);
    expect(engineLog(engine), `${fixture}: across a maintenance period`).toEqual(texts(sim.log));
    return texts(sim.log);
  } finally {
    shadow.free();
  }
}

describe.skipIf(!hasWasmPackage())("log text on both engines", () => {
  it("every fixture across a day, a quarter and a maintenance period", () => {
    const lines = FIXTURES.flatMap(compare);
    // The runs wrote the lines whose formatting is at stake: a grouped dollar
    // amount, the quarterly rent and the maintenance bill.
    expect(lines.some((t) => /\$\d{1,3}(,\d{3})+/.test(t)), "a grouped dollar amount").toBe(true);
    expect(lines.some((t) => t.startsWith("Quarterly office rent collected:")), "a quarterly rent line").toBe(true);
    expect(lines.some((t) => /maintenance paid:/i.test(t)), "a maintenance line").toBe(true);
  }, 300_000);
});
