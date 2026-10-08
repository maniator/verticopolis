import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Simulation } from "../../engine/Simulation";
import type { SerializedGame } from "../../engine/serializedGame";
import { decodeVctower } from "../../storage/vctowerContainer";
import { markFounderFromLoadedFile } from "../../engine/sim/founderStatus";
import { loadScenario, REPO_ROOT } from "./scenario";

const file = process.argv[2];
const s = loadScenario(file);
let sim: Simulation;
const st = s.start as any;
if (st.newGame) sim = Simulation.newGame(st.newGame.seed, st.newGame.mode);
else {
  const raw = decodeVctower(readFileSync(resolve(REPO_ROOT, st.fixture), "utf8"), st.fixture) as SerializedGame;
  if (st.mode) raw.mode = st.mode;
  sim = Simulation.deserialize(raw);
  markFounderFromLoadedFile(sim, raw);
}
const snap = () => {
  const a: any = sim;
  const hk = sim.tower.units.filter((u) => u.kind === "housekeeping").length;
  const states: Record<string, number> = {};
  for (const u of sim.tower.units) if (/hotel/i.test(u.kind)) states[u.state] = (states[u.state] ?? 0) + 1;
  return `day=${sim.clock.day} star=${sim.star} money=${Math.round(sim.money)} hk=${hk} hotel=${JSON.stringify(states)} extDue=${a.exterminationDueDay} pop=${sim.totalPopulation?.()} vip=${JSON.stringify({ vipVisits: a.vipVisits, evaluatedTower: a.evaluatedTower, vipFavorable: a.vipFavorable, vipVisitDay: a.vipVisitDay })} metroNudged=${a.metroPlatformNudged}`;
};
let logSeen = sim.log.length;
const flushLog = () => {
  for (const e of sim.log.slice(logSeen)) console.log(`   [log d${sim.clock.day}] ${String(e.text).slice(0, 110)}`);
  logSeen = sim.log.length;
};
console.log("START", snap());
for (const c of s.commands as any[]) {
  switch (c.op) {
    case "setMoney": sim.money = c.amount; break;
    case "build": { const r = sim.build(c.kind, c.floor, c.x); console.log(`build ${c.kind} @${c.floor},${c.x} -> ${r.ok} ${r.reason ?? ""}`); break; }
    case "buildRow": for (let x = c.from; x <= c.to; x++) sim.build(c.kind, c.floor, x); break;
    case "buildTransport": { const r = sim.buildTransport(c.kind, c.x, c.bottom, c.top); console.log(`buildTransport ${c.kind} x${c.x} ${c.bottom}-${c.top} -> ${r.ok} ${r.reason ?? ""}`); break; }
    case "sell": { const u = sim.tower.unitAt(c.floor, c.x); console.log(`sell @${c.floor},${c.x} kind=${u?.kind} state=${u?.state} -> ${sim.sellAt(c.floor, c.x)}`); break; }
    case "setCars": { const t = sim.tower.transportAt(c.floor, c.x)!; console.log(`setCars ${c.cars} kind=${t.kind} -> ${sim.tower.setCars(t.id, c.cars)}`); break; }
    case "setSchedule": { const t = sim.tower.transportAt(c.floor, c.x)!; console.log(`setSchedule kind=${t.kind} -> ${sim.tower.setSchedule(t.id, c.schedule)} now=${JSON.stringify(t.schedule)}`); break; }
    case "callExterminator": { const r = sim.callExterminator(); console.log(`callExterminator -> ${JSON.stringify(r)} (expectFail=${c.expectFail})`); break; }
    case "evaluateStar": { const b = sim.star; sim.evaluateStar(); console.log(`evaluateStar ${b} -> ${sim.star}`); break; }
    case "reload": { sim = Simulation.deserialize(JSON.parse(JSON.stringify(sim.serialize()))); logSeen = sim.log.length; console.log("reload"); break; }
    case "tick": { for (let i = 0; i < (c.times ?? 1); i++) sim.tick(c.dt); console.log(`tick ${c.dt}x${c.times}`); break; }
    case "checkpoint": console.log(`CHECKPOINT ${c.label}`); break;
  }
  flushLog();
  if (c.op !== "buildRow") console.log("  ", snap());
}
console.log("END", snap());
