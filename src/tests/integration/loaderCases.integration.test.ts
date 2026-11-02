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

type Case = { id: string; input: unknown; expected: string; knownDivergence?: string };
type Any = Record<string, unknown>;

function base(mode: "classic" | "modern"): Any {
  const sim = Simulation.newGame(7, mode);
  sim.money = 1e8;
  // Small on purpose: the table carries the whole save per case. Every
  // placement is asserted so the base topology the cases describe cannot
  // quietly drift and regenerate a lock that passes for the wrong reason.
  const must = (what: string, r: { ok: boolean; reason?: string }) => {
    if (!r.ok) throw new Error(`base(${mode}): ${what} failed: ${r.reason ?? "refused"}`);
  };
  for (let x = 170; x < 192; x++) must(`lobby @1,${x}`, sim.build("lobby", 1, x));
  for (let fl = 2; fl <= 3; fl++) for (let x = 171; x < 191; x++) must(`floor @${fl},${x}`, sim.build("floor", fl, x));
  must("office @2,172", sim.build("office", 2, 172));
  must("office @2,181", sim.build("office", 2, 181));
  must("condo @3,172", sim.build("condo", 3, 172));
  must("elevator @171", sim.buildTransport("elevatorStandard", 171, 1, 3));
  must("stairs @189", sim.buildTransport("stairs", 189, 1, 2));
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

/** A deliberately hand-edited Classic express shaft crossing the basement.
 * The TDT import writes the marker; older .vctower saves omit it. */
function basementExpress(seed: Any, marker: unknown, skips: number[]): Any {
  return mutate(seed, (s) => {
    const shaft = transports(s)[0];
    shaft.kind = "elevatorExpress";
    shaft.width = 6;
    shaft.bottom = -3;
    shaft.top = 3;
    shaft.carPositions = [-3];
    shaft.skipFloors = skips;
    if (marker === undefined) delete shaft.preserveBasementStops;
    else shaft.preserveBasementStops = marker;
  });
}

function units(s: Any): Any[] { return s.units as Any[]; }
function transports(s: Any): Any[] { return s.transports as Any[]; }

function buildCases(): Case[] {
  const modern = base("modern");
  const classic = base("classic");
  const inputs: [string, Any][] = [
    ["modern-roundtrip", modern],
    ["exterminator-booked-ids", mutate(modern, (s) => { s.exterminationDueDay = 2; s.exterminationRoomIds = [1, 1, 2.5, "2", null, true, -1, 0, 2147483648, 3]; })],
    ["exterminator-invalid-list", mutate(modern, (s) => { s.exterminationDueDay = 2; s.exterminationRoomIds = "bad"; })],
    ["exterminator-null-list", mutate(modern, (s) => { s.exterminationDueDay = 2; s.exterminationRoomIds = null; })],
    ["exterminator-empty-list", mutate(modern, (s) => { s.exterminationDueDay = 2; s.exterminationRoomIds = []; })],
    ["exterminator-legacy-list-absent", mutate(modern, (s) => { s.exterminationDueDay = 2; })],
    ["exterminator-orphan-list", mutate(modern, (s) => { s.exterminationRoomIds = [1]; })],
    ["exterminator-classic-list", mutate(classic, (s) => { s.exterminationDueDay = 2; s.exterminationRoomIds = [1]; })],
    ["classic-roundtrip", classic],
    // #1567: explicit TDT basement-stop provenance is a shared save-loader
    // contract. Pin marked/unmarked, mixed, malformed and Modern branches.
    ["transport-classic-basement-imported-empty", basementExpress(classic, true, [])],
    ["transport-classic-basement-legacy-empty", basementExpress(classic, undefined, [])],
    ["transport-classic-basement-imported-mixed", basementExpress(classic, true, [-2, 2])],
    ["transport-classic-basement-marker-string", basementExpress(classic, "true", [])],
    ["transport-modern-basement-marker-ignored", basementExpress(modern, true, [])],
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
    // The port audit's loader edges: `loadState` runs for any truthy `events`
    // (a number resets the Santa year, the extra rng and the pending choice
    // like an empty object; `0` and `""` skip it), a fractional Santa year is
    // kept as it is, and so is a fractional blockbuster id.
    ["events-number", mutate(modern, (s) => { s.events = 7; })],
    ["events-zero", mutate(modern, (s) => { s.events = 0; })],
    ["events-array", mutate(modern, (s) => { s.events = [1]; })],
    ["events-santa-fractional", mutate(modern, (s) => { s.events = { lastSantaYear: 1.5, rngState: 9 }; })],
    ["blockbusters-fractional", mutate(modern, (s) => { s.blockbusters = [1.5, 1, 1, "x", 2.25]; })],
    ["vip-visit-day-fractional", mutate(modern, (s) => { s.vipVisitDay = -0.5; })],
    ["version-absent-v1-reflow", mutate(modern, (s) => { delete s.version; })],
    ["version-3", mutate(modern, (s) => { s.version = 3; })],
    ["vip-evaluated-without-visits", mutate(modern, (s) => { delete s.vipVisits; s.evaluatedTower = true; s.vipFavorable = true; })],
    ["next-id-zero", mutate(modern, (s) => { s.nextId = 0; })],
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
    ["unit-width-string", mutate(modern, (s) => { const u = units(s).find((x) => x.kind === "office")!; u.width = "4"; })],
    ["legacy-v1-width-string", mutate(modern, (s) => { delete s.version; const u = units(s).find((x) => x.kind === "office")!; u.width = "4"; })],
    ["schedule-nonfinite-tunables", mutate(modern, (s) => { transports(s)[0].schedule = { waitingCarResponse: -4, standardFloorDeparture: 1e9, activeCars: { weekday: Array(24).fill(1) } }; })],
    // A save taken at random state 0 reloads at 0 (#856): the constructor's
    // 0-to-1 mapping is for a new game only.
    ["seed-zero", mutate(modern, (s) => { s.seed = 0; })],
    ["seed-two-pow-32", mutate(modern, (s) => { s.seed = 4294967296; })],
    ["events-rngstate-zero", mutate(modern, (s) => { s.events = { ...(s.events as Any), rngState: 0 }; })],
    // Hand-edited values the game never writes (#858). Each field narrows to
    // the type the game writes it as, the way the Rust loader reads it.
    ["unit-occupants-fractional", mutate(modern, (s) => { const u = units(s).find((x) => x.kind === "office")!; u.occupants = 2.5; })],
    ["unit-occupants-huge", mutate(modern, (s) => { const u = units(s).find((x) => x.kind === "office")!; u.occupants = 1e300; })],
    ["transport-cardir-fractional", mutate(modern, (s) => { transports(s)[0].carDir = (transports(s)[0].carDir as number[]).map(() => 0.5); })],
    ["transport-cardir-huge", mutate(modern, (s) => { transports(s)[0].carDir = (transports(s)[0].carDir as number[]).map(() => -1e300); })],
    ["transport-cardir-above-one", mutate(modern, (s) => { transports(s)[0].carDir = (transports(s)[0].carDir as number[]).map(() => 2.5); })],
    ["transport-load-fractional", mutate(modern, (s) => { transports(s)[0].load = 2.5; })],
    ["transport-load-string", mutate(modern, (s) => { transports(s)[0].load = "x"; })],
    ["transport-load-absent", mutate(modern, (s) => { delete transports(s)[0].load; })],
    ["transport-load-huge", mutate(modern, (s) => { transports(s)[0].load = 1e300; })],
    ["transport-unknown-key", mutate(modern, (s) => { transports(s)[0].foo = 1; })],
    ["wedding-hall-number", mutate(modern, (s) => { s.builtWeddingHall = 1; })],
    ["wedding-hall-null", mutate(modern, (s) => { s.builtWeddingHall = null; })],
    ["tower-name-number", mutate(modern, (s) => { s.towerName = 5; })],
    ["tower-name-null", mutate(modern, (s) => { s.towerName = null; })],
    ["vip-favorable-number", mutate(modern, (s) => { s.vipFavorable = 1; })],
    ["evaluated-tower-number", mutate(modern, (s) => { s.evaluatedTower = 1; })],
    ["evaluated-tower-null", mutate(modern, (s) => { s.evaluatedTower = null; })],
    ["vip-visit-day-string", mutate(modern, (s) => { s.vipVisitDay = "3"; })],
    ["vip-visit-day-boolean", mutate(modern, (s) => { s.vipVisitDay = true; })],
    ["last-vip-nag-day-huge", mutate(modern, (s) => { s.lastVipNagDay = -1e300; })],
    ["last-vip-nag-day-negative-fraction", mutate(modern, (s) => { s.lastVipNagDay = -3.5; })],
    ["minutes-huge-extermination", mutate(modern, (s) => { s.minutes = 1e23; s.exterminationDueDay = 2; })],
    ["legacy-condo-state-number", mutate(modern, (s) => { delete s.mode; const u = units(s).find((x) => x.kind === "condo")!; Object.assign(u, { everOccupied: true, state: 5 }); delete u.rent; })],
    ["legacy-v1-geometry-string", mutate(modern, (s) => { delete s.version; const u = units(s).find((x) => x.kind === "office")!; u.floor = "2"; u.x = String(u.x); })],
    // The v1 checks' edges (#858): structure geometry as strings, a room at a
    // NaN column sorted between an overlapping pair, a two-story room at 2^53
    // floors (past FAR_COORD, 2^52; at 2^53 `f++` stops moving), and a
    // structure tile far wider than the lot.
    ["legacy-v1-structure-geometry-string", mutate(modern, (s) => { delete s.version; const u = units(s).find((x) => x.kind === "floor" && x.floor === 2)!; u.floor = "2"; u.x = String(u.x); })],
    // A non-number room width, which the check reads as the catalog's (#858),
    // and structure tiles under a room's footprint with a string column, which
    // the reflow's paving reads as a number, or a string width, read as 1 (#858).
    ["legacy-v1-room-width-nonnum-left", mutate(modern, (s) => { delete s.version; const [a, b] = units(s).filter((x) => x.kind === "office"); b.width = "abc"; b.x = (a.x as number) - 3; })],
    ["legacy-v1-structure-x-string-paved", mutate(modern, (s) => { delete s.version; units(s).find((x) => x.kind === "floor" && x.floor === 2 && x.x === 175)!.x = "175"; })],
    ["legacy-v1-structure-width-string-paved", mutate(modern, (s) => { delete s.version; const us = units(s); const at = us.findIndex((x) => x.kind === "floor" && x.floor === 2 && x.x === 175); if (at < 0) throw new Error("no floor tile at 2:175"); us.splice(at, 1); us.find((x) => x.kind === "floor" && x.floor === 2 && x.x === 174)!.width = "2"; })],
    ["legacy-v1-x-nan", mutate(modern, (s) => { delete s.version; const [a, b] = units(s).filter((x) => x.kind === "office"); b.x = (a.x as number) + 1; units(s).splice(units(s).indexOf(a) + 1, 0, { ...a, id: 9003, x: "abc" }); })],
    ["legacy-v1-floor-far", mutate(modern, (s) => { delete s.version; const u = units(s).find((x) => x.kind === "office")!; u.kind = "cinema"; u.floor = 2 ** 53; })],
    // The narrow office tells the reflow (canon width 9) from the fallback (8).
    ["legacy-v1-tile-width-huge", mutate(modern, (s) => { delete s.version; units(s).find((x) => x.kind === "lobby")!.width = 1e8; units(s).find((x) => x.kind === "office")!.width = 8; })],
    // The reflow's edges (#858): a room column past FAR_COORD on either side
    // and a room width past it (left out of the reflow), rooms that keep a
    // saved footprint far off the lot on the right or the left (only lot
    // columns are paved), and a fractional nextId well above every id with a
    // room the reflow paves under (the second office moved up to the bare
    // fourth floor): the pads take ids from the floored nextId, where a
    // fractional id used to be renumbered from the highest id at load.
    ["legacy-v1-x-far", mutate(modern, (s) => { delete s.version; units(s).find((x) => x.kind === "office")!.x = 2 ** 53; })],
    ["legacy-v1-room-off-lot-wide", mutate(modern, (s) => { delete s.version; Object.assign(units(s).find((x) => x.kind === "office")!, { x: 400, width: 1e9 }); })],
    ["legacy-v1-room-off-lot-left", mutate(modern, (s) => { delete s.version; const [a, b] = units(s).filter((x) => x.kind === "office"); Object.assign(a, { x: -(2 ** 51), width: 2 ** 51 + 9 }); b.x = 400; })],
    ["legacy-v1-x-far-negative", mutate(modern, (s) => { delete s.version; units(s).find((x) => x.kind === "office")!.x = -(2 ** 53); })],
    ["legacy-v1-width-far", mutate(modern, (s) => { delete s.version; units(s).find((x) => x.kind === "office")!.width = 2 ** 53; })],
    ["legacy-v1-next-id-fractional", mutate(modern, (s) => { delete s.version; s.nextId = (s.nextId as number) + 100.5; units(s).filter((x) => x.kind === "office")[1].floor = 4; })],
    // Two more reflow rules (#858), each of which would discard the reflow
    // without it: a room at 2^52 floors is left out of the reflow's checks,
    // and the support envelope counts a lobby far wider than the lot as the
    // lot's 375 columns, as the floating count does (counted wider, the two
    // disagree about the floor-2 tiles at columns 300 to 302, past the
    // lobby's capped end). The kept reflow shows in the loaded nextId (901
    // and 913).
    ["legacy-v1-room-floor-far-reflowed", mutate(modern, (s) => { delete s.version; units(s).push({ id: 900, kind: "office", floor: 2 ** 52, x: 172, width: 3, state: "vacant" }); })],
    ["legacy-v1-lobby-wider-than-lot-reflowed", mutate(modern, (s) => {
      delete s.version;
      units(s).push({ id: 908, kind: "lobby", floor: 1, x: -100, width: 1000 });
      for (let i = 0; i < 3; i++) units(s).push({ id: 910 + i, kind: "floor", floor: 2, x: 300 + i, width: 1 });
      units(s).push({ id: 909, kind: "office", floor: 2, x: 300, width: 3, state: "vacant" });
    })],
    // A pending message that is not a string reads as none (#858). The state
    // view leaves the message out as prose, so the native Rust replay passes
    // whatever these two read as; the WASM test's canonical saves
    // (`conformanceWasmSaves`) and the unit tests in both engines pin them.
    ["pending-message-array", mutate(modern, (s) => { s.events = { ...(s.events as Any), pending: { kind: "bombThreat", cost: 300000, message: [1, 2] } }; })],
    ["pending-message-huge-number", mutate(modern, (s) => { s.events = { ...(s.events as Any), pending: { kind: "fireRescue", cost: 300000, message: 1e21 } }; })],
  ];
  // A divergence the engines have not settled yet, carried with a marker so
  // the Rust test expects the mismatch and flags the day a case stops
  // diverging. None is open: #858 settled the last two.
  const known: [string, Any, string][] = [];
  const hashOf = (input: unknown): string => {
    try {
      return digest(stateView(Simulation.deserialize(input as unknown as SerializedGame)));
    } catch {
      return "throws";
    }
  };
  return [
    ...inputs.map(([id, input]): Case => ({ id, input, expected: hashOf(input) })),
    ...known.map(([id, input, knownDivergence]): Case => ({ id, input, expected: hashOf(input), knownDivergence })),
  ];
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
    // The inputs are compared too, so a change to the base save (a new
    // serialized field, a different first day) cannot leave the Rust side
    // replaying a stale input under an unchanged hash.
    for (const [i, c] of cases.entries()) {
      expect({ id: c.id, expected: c.expected, input: digest(c.input), knownDivergence: c.knownDivergence })
        .toEqual({ id: lock.cases[i].id, expected: lock.cases[i].expected, input: digest(lock.cases[i].input), knownDivergence: lock.cases[i].knownDivergence });
    }
  });

  it("separates marked imported basement stops from unmarked legacy and Modern coercion", () => {
    const byId = (id: string) => {
      const entry = cases.find((c) => c.id === id);
      expect(entry, id).toBeDefined();
      expect(entry!.expected, id).not.toBe("throws");
      return entry!.expected;
    };
    const marked = byId("transport-classic-basement-imported-empty");
    expect(marked).not.toBe(byId("transport-classic-basement-legacy-empty"));
    expect(marked).not.toBe(byId("transport-classic-basement-imported-mixed"));
    expect(byId("transport-classic-basement-marker-string")).toBe(byId("transport-classic-basement-legacy-empty"));
    expect(byId("transport-modern-basement-marker-ignored")).not.toBe(marked);
  });

  // The billed-room cases (#902) where the loader ignores or empties the list
  // agree with their plain counterparts, so the Rust replay, which matches
  // every hash, agrees on them too.
  it("loads an ignored billed-room list as no list, and every list that authorizes no room alike", () => {
    /** A case's hash, refusing a missing id and a save that does not load,
     *  either of which would make two hashes agree for the wrong reason. */
    const hash = (id: string): string => {
      const found = cases.find((c) => c.id === id);
      if (!found) throw new Error(`no loader case ${id}`);
      expect(found.expected, id).not.toBe("throws");
      return found.expected;
    };
    expect(hash("exterminator-orphan-list")).toBe(hash("modern-roundtrip"));
    expect(hash("exterminator-classic-list")).toBe(hash("classic-roundtrip"));
    expect(hash("exterminator-null-list")).toBe(hash("exterminator-invalid-list"));
    expect(hash("exterminator-empty-list")).toBe(hash("exterminator-invalid-list"));
    expect(hash("exterminator-invalid-list")).not.toBe(hash("exterminator-legacy-list-absent"));
    expect(hash("exterminator-booked-ids")).not.toBe(hash("exterminator-empty-list"));
  });
});
