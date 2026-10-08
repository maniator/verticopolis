/**
 * Loader conformance table: forged and hand-edited saves run through
 * `Simulation.deserialize`, and the resulting state view is hashed into
 * `conformance/loader-cases.json`, which the Rust loader test replays. The
 * cases are generated here from code so they regenerate on purpose only, like
 * the scenario lock: `VC_CONFORMANCE_UPDATE=1 npx vitest run --project
 * integration loaderCases`.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { Simulation } from "../../engine/Simulation";
import type { SerializedGame } from "../../engine/types";
import { digest } from "../conformance/canonical";
import { stateView } from "../conformance/scenario";

const LOCK = resolve(__dirname, "../../../conformance/loader-cases.json");
const UPDATE = process.env.VC_CONFORMANCE_UPDATE === "1";
if (UPDATE && process.env.CI) throw new Error("VC_CONFORMANCE_UPDATE is a local regeneration switch and never runs in CI");

type Case = { id: string; input: unknown; expected: string };
type Any = Record<string, unknown>;

function base(mode: "classic" | "modern"): Any {
  const sim = Simulation.newGame(7, mode);
  sim.money = 1e8;
  // Small on purpose: the table carries the whole save per case.
  for (let x = 170; x < 192; x++) sim.build("lobby", 1, x);
  for (let fl = 2; fl <= 3; fl++) for (let x = 171; x < 191; x++) sim.build("floor", fl, x);
  sim.build("office", 2, 172);
  sim.build("office", 2, 181);
  sim.build("condo", 3, 172);
  sim.buildTransport("elevatorStandard", 171, 1, 3);
  sim.buildTransport("stairs", 189, 1, 2);
  for (let i = 0; i < 72; i++) sim.tick(20);
  const out = JSON.parse(JSON.stringify(sim.serialize())) as Any;
  out.log = (out.log as unknown[]).slice(-3);
  return out;
}

function mutate(seed: Any, edit: (s: Any) => void): Any {
  const copy = JSON.parse(JSON.stringify(seed)) as Any;
  edit(copy);
  return copy;
}

function units(s: Any): Any[] { return s.units as Any[]; }
function transports(s: Any): Any[] { return s.transports as Any[]; }

function buildCases(): Case[] {
  const modern = base("modern");
  const classic = base("classic");
  const inputs: [string, Any][] = [
    ["modern-roundtrip", modern],
    ["classic-roundtrip", classic],
    ["optional-keys-absent", mutate(modern, (s) => { delete s.towerName; delete s.builtWeddingHall; delete s.evaluatedTower; delete s.view; })],
    ["seed-hex-string", mutate(modern, (s) => { s.seed = "0x10"; })],
    ["seed-null", mutate(modern, (s) => { s.seed = null; })],
    ["seed-absent", mutate(modern, (s) => { delete s.seed; })],
    ["seed-float", mutate(modern, (s) => { s.seed = 12345.75; })],
    ["star-too-high", mutate(modern, (s) => { s.star = 9; })],
    ["star-fraction", mutate(modern, (s) => { s.star = 0.4; })],
    ["star-string", mutate(modern, (s) => { s.star = "3"; })],
    ["minutes-negative", mutate(modern, (s) => { s.minutes = -5; })],
    ["minutes-string", mutate(modern, (s) => { s.minutes = "abc"; })],
    ["minutes-fraction", mutate(modern, (s) => { s.minutes = 1440.5; })],
    ["money-null", mutate(modern, (s) => { s.money = null; })],
    ["unit-width-null", mutate(modern, (s) => { units(s)[0].width = null; })],
    ["unit-width-zero", mutate(modern, (s) => { const u = units(s).find((x) => x.kind === "office")!; u.width = 0; })],
    ["unit-width-huge", mutate(modern, (s) => { const u = units(s).find((x) => x.kind === "office")!; u.width = 9999; })],
    ["unit-floor-out-of-range", mutate(modern, (s) => { const u = units(s).find((x) => x.kind === "office")!; u.floor = 999; })],
    ["unit-x-negative", mutate(modern, (s) => { const u = units(s).find((x) => x.kind === "office")!; u.x = -40; })],
    ["unit-duplicate-ids", mutate(modern, (s) => { const us = units(s).filter((x) => x.kind === "office"); us[1].id = us[0].id; })],
    ["unit-overlap", mutate(modern, (s) => { const u = units(s).find((x) => x.kind === "office")!; units(s).push({ ...u, id: 9001, x: (u.x as number) + 1 }); })],
    ["unit-unknown-kind", mutate(modern, (s) => { units(s).push({ ...units(s)[0], id: 9002, kind: "zeppelin" }); })],
    ["unit-bad-state", mutate(modern, (s) => { const u = units(s).find((x) => x.kind === "office")!; u.state = "infested"; })],
    ["unit-rent-off-ladder-classic", mutate(classic, (s) => { for (const u of units(s)) if (u.kind === "office" || u.kind === "condo") u.rent = 123456.78; })],
    ["unit-satisfaction-wild", mutate(modern, (s) => { for (const u of units(s)) { u.satisfaction = 7; u.occupants = -3; } })],
    ["transport-cars-99", mutate(modern, (s) => { transports(s)[0].cars = 99; })],
    ["transport-cars-zero", mutate(modern, (s) => { transports(s)[0].cars = 0; })],
    ["transport-inverted-span", mutate(modern, (s) => { const t = transports(s)[0]; [t.bottom, t.top] = [t.top, t.bottom]; })],
    ["transport-skipfloors-forged", mutate(modern, (s) => { transports(s)[0].skipFloors = ["7", 2.5, null, 3]; })],
    ["transport-schedule-garbage", mutate(modern, (s) => { transports(s)[0].schedule = { weekday: "x", homeFloors: [1, "2"], waitingCarResponse: 2 }; })],
    ["log-forged", mutate(modern, (s) => { s.log = [{ minute: 1, text: "x".repeat(5000) }, { minute: "2", kind: "money", text: "ok" }, null, 5]; })],
    ["events-forged", mutate(modern, (s) => { s.events = { pending: { kind: "bombThreat", cost: "300000" }, activeFires: "no" }; })],
    ["version-absent-v1-reflow", mutate(modern, (s) => { delete s.version; })],
    ["version-3", mutate(modern, (s) => { s.version = 3; })],
    ["vip-evaluated-without-visits", mutate(modern, (s) => { delete s.vipVisits; s.evaluatedTower = true; s.vipFavorable = true; })],
    ["next-id-zero", mutate(modern, (s) => { if (s.tower && typeof s.tower === "object") (s.tower as Any).nextId = 0; s.nextId = 0; })],
    ["units-not-array", mutate(modern, (s) => { s.units = "nope"; })],
    // The migration boundaries and the malformed legacy values the post-merge
    // review of #857 named: loading must end, never panic, and never finish a
    // construction early. Each case changes one thing so a divergence names it.
    ["legacy-v1-width-unbounded", mutate(modern, (s) => { delete s.version; const u = units(s).find((x) => x.kind === "office")!; u.width = 1e6; })],
    ["legacy-v1-coordinates-saturated", mutate(modern, (s) => { delete s.version; const u = units(s).find((x) => x.kind === "office")!; u.x = 1e300; u.floor = -1e300; })],
    ["legacy-v1-shaft-widening", mutate(modern, (s) => { delete s.version; transports(s)[0].width = 1; })],
    ["construction-completeat-string", mutate(modern, (s) => { const u = units(s).find((x) => x.kind === "office")!; u.state = "construction"; u.completeAt = "soon"; })],
    ["construction-completeat-negative", mutate(modern, (s) => { const u = units(s).find((x) => x.kind === "office")!; u.state = "construction"; u.completeAt = -1; })],
    ["construction-completeat-huge", mutate(modern, (s) => { const u = units(s).find((x) => x.kind === "office")!; u.state = "construction"; u.completeAt = 1e300; })],
    ["schedule-rows-wrong-length", mutate(modern, (s) => { transports(s)[0].schedule = { activeCars: { weekday: [1, 2, 3], weekend: Array(40).fill(9) }, homeFloors: [-5, 1, 2, 2, 99] }; })],
    ["schedule-nonfinite-tunables", mutate(modern, (s) => { transports(s)[0].schedule = { waitingCarResponse: -4, standardFloorDeparture: 1e9, activeCars: { weekday: Array(24).fill(1) } }; })],
  ];
  return inputs.map(([id, input]) => {
    let expected: string;
    try {
      expected = digest(stateView(Simulation.deserialize(input as unknown as SerializedGame)));
    } catch {
      expected = "throws";
    }
    return { id, input, expected };
  });
}

describe("loader conformance table", () => {
  const cases = buildCases();
  it("locks every case in conformance/loader-cases.json", () => {
    if (UPDATE) {
      writeFileSync(LOCK, `${JSON.stringify({ cases }, null, 1)}\n`);
      return;
    }
    expect(existsSync(LOCK)).toBe(true);
    const lock = JSON.parse(readFileSync(LOCK, "utf8")) as { cases: Case[] };
    expect(lock.cases.map((c) => c.id)).toEqual(cases.map((c) => c.id));
    for (const [i, c] of cases.entries()) expect({ id: c.id, expected: c.expected }).toEqual({ id: lock.cases[i].id, expected: lock.cases[i].expected });
  });
});
