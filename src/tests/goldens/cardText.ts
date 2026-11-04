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
 * and holds the shipped card to those lines; while the TypeScript engine
 * exists, `cardTextReferee.integration.test.ts` builds each case again and
 * holds the golden to the TypeScript reference card itself.
 *
 * A refresh is a reviewed change, so a moved line shows in the diff. The
 * switch names the one suite that writes in that run, and that suite writes
 * only once every test in its file ran and passed (`updateGate.ts`); the
 * other suite skips:
 * - `VC_CARD_TEXT_UPDATE=typescript`: the referee writes the towers, and the
 *   lines from the TypeScript card;
 * - `VC_CARD_TEXT_UPDATE=rust`: the sweep writes the lines from the Rust card,
 *   keeping the towers.
 *
 * While the referee exists the two cards must print the same lines, so either
 * refresh writes the same file; a line the Rust card prints differently on
 * purpose is named in the referee's `referenceLines`, with its reason, as the
 * "Avg load: 0% full" line is. A builder change is the referee's refresh. Once
 * the referee is gone, the sweep's refresh carries the lines, and a new case
 * needs a builder on the Rust engine.
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
  throw new Error(`the card-text golden holds US English numbers, and this locale prints ${usText} as ${JSON.stringify(localeText)}; run with LC_ALL=en_US.UTF-8`);
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
  "lobby distance",
  "lobby distance, unhappy",
  ...CARD_TEXT_STATES.map((st) => `every kind, ${st}`),
  "every transport",
  "winning tower",
  "winning tower, unhappy",
];

/** In-game minutes each card's engine plays after loading a case's tower and
 *  before the cards are read, in 10-minute ticks. A shaft's load line needs
 *  riders measured over time, and a save does not carry that measurement, so
 *  the every-transport case plays a morning on the loaded tower. */
export const CARD_TEXT_PLAY_MINUTES: ReadonlyMap<string, number> = new Map([["every transport", 8 * 60]]);
export const CARD_TEXT_TICK_MINUTES = 10;

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
  return `${mode}-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
}

const pathOf = (mode: CardTextMode, name: string, ext: "json" | "vctower") => resolve(CARD_TEXT_DIR, `${cardTextSlug(mode, name)}.${ext}`);

/** Every file the golden directory holds: a tower and its lines per case and
 *  mode. */
export const cardTextFiles = (): string[] =>
  CARD_TEXT_MODES.flatMap((mode) => CARD_TEXT_CASES.flatMap((name) => [`${cardTextSlug(mode, name)}.json`, `${cardTextSlug(mode, name)}.vctower`]));

/** Both cards printing nothing would also agree, so each case must have read
 *  real lines; this checks the lines a run is about to compare or write. */
export function expectRealLines(g: CardTextGolden): void {
  const label = `${g.mode}: ${g.case}`;
  const roomLines = g.units.reduce((n, u) => n + u.lines.length, 0);
  if (g.case !== "every transport") expect(roomLines, `${label} compared no room lines`).toBeGreaterThan(0);
  if (g.case === "lobby distance") {
    const shoppers = g.units.flatMap((u) => u.lines).filter((l) => l.startsWith("Shoppers:")).length;
    expect(shoppers, `${label}: the far shop must carry the warning`).toBe(1);
  }
  if (g.case.startsWith("every kind")) {
    // Room kinds only: the floor and lobby tiles are not cards.
    expect(new Set(g.units.map((u) => u.kind)).size, `${label} placed too few kinds`).toBeGreaterThanOrEqual(25);
  }
  if (g.case === "every transport") {
    expect(g.transports.length, `${label}: too few shafts`).toBeGreaterThanOrEqual(5);
    const shaftLines = g.transports.reduce((n, t) => n + t.lines.length, 0);
    expect(shaftLines, `${label}: no shaft printed a line`).toBeGreaterThan(0);
  }
}

/** A card's parts as the text a player reads, one entry per line. */
export const textOf = (parts: readonly unknown[]): string[] =>
  parts.map((p) => (renderToFragment(html`${p}`).textContent ?? "").trim()).filter(Boolean);

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
