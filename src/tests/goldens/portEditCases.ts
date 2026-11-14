import { resolve } from "node:path";
import type { EnginePort } from "../../simport/enginePort";
import { scheduleSlots } from "../../simport/scheduleSlots";
import { canonicalJson } from "../conformance/canonical";
import { dumpRoot, type FrameDayStart } from "./frameDays";
import { stopsAtBoth } from "./portEditCrowd";
import type { PortEditLine } from "./portEditLines";
import { PortEditSession, type PortEditLeg } from "./portEdits";

/**
 * The port-edit golden's cases (`portEdits.ts`). Each stands for one test of
 * `dualRunEdits` or `dualRunBrush`, with the host edits the mirror relayed
 * sent as the port commands the game sends instead; the coverage map in
 * `_bmad-output/implementation-artifacts/story-dual-run-goldens.md` names
 * the test each case stands for, and where the mirror-only tests went.
 */

export interface PortEditCase {
  readonly id: string;
  readonly start: FrameDayStart;
  readonly script: (s: PortEditSession) => void;
}

/** The port's boolean arguments, named at the call. */
const SELL = false; // demolish: sell, as against bulldoze
export const BULLDOZE = true;
const ADD_CAR = true; // changeCars: add, as against remove
const REMOVE_CAR = false;
const TOP = true; // extendShaft: move the top end, as against the bottom
const BOTTOM = false;
const SKIP_FLOOR = false; // markStop: the floor's stop off
const ONLY_DEFAULT_PRICED = true; // rentBatch: leave custom prices alone
const AUTO_BRIDGE_ON = true;
/** Five-minute steps the four-star case may play while it waits for the
 *  escalator to carry someone (a game day is 288 of them). */
const ESCALATOR_WAIT_STEPS = 288;

const span = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => from + i);

/** Whether a drag's answer moved the shaft's top to `top` and no money, as
 *  a wiggle inside the drag mark does (#990). */
const isFree = (answer: Record<string, number | string>, top: number) => answer.top === top && answer.delta === 0;

/** Whether a drag's answer moved the shaft's top to `top` and paid for what
 *  it added. */
const isBilled = (answer: Record<string, number | string>, top: number) => answer.top === top && typeof answer.delta === "number" && answer.delta < 0;

/** A save's text as the game stores it, with the two stamp keys every
 *  write adds (`stampText` in `src/storage/saveStamp.ts`), so `loadSave`
 *  takes it as no founder's tower. The values are fixed (a "dev" build at
 *  time 0), so every run loads the same text. */
const storedText = (text: string) => JSON.stringify({ ...(JSON.parse(text) as object), savedAt: 0, appVersion: "dev" });

const found = (seed: number, mode: "classic" | "modern"): FrameDayStart => ({ kind: "found", seed, mode, calendar: "realWorld", unbridged: false });

/** Lay one tile of `kind` at each x of a floor, one command per tile, as a
 *  player's clicks do; every tile must land. */
function buildRow(s: PortEditSession, kind: string, floor: number, xs: readonly number[]): void {
  const code = s.kind(kind);
  for (const x of xs) s.done(`build ${kind} at floor ${floor}, x ${x}`, "buildAt", code, floor, x);
}

/** The four-star tower under a player's hands (`dualRunEdits`' first test):
 *  the tool and card commands the dual run sent (and the card's express
 *  stops, which it did not), a broke press, labels and the tower's name,
 *  the camera, a sale and two bulldozes and the hour played after them, a
 *  sale and a bulldoze on the game's undo trail, stepped back and forward,
 *  hours of play around them, and an earlier save restored. */
function fourStarEdits(s: PortEditSession): void {
  s.play(90);

  s.done("build an office at floor 58, x 120", "buildAt", s.kind("office"), 58, 120);
  buildRow(s, "floor", 58, span(129, 136));
  s.done("build stairs at x 130 from floor 57 to 58", "buildShaft", s.kind("stairs"), 130, 57, 58);
  s.done("show blockbusters at the cinema", "setFilm", s.unitAt(10, 240), s.code("filmPolicies", "blockbuster"), 0);
  s.done("reroll the shop", "rerollUnit", s.unitAt(13, 238));
  const office = s.unitAt(2, 150);
  s.done("set the office's rent to 10000", "setRent", office, 10000);
  s.done("raise the office's rent a step", "stepRent", office, 1);
  s.done("cut the office's rent a step", "stepRent", office, -1);
  s.done("set No Rate on the office at floor 2, x 159", "noRate", s.unitAt(2, 159));
  s.done("price the default-priced single rooms at 160", "rentBatch", s.kind("hotelSingle"), 160, ONLY_DEFAULT_PRICED);
  s.refused("book the exterminator with no infestation", "bookExterminator");
  s.done("log a good line", "logLine", "Edited by hand", s.code("logKinds", "good"));

  // The shaft card's edits, each charged by the engine. The shaft holds all
  // eight cars, so the remove makes room for the add.
  const shaft = s.shaftAt(30, 196).id;
  s.require("the shaft held all eight cars", s.done("remove a car", "changeCars", shaft, REMOVE_CAR).cars === 7);
  s.done("add a car", "changeCars", shaft, ADD_CAR);
  s.done("remove another car", "changeCars", shaft, REMOVE_CAR);
  // The dual run's host wrote the money directly here and after the shaft
  // edits (+1000, then -5000), and its mirror relayed both as `setMoney`.
  s.setMoney(s.money() + 1000);
  const skipped = (): string => [...(s.shaftAt(30, 196).skipFloors ?? [])].sort((a, b) => a - b).join(" ");
  s.done("skip floor 35", "markStop", shaft, 35, SKIP_FLOOR);
  s.require("the shaft skips floor 35 alone", skipped() === "35");
  const schedule = scheduleSlots({ activeCars: { weekday: Array<number>(24).fill(2), weekend: Array<number>(24).fill(1) } });
  s.done("run 2 cars on weekdays and 1 on weekends", "scheduleShaft", shaft, schedule);
  s.done("raise the bottom to floor 31", "extendShaft", shaft, BOTTOM, 31);
  s.done("lower the bottom back to floor 30", "extendShaft", shaft, BOTTOM, 30);
  s.done("move the top to floor 47", "extendShaft", shaft, TOP, 47);
  // Express stops keep both ends of a shaft and every lobby between them,
  // and skip the rest. The express shaft already stops that way, so the
  // edit would move nothing there. This shaft now runs from lobby 30 to
  // floor 47, which is no lobby, past lobby 45, so an engine that skipped
  // an end or a lobby between them would skip a floor the list keeps. The
  // clear brings every floor back.
  const { bottom, top: shaftTop } = s.shaftAt(30, 196);
  const lobbies = s.lobbyFloors();
  const between = span(bottom + 1, shaftTop);
  s.require("the shaft's top is no lobby, and a lobby lies between its ends", !lobbies.has(shaftTop) && between.some((f) => lobbies.has(f)));
  s.done("set express stops on the elevator", "expressStops", shaft);
  s.require("the express stops skip every floor between the shaft's ends but its lobbies", skipped() === between.filter((f) => !lobbies.has(f)).join(" "));
  s.done("clear the stops", "dropStops", shaft);
  s.require("the clear skips no floor", skipped() === "");
  s.setMoney(s.money() - 5000);

  // A billed drag: out two floors, back one (free), out again inside the
  // engine-held mark (#990).
  const top = s.shaftAt(30, 196).top;
  s.done("start a drag", "startExtend", shaft);
  s.require("the drag out is billed", isBilled(s.done("drag the top up two floors", "extendShaft", shaft, TOP, top + 2), top + 2));
  s.require("the drag back is free", isFree(s.done("drag it back one", "extendShaft", shaft, TOP, top + 1), top + 1));
  s.require("the drag out again inside the mark is free", isFree(s.done("drag it up again", "extendShaft", shaft, TOP, top + 2), top + 2));
  s.done("end the drag", "stopExtend");

  const money = s.money();
  s.setMoney(0);
  s.refused("extend with no money", "extendShaft", shaft, TOP, top + 3);
  s.refused("add a car with no money", "changeCars", shaft, ADD_CAR);
  s.setMoney(money);

  s.done("label the office", "labelUnit", office, "  Corner suite ");
  s.read("the office's label", (p) => p.unitLabel(office));
  // A name cut through an emoji: both engines hold U+FFFD for the half (#936).
  s.done("label the office with half an emoji", "labelUnit", office, "Corner " + String.fromCharCode(0xd83c));
  s.read("the office's label", (p) => p.unitLabel(office));
  s.require("the half emoji reads back as U+FFFD", s.port.unitLabel(office) === "Corner \uFFFD");
  s.done("name the tower", "nameTower", "Dual Run Tower");
  s.read("the tower's name", (p) => p.towerName());
  s.done("move the camera", "setCamera", 180, 12, 1.5);
  s.readJson("the camera", (p) => p.view());
  s.play(60);
  // Riders keep to their cars (3.7.3), so the crowd's rush can leave nobody
  // on the escalator for a while: play on in short steps until someone walks
  // to it and someone is midway on a route that never takes it, as the
  // checks below need.
  const escalator = s.shaftAt(1, 234).id;
  for (let wait = 0; wait < ESCALATOR_WAIT_STEPS && !(s.walkingTo(escalator).length > 0 && s.midRouteAvoiding(escalator).length > 0); wait++) {
    s.play(5);
  }

  s.done("clear the tower's name", "nameTower", null);
  s.read("the tower's name", (p) => p.towerName());
  s.done("clear the office's label", "labelUnit", office, "   ");
  s.read("the office's label", (p) => p.unitLabel(office));

  // A sale and two bulldozes outside any undo step, and the hour after
  // them, which both engines must agree on: the dual run played on after
  // selling a room and bulldozing a link. The escalator is one the crowd
  // rides. Nobody keeps walking to a shaft that went from under them
  // (#2186): someone still setting out turns back, someone partway finds
  // another route, and only someone with no way on leaves the picture, so
  // after the first frame of the hour's play that moves the clock nobody
  // is walking to it. That frame can carry a person to the end of a leg whether or not
  // the escalator is there, so the check leaves out anyone already on it,
  // and it requires that the people midway on a route that never takes it
  // all stay. Of the people who set out after the bulldoze and are still in
  // the crowd at the hour's end, some go between its floors, each by a link
  // that stops at both floors and none by the escalator.
  s.done("sell the office at floor 2, x 150", "demolish", s.unitAt(2, 150), SELL);
  s.require("the sale takes the office out", !s.hasUnitAt(2, 150));
  s.done("bulldoze the shop at floor 13, x 238", "demolish", s.unitAt(13, 238), BULLDOZE);
  s.require("the bulldoze takes the shop out", !s.hasUnitAt(13, 238));
  const link = s.shaftAt(1, 234);
  s.require("the link at floor 1, x 234 is an escalator", link.kind === "escalator");
  const walking = s.walkingTo(link.id);
  s.require("people are walking to the escalator", walking.length > 0);
  const midway = s.midRouteAvoiding(link.id);
  s.require("some people are midway on a route that never takes the escalator", midway.length > 0);
  s.done("bulldoze the escalator at floor 1, x 234", "demolish", link.id, BULLDOZE);
  s.require("the bulldoze takes the escalator out", s.findShaft(1, 234) === undefined);
  const since = s.markPeople();
  const afterBulldoze = s.personIds();
  s.require("the bulldoze leaves the people walking to it to the frame loop", walking.every((id) => afterBulldoze.has(id)));
  const [firstMove, stillWalking] = s.playReadingFirstMoveOf(60, () => [s.personIds(), s.walkingTo(link.id)] as const);
  s.require("the first frame that moves the clock leaves nobody walking to the escalator", !walking.some((id) => stillWalking.includes(id)));
  s.require("the first frame that moves the clock keeps the people midway on a route that never takes the escalator", midway.every((id) => firstMove.has(id)));
  const links = s.shaftsBetween(link.bottom, link.top, since);
  const stopsAtItsFloors = (id: number): boolean => stopsAtBoth(s.shaftById(id), link.bottom, link.top);
  s.require("someone who set out after the bulldoze goes between its floors", links.length > 0);
  s.require("each of their legs between its floors takes a link that stops at both floors, and none the escalator", [...new Set(links)].every(stopsAtItsFloors) && !links.includes(link.id));

  // A sale and a bulldoze as the tools send them, each its own undo step;
  // the lobby is refused and keeps no step.
  const saved = s.port.serialize();
  const savedAt = s.minute();
  const sold = s.unitAt(58, 120);
  s.capture("Sell");
  s.done("sell the new office", "demolish", sold, SELL);
  s.commit("close the sale's undo step");
  const stairs = s.shaftAt(58, 130).id;
  s.capture("Bulldoze");
  s.done("bulldoze the stairs", "demolish", stairs, BULLDOZE);
  s.commit("close the bulldoze's undo step");
  s.capture("Bulldoze");
  s.refused("bulldoze the lobby at floor 1, x 180", "demolishTile", 1, 180, BULLDOZE);
  s.commit("close the refused bulldoze's undo step");
  s.history("undo the bulldoze", "undo", "done");
  s.require("the undo puts the stairs back", s.findShaft(58, 130) !== undefined);
  s.history("redo the bulldoze", "redo", "done");
  s.require("the redo takes the stairs out again", s.findShaft(58, 130) === undefined);
  s.history("undo the bulldoze again", "undo", "done");
  s.history("undo the sale", "undo", "done");
  s.require("the undo puts the office back", s.hasUnitAt(58, 120));
  s.history("undo with nothing left", "undo", "nothingToStep");
  s.history("redo the sale", "redo", "done");
  s.history("redo the bulldoze again", "redo", "done");
  s.require("the redo takes the stairs out once more", s.findShaft(58, 130) === undefined);
  s.play(60);

  // The history source: an earlier save comes back whole, the clock with it,
  // and the live camera stays.
  s.done("move the camera again", "setCamera", 200, 20, 1);
  s.restore("restore the save from before the sale", saved);
  s.require("the restore puts the office and the stairs back", s.hasUnitAt(58, 120) && s.findShaft(58, 130) !== undefined);
  s.require("the restore brings its clock back", s.minute() === savedAt);
  const camera = s.readJson("the camera after the restore", (p) => p.view());
  s.require("the restore keeps the live camera", canonicalJson(camera) === canonicalJson({ tile: 200, floor: 20, zoom: 1 }));
  s.history("undo after the restore", "undo", "nothingToStep");
  s.play(120);
}

/** A founded game edited before play (`dualRunEdits`' second test), played
 *  across the first day boundary. */
function foundedThenEdited(s: PortEditSession): void {
  s.setMoney(1e9);
  buildRow(s, "lobby", 1, span(170, 200));
  s.done("name the tower", "nameTower", "Founded then edited");
  s.tick(1);
  s.play(26 * 60);
}

/** The Modern bridging toggle (`dualRunEdits`' third test): the toggle, and
 *  the choice set directly (the dual run wrote it as an undo's restore did). */
function modernBridging(s: PortEditSession): void {
  s.setMoney(1e9);
  buildRow(s, "lobby", 1, span(170, 210));
  s.done("turn auto-bridging off", "flipAutoBridge");
  s.done("build an office at floor 2, x 180", "buildAt", s.kind("office"), 2, 180);
  s.done("choose auto-bridging", "chooseAutoBridge", AUTO_BRIDGE_ON);
  s.read("auto-bridging", (p) => p.autoBridge());
  s.done("build an office at floor 2, x 195", "buildAt", s.kind("office"), 2, 195);
  s.play(180);
}

/** A tower with a lobby and floors up to `top` from x 170 to 199, and a
 *  standard elevator at x 172 from floor 1 up to `top`. */
function liftTower(s: PortEditSession, top: number): number {
  s.setMoney(1e9);
  buildRow(s, "lobby", 1, span(170, 200));
  for (let floor = 2; floor <= top; floor++) buildRow(s, "floor", floor, span(170, 200));
  s.done(`build a standard elevator at x 172 from floor 1 to ${top}`, "buildShaft", s.kind("elevatorStandard"), 172, 1, top);
  return s.shaftAt(1, 172).id;
}

/** Malformed charge commands (#923, `dualRunEdits`' fourth test), then the
 *  engine-held drag mark (#990): a wiggle inside it is free, and once it
 *  closes, or a refused start drops it, a shrink and regrow is billed. */
function malformedCharges(s: PortEditSession): void {
  const lift = liftTower(s, 2);
  s.refused("add a car to a fractional id", "changeCars", lift + 0.5, ADD_CAR);
  s.refused("remove a car from a NaN id", "changeCars", NaN, REMOVE_CAR);
  s.refused("extend to a fractional floor", "extendShaft", lift, TOP, 3.5);
  s.refused("extend a fractional id", "extendShaft", lift + 0.5, TOP, 3);
  s.refused("sell a fractional id", "demolish", lift - 0.5, SELL);
  s.done("add a car", "changeCars", lift, ADD_CAR);
  s.done("extend to floor 4 with no drag open", "extendShaft", lift, TOP, 4);
  for (const [what, bad] of [
    ["a fractional id", lift + 0.5],
    ["a NaN id", NaN],
  ] as const) {
    s.refused(`start a drag on ${what}`, "startExtend", bad);
    s.done("shrink to floor 3", "extendShaft", lift, TOP, 3);
    s.require("a regrow with no drag open is billed", isBilled(s.done("regrow to floor 4, billed", "extendShaft", lift, TOP, 4), 4));
  }
  s.done("start a drag", "startExtend", lift);
  s.require("the drag out is billed", isBilled(s.done("drag to floor 6", "extendShaft", lift, TOP, 6), 6));
  s.require("the drag back is free", isFree(s.done("drag back to floor 5", "extendShaft", lift, TOP, 5), 5));
  s.require("the regrow inside the mark is free", isFree(s.done("drag to floor 6 again, free", "extendShaft", lift, TOP, 6), 6));
  s.refused("start a drag on a NaN id with one open", "startExtend", NaN);
  s.done("shrink to floor 5", "extendShaft", lift, TOP, 5);
  s.require("a refused start drops the drag, so the regrow is billed", isBilled(s.done("regrow to floor 6, billed", "extendShaft", lift, TOP, 6), 6));
  s.done("start a drag", "startExtend", lift);
  s.done("end the drag", "stopExtend");
  s.done("shrink to floor 5", "extendShaft", lift, TOP, 5);
  s.require("a regrow after the drag closed is billed", isBilled(s.done("regrow to floor 6, billed", "extendShaft", lift, TOP, 6), 6));
  s.play(60);
}

/** The bad values for an argument whose good value is `good`: a fraction
 *  that truncates to it (so an engine that truncated would land the edit),
 *  NaN, and 2^53, past the safe integers. */
const badValues = (good: number) =>
  [
    [String(good + 0.5), good + 0.5],
    ["NaN", NaN],
    ["2^53", 2 ** 53],
  ] as const;

/** Malformed edits (#996, `dualRunEdits`' sixth test): each refused before
 *  anything moves, then the same edits, well formed, land (the tile sale
 *  from the floor's end, since Classic refuses a gap in the middle). */
function malformedEdits(s: PortEditSession): void {
  const lift = liftTower(s, 3);
  s.done("build an office at floor 2, x 180", "buildAt", s.kind("office"), 2, 180);
  const office = s.unitAt(2, 180);
  const schedule = scheduleSlots({ activeCars: { weekday: Array<number>(24).fill(1) } });
  for (const [what, bad] of badValues(3)) s.refused(`sell the tile at floor ${what}, x 180`, "demolishTile", bad, 180, SELL);
  for (const [what, bad] of badValues(lift)) {
    s.refused(`add a car to id ${what}`, "changeCars", bad, ADD_CAR);
    s.refused(`extend id ${what}`, "extendShaft", bad, TOP, 2);
    s.refused(`schedule id ${what}`, "scheduleShaft", bad, schedule);
  }
  for (const [what, bad] of badValues(2)) {
    s.refused(`move the top to floor ${what}`, "extendShaft", lift, TOP, bad);
    s.refused(`skip floor ${what}`, "markStop", lift, bad, SKIP_FLOOR);
  }
  for (const [what, bad] of badValues(1)) s.refused(`step the rent by ${what}`, "stepRent", office, bad);
  s.refused("step the rent by 2 (a step is 1 or -1)", "stepRent", office, 2);
  for (const [what, bad] of badValues(office)) s.refused(`set No Rate on id ${what}`, "noRate", bad);

  s.done("add a car", "changeCars", lift, ADD_CAR);
  s.done("skip floor 2", "markStop", lift, 2, SKIP_FLOOR);
  s.done("schedule the elevator", "scheduleShaft", lift, schedule);
  s.done("raise the rent a step", "stepRent", office, 1);
  s.done("set No Rate on the office", "noRate", office);
  // Classic keeps a floor whole (owner ruling, 2026-11-12): a tile with floor
  // on both sides stays, and the floor comes out from its end.
  s.refused("sell the tile at floor 3, x 180, floor on both sides", "demolishTile", 3, 180, SELL);
  s.done("sell the tile at floor 3, x 199, the floor's end", "demolishTile", 3, 199, SELL);
  s.done("move the top to floor 2", "extendShaft", lift, TOP, 2);
  s.play(60);
}

/** The floor and lobby brush (`dualRunBrush`' first test): floors laid in
 *  runs, a sky lobby over plain floor with a repeated column, a bare tile on
 *  supported ground and a tile with nothing under it, then malformed brushes
 *  that lay nothing. */
function brush(s: PortEditSession): void {
  s.setMoney(1e9);
  const floor = s.kind("floor");
  const paint = (want: "done" | "refused", step: string, kind: number, fl: number, tiles: readonly number[]) =>
    want === "done" ? s.done(step, "paintTiles", kind, fl, Float64Array.from(tiles)) : s.refused(step, "paintTiles", kind, fl, Float64Array.from(tiles));
  // A brush that lays only some of its tiles is still done, so each run
  // checks that it laid them all.
  const run = (step: string, fl: number, tiles: readonly number[]) => s.require(`${step} lays all ${tiles.length} tiles`, paint("done", step, floor, fl, tiles).placed === tiles.length);
  for (let fl = 1; fl <= 14; fl++) {
    run(`brush floor ${fl} from x 170 to 201`, fl, span(170, 202));
    run(`brush floor ${fl} from x 202 to 205`, fl, span(202, 206));
  }
  run("brush floor 15 from x 170 to 199", 15, span(170, 200));
  const lobby = paint("done", "brush a lobby on floor 15", s.kind("lobby"), 15, [199, 203, 198, 175, 200, 198, 210, 180]);
  s.require("the lobby brush lays 5 of its tiles", lobby.placed === 5);
  paint("refused", "brush an office", s.kind("office"), 15, [180]);
  paint("refused", "brush a NaN kind", NaN, 16, [180]);
  paint("refused", "brush floor 16.5", floor, 16.5, [180]);
  paint("refused", "brush a NaN floor", floor, NaN, [180]);
  paint("refused", "brush a fractional tile", floor, 16, [180.5]);
  paint("refused", "brush a NaN tile", floor, 16, [NaN]);
  paint("refused", "brush 33 tiles", floor, 16, span(150, 183));
  s.play(120);
}

/** The brush on a tower loaded from its save (`dualRunBrush`' second test,
 *  without the raw binding calls): a brush on floor -0.5 refused (its
 *  integer part is a floor that takes a tile), a tile under the lobby, and
 *  a lobby over plain floor beside a tile with nothing under it. */
function brushOnLoadedTower(s: PortEditSession): void {
  s.setMoney(1e9);
  buildRow(s, "lobby", 1, span(150, 160));
  for (let fl = 2; fl <= 15; fl++) buildRow(s, "floor", fl, span(150, 154));
  s.loadSave("load the tower from its stored save", storedText(s.port.serialize()));
  s.require("a stamped save loads as no founder's tower", !s.port.founder());
  s.setMoney(1e9);
  // -0.5 truncates to floor 0, which takes a tile at x 150, so an engine
  // that truncated the floor (as an integer cast does) would land it.
  s.refused("brush floor -0.5", "paintTiles", s.kind("floor"), -0.5, Float64Array.from([150]));
  s.done("brush a tile under the lobby", "paintTiles", s.kind("floor"), 0, Float64Array.from([150]));
  const lobby = s.done("brush a lobby on floor 15", "paintTiles", s.kind("lobby"), 15, Float64Array.from([151, 150, 170]));
  s.require("the lobby brush lays 2 of its tiles", lobby.placed === 2);
  s.play(60);
}

export const PORT_EDIT_CASES: readonly PortEditCase[] = [
  { id: "four-star tower edits", start: { kind: "fixture", file: "towerone-star4.vctower" }, script: fourStarEdits },
  { id: "founded Classic game edited before play", start: found(31, "classic"), script: foundedThenEdited },
  { id: "Modern auto-bridging", start: found(77, "modern"), script: modernBridging },
  { id: "malformed charge commands and the drag mark", start: found(9, "classic"), script: malformedCharges },
  { id: "malformed edits", start: found(11, "classic"), script: malformedEdits },
  { id: "the floor and lobby brush", start: found(5, "classic"), script: brush },
  { id: "the brush on a loaded tower", start: found(5, "classic"), script: brushOnLoadedTower },
];

const dumpDir = dumpRoot(process.env.VC_PORT_EDITS_DUMP);
const dumpCase = process.env.VC_PORT_EDITS_CASE;
if (dumpDir && !PORT_EDIT_CASES.some((c) => c.id === dumpCase)) {
  throw new Error(`VC_PORT_EDITS_DUMP needs VC_PORT_EDITS_CASE set to a case id; ${JSON.stringify(dumpCase)} names none`);
}

/** Run one case on one engine and return its lines. `afterStart` runs once,
 *  right after the start line, outside any step: the teeth test changes the
 *  tower there to show the next line catches it (such a run writes no
 *  dump). */
export function runPortEditCase(leg: PortEditLeg, c: PortEditCase, afterStart?: (port: EnginePort) => void): PortEditLine[] {
  const dump = dumpDir !== undefined && dumpCase === c.id && afterStart === undefined ? resolve(dumpDir) : undefined;
  const s = new PortEditSession(leg, c.id, c.start, dump);
  afterStart?.(s.port);
  c.script(s);
  return s.lines;
}
