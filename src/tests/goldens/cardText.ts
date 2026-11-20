import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { html } from "lit-html";
import { expect } from "vitest";
import { decodeVctower } from "../../storage/vctowerContainer";
import { packVctower } from "../../storage/vctowerWriter";
import { renderToFragment } from "../../ui/testing/litTestUtils";
import { writeGoldenFile } from "./updateGate";

/**
 * The card-text golden (#1806, #1561's canary): for each sweep case and mode,
 * the tower the case builds (a `.vctower` file) and the lines the reference
 * card prints for every room and shaft in it, in card order (a `.json` file).
 * `cardTextParity.integration.test.ts` loads each tower into the Rust engine
 * and holds the shipped card to those lines. The lines and towers came from
 * the TypeScript reference card and builders, whose referee held the golden to
 * them until #1875 deleted that engine.
 *
 * A refresh is a reviewed change, so a moved line shows in the diff:
 * `VC_CARD_TEXT_UPDATE=rust` makes the sweep write the lines from the Rust
 * card, keeping the towers, only once every test in its file ran and passed
 * (`updateGate.ts`). A new case, or a change to a committed tower, needs a
 * builder on the Rust engine.
 *
 * The cards format numbers for the reader's locale, and the golden holds the
 * US English text, so these suites refuse to run under another locale (the
 * first of `LC_ALL`, `LC_MESSAGES` and `LANG` that is set picks it).
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
export const CARD_TEXT_DIR = resolve(ROOT, "src/tests/goldens/card-text");

/** Numbers that show how a locale prints the cards' figures: a four-digit
 *  amount (which some locales leave ungrouped or group with a period or a
 *  space), the grouping and decimal mark of a large one (en-IN groups by
 *  lakh), and the minus sign. */
const LOCALE_SAMPLES = [4800, 1234567.5, -1200];
const localeText = LOCALE_SAMPLES.map((n) => n.toLocaleString()).join(" ");
const usText = LOCALE_SAMPLES.map((n) => n.toLocaleString("en-US")).join(" ");
if (localeText !== usText) {
  throw new Error(
    `the card-text golden holds US English numbers, and this locale prints ${usText} as ${JSON.stringify(localeText)}; run with LC_ALL=en_US.UTF-8`,
  );
}

export type CardTextMode = "classic" | "modern";
export const CARD_TEXT_MODES: readonly CardTextMode[] = ["classic", "modern"];

/** The states the every-kind cases put each room in. */
export const CARD_TEXT_STATES = ["empty", "occupied", "vacating", "construction", "fire", "gutted", "dirty"] as const;

/** The sweep's cases, by name, in the order it runs them. */
export const CARD_TEXT_CASES: readonly string[] = [
  "service rooms",
  "service rooms, unhappy",
  "retail venues",
  "retail venues, rainy day",
  "lobby distance",
  "lobby distance, unhappy",
  ...CARD_TEXT_STATES.map((st) => `every kind, ${st}`),
  "every transport",
  "crowded lift",
  "recycling center on notice",
  "recycling over capacity",
  "winning tower",
  "winning tower, unhappy",
];

/** The catalog kinds no case builds, each with the reason, so the sweep's
 *  kinds can be held to the engine's catalog and a new kind joins a case. */
export const CARD_TEXT_UNSWEPT_KINDS: ReadonlyMap<string, string> = new Map([
  ["floor", "a slab, which has no card of its own"],
  ["lobby", "a lobby tile, which has no card of its own"],
  ["weddingHall", "the hall needs a five-star tower, and no case's tower is one"],
]);

/** The catalog kinds missing from every case of `mode`, apart from the
 *  unswept ones, given each case's golden. */
export function kindsNoCaseBuilds(catalogKinds: readonly string[], goldens: readonly CardTextGolden[]): string[] {
  const built = new Set(goldens.flatMap((g) => [...g.units.map((u) => u.kind), ...g.transports.map((t) => t.kind)]));
  return catalogKinds.filter((k) => !built.has(k) && !CARD_TEXT_UNSWEPT_KINDS.has(k));
}

/** The variants ("lobby distance, unhappy") that print the same room and
 *  shaft lines as their plain case ("lobby distance") in the same mode, and
 *  so add no coverage. */
export function variantsPrintingAlike(goldens: readonly CardTextGolden[]): string[] {
  const text = (g: CardTextGolden) =>
    JSON.stringify([g.units.map((u) => [u.kind, u.floor, u.lines]), g.transports.map((t) => [t.kind, t.lines])]);
  return goldens.flatMap((v) => {
    const plain = goldens.find((g) => g.mode === v.mode && v.case.startsWith(`${g.case}, `));
    return plain && text(plain) === text(v) ? [`${v.mode}: ${v.case}`] : [];
  });
}

/** In-game minutes each card's engine plays after loading a case's tower and
 *  before the cards are read, in 10-minute ticks. A shaft's load line needs
 *  riders measured over time, and a save does not carry that measurement, so
 *  the every-transport case plays a morning on the loaded tower, and the
 *  crowded lift 35 hours, to its busiest reading. */
export const CARD_TEXT_PLAY_MINUTES: ReadonlyMap<string, number> = new Map([
  ["every transport", 8 * 60],
  ["crowded lift", 35 * 60],
]);
export const CARD_TEXT_TICK_MINUTES = 10;

/** The least load the crowded lift must read, in percent, by mode. A Modern
 *  car moves twice as fast (`MODERN_CAR_SPEED` in
 *  `engine-rs/src/rules/elevators.rs`), so the same riders fill it for about
 *  half as long, and a full Modern car passes the floors it has no room for
 *  instead of standing there full (`full_cars_pass_hall_calls`), so its
 *  average load reads well under half. Modern residents ride as people, so
 *  the dispatch's unseen estimate no longer boards the car with riders
 *  nobody draws, and it reads lower still (21% today). */
const CROWDED_LIFT_LEAST_LOAD: Readonly<Record<CardTextMode, number>> = { classic: 80, modern: 15 };
/** The engine's near-capacity line, in percent (`NEAR_CAPACITY_UTILIZATION`
 *  in `engine-rs/src/panels/elevators.rs`). */
const NEAR_CAPACITY_PERCENT = 85;

/** Play a case's minutes on an engine that has just loaded its tower. */
export function playCardTextCase(name: string, tick: (minutes: number) => void): void {
  const minutes = CARD_TEXT_PLAY_MINUTES.get(name) ?? 0;
  for (let t = 0; t < minutes; t += CARD_TEXT_TICK_MINUTES) tick(CARD_TEXT_TICK_MINUTES);
}

export interface CardTextRoom {
  readonly id: number;
  readonly kind: string;
  readonly floor: number;
  readonly lines: readonly string[];
}

export interface CardTextShaft {
  readonly id: number;
  readonly kind: string;
  readonly lines: readonly string[];
}

/** The pinned lines of one case in one mode. */
export interface CardTextGolden {
  readonly case: string;
  readonly mode: CardTextMode;
  readonly units: readonly CardTextRoom[];
  readonly transports: readonly CardTextShaft[];
}

/** The file name of a case, without its extension. */
export function cardTextSlug(mode: CardTextMode, name: string): string {
  return `${mode}-${name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")}`;
}

const pathOf = (mode: CardTextMode, name: string, ext: "json" | "vctower") =>
  resolve(CARD_TEXT_DIR, `${cardTextSlug(mode, name)}.${ext}`);

/** Every file the golden directory holds: a tower and its lines per case and
 *  mode. */
export const cardTextFiles = (): string[] =>
  CARD_TEXT_MODES.flatMap((mode) =>
    CARD_TEXT_CASES.flatMap((name) => [`${cardTextSlug(mode, name)}.json`, `${cardTextSlug(mode, name)}.vctower`]),
  );

/** Both cards printing nothing would also agree, so each case must have read
 *  real lines; this checks the lines a run is about to compare or write. */
export function expectRealLines(g: CardTextGolden): void {
  const label = `${g.mode}: ${g.case}`;
  // A check names each of its cases, so a renamed case fails here instead of
  // going unchecked.
  const is = (name: string): boolean => {
    if (!CARD_TEXT_CASES.includes(name))
      throw new Error(`expectRealLines checks "${name}", which is not a card-text case`);
    return g.case === name;
  };
  const isOneOf = (names: readonly string[]): boolean => names.map(is).some(Boolean);
  const roomLines = g.units.flatMap((u) => u.lines);
  const starting = (prefix: string): number => roomLines.filter((l) => l.startsWith(prefix)).length;
  if (!is("every transport")) expect(roomLines.length, `${label} compared no room lines`).toBeGreaterThan(0);
  if (is("lobby distance")) expect(starting("Shoppers:"), `${label}: the far shop must carry the warning`).toBe(1);
  if (is("retail venues, rainy day"))
    expect(starting("Rain might"), `${label}: no venue printed the rain line`).toBeGreaterThan(0);
  // The unhappy towers charge a top rent, so a tenant has a cause to gripe
  // about even where no worse cause (crowded elevators) comes first. The
  // unhappy service-room tower has a stairway to its rooms (built on the
  // loaded tower with the engine's `buildTransport`, #1816), so its office
  // gripes about the rent where the plain tower's unserved office prints
  // only its access line.
  if (isOneOf(["service rooms, unhappy", "lobby distance, unhappy", "winning tower, unhappy"]))
    expect(starting("Main gripe:"), `${label}: no tenant printed a gripe`).toBeGreaterThan(0);
  // The crowded lift runs close to full in Classic. Riders stay aboard to
  // their floors since 3.7.3, so its one car stops for each of them and its
  // load peaks past the engine's near-capacity line; the faster Modern car,
  // which passes floors while full, reads well under half. The card must word the load it reads, near capacity
  // only above 85%.
  if (is("crowded lift")) {
    const loads = g.transports.flatMap((t) => t.lines).filter((l) => l.startsWith("Avg load:"));
    const pct = Number(/^Avg load: (\d+)% full/.exec(loads[0] ?? "")?.[1] ?? Number.NaN);
    const least = CROWDED_LIFT_LEAST_LOAD[g.mode];
    expect(
      [loads.length, pct >= least],
      `${label}: the crowded lift reads one load, at least ${least}% full: ${JSON.stringify(loads)}`,
    ).toEqual([1, true]);
    // The card rounds the load, so a load just past the line prints as 85%.
    const near = loads[0].includes("Near capacity");
    expect(
      near ? pct >= NEAR_CAPACITY_PERCENT : pct <= NEAR_CAPACITY_PERCENT,
      `${label}: the card words a ${pct}% load`,
    ).toBe(true);
  }
  const centers = g.units.filter((u) => u.kind === "recycling").map((u) => u.lines);
  const fillOf = (lines: readonly string[]): number =>
    Number(/^Fill: (\d+)%/.exec(lines.find((l) => l.startsWith("Fill:")) ?? "")?.[1] ?? Number.NaN);
  // Capacity is the tower's verdict, so every center prints it: each center
  // as [its over-capacity lines, its demand-met lines, filling].
  const expectCenters = (over: number, what: string): void => {
    const count = (lines: readonly string[], line: RegExp): number => lines.filter((l) => line.test(l)).length;
    const seen = centers.map((lines) => [
      count(lines, /^Over capacity:/),
      count(lines, /^Capacity: .*; demand met\.$/),
      fillOf(lines) > 0,
    ]);
    expect([centers.length > 0, seen], `${label}: ${what}, ${JSON.stringify(centers)}`).toEqual([
      true,
      centers.map(() => [over, 1 - over, true]),
    ]);
  };
  if (is("recycling center on notice")) {
    // The order under test: the reference card puts the recycling block above the notice.
    const center = centers.find((lines) => lines.some((l) => l.startsWith("Giving notice:"))) ?? [];
    const [block, notice] = [
      center.findIndex((l) => l.startsWith("Fill:")),
      center.findIndex((l) => l.startsWith("Giving notice:")),
    ];
    expect([block >= 0, block < notice], `${label}: ${JSON.stringify(centers)}`).toEqual([true, true]);
  }
  if (is("recycling over capacity")) expectCenters(1, "over capacity and filling");
  if (is("winning tower")) expectCenters(0, "within capacity and filling");
  if (isOneOf(CARD_TEXT_STATES.map((st) => `every kind, ${st}`))) {
    // Room kinds only: the floor and lobby tiles are not cards.
    expect(new Set(g.units.map((u) => u.kind)).size, `${label} placed too few kinds`).toBeGreaterThanOrEqual(25);
  }
  if (is("every transport")) {
    expect(g.transports.length, `${label}: too few shafts`).toBeGreaterThanOrEqual(5);
    // After the morning's play each passenger elevator (standard and
    // express) prints one reading and one of them carried riders; the service
    // elevator, the stairs and the escalator print none.
    const loads = g.transports.flatMap((t) =>
      t.lines.flatMap((l) => /^Avg load: (\d+)%/.exec(l)?.[1] ?? []).map((n) => ({ kind: t.kind, load: Number(n) })),
    );
    expect(
      [loads.map((l) => l.kind).sort(), loads.some((l) => l.load > 0)],
      `${label}: the elevators' load lines, ${JSON.stringify(loads)}`,
    ).toEqual([["elevatorExpress", "elevatorStandard"], true]);
  }
}

/** A card's parts as the text a player reads, one entry per line. A problem
 *  line's Help link (#2036) is left out: it points at the manual and says no
 *  more than "Help", and src/game/portUnitDiagnostics.test.ts holds which
 *  lines carry one. */
export const textOf = (parts: readonly unknown[]): string[] =>
  parts
    .map((p) => {
      const frag = renderToFragment(html`${p}`);
      for (const link of frag.querySelectorAll("a.help-topic")) link.remove();
      return (frag.textContent ?? "").trim();
    })
    .filter(Boolean);

export function readCardTextGolden(mode: CardTextMode, name: string): CardTextGolden {
  return JSON.parse(readFileSync(pathOf(mode, name, "json"), "utf8")) as CardTextGolden;
}

/** The lines file: one room or shaft per line, so a refresh diffs by the room
 *  whose text moved. */
export function writeCardTextGolden(golden: CardTextGolden): void {
  const rows = (items: readonly object[]) => items.map((x) => `    ${JSON.stringify(x)}`).join(",\n");
  const units = golden.units.map((u) => ({ id: u.id, kind: u.kind, floor: u.floor, lines: u.lines }));
  const transports = golden.transports.map((t) => ({ id: t.id, kind: t.kind, lines: t.lines }));
  const text = `{\n  "case": ${JSON.stringify(golden.case)},\n  "mode": ${JSON.stringify(golden.mode)},\n  "units": [\n${rows(units)}\n  ],\n  "transports": [\n${rows(transports)}\n  ]\n}\n`;
  writeGoldenFile(pathOf(golden.mode, golden.case, "json"), text);
}

/** No app version and no save time: with no stamp the TypeScript (fflate)
 *  writer packs the file, so it does not depend on the engine package, and the
 *  same save packs to the same file in every build. */
const NO_STAMP = {};

/** A case's save text packed as its `.vctower` file is. */
export const packCardTextSave = (save: string): string => packVctower(save, new TextEncoder().encode(save), NO_STAMP);

/** The case's tower, written as a `.vctower` file. */
export function writeCardTextSave(mode: CardTextMode, name: string, save: string): void {
  writeGoldenFile(pathOf(mode, name, "vctower"), packCardTextSave(save));
}

/** The case's tower file as it is committed, for the engine's own reader. */
export function readCardTextFile(mode: CardTextMode, name: string): string {
  return readFileSync(pathOf(mode, name, "vctower"), "utf8");
}

/** The save text inside the case's committed tower file. */
export function readCardTextSave(mode: CardTextMode, name: string): string {
  const file = pathOf(mode, name, "vctower");
  return JSON.stringify(decodeVctower(readFileSync(file, "utf8"), file));
}
