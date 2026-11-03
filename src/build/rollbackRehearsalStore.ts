/**
 * The pure half of the rollback rehearsal's browser layer (#1221): the saves the engine step wrote, the
 * form the game stores them in, and the picker row a stored save should produce. Node only. The page
 * driving is `scripts/rollback-rehearsal-browser.ts`.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { deflateRawSync, inflateRawSync } from "node:zlib";

export const AUTO_KEY = "verticopolis-save";
export const SLOT_KEYS = [1, 2, 3].map((n) => `simtower-clone-slot-${n}`);
export const UNREADABLE_KEY = "simtower-clone-unreadable";
const STORE_MAGIC = "VCZ1:";
const MINUTES_PER_DAY = 1440;

export interface SeededSave {
  name: string;
  key: string;
  label: string;
  save: Record<string, unknown>;
}

/**
 * The saves the engine step wrote, assigned to the autosave and then slots 1 to 3. Towers made from a
 * `.vctower` and towers imported from an original `.TDT` alternate (each in file-name order), so the
 * autosave, the one play rewrites, and the slots both carry both kinds.
 */
export function readSeeds(savesDir: string): SeededSave[] {
  const all = readdirSync(savesDir).filter((f) => f.endsWith(".json")).sort();
  const vctowers = all.filter((f) => f.endsWith(".vctower.json"));
  const others = all.filter((f) => !f.endsWith(".vctower.json"));
  const files: string[] = [];
  for (let i = 0; i < Math.max(vctowers.length, others.length); i++) {
    const a = vctowers[i];
    const b = others[i];
    if (a !== undefined) files.push(a);
    if (b !== undefined) files.push(b);
  }
  const places = [{ key: AUTO_KEY, label: "Auto-save" }, ...SLOT_KEYS.map((key, i) => ({ key, label: `Slot ${i + 1}` }))];
  return files.slice(0, places.length).map((name, i) => ({ name, ...places[i]!, save: JSON.parse(readFileSync(join(savesDir, name), "utf8")) as Record<string, unknown> }));
}

/** A save as the game stores it: stamped like `saveStamp.ts` does, deflated, base64. */
export function storedForm(save: Record<string, unknown>, appVersion: string, savedAt: number): string {
  const stamped = { ...save, savedAt, appVersion };
  return STORE_MAGIC + deflateRawSync(Buffer.from(JSON.stringify(stamped), "utf8"), { level: 1 }).toString("base64");
}

/** The save inside a stored value, or undefined when it is not a readable one. */
export function decodeStored(raw: string | null): Record<string, unknown> | undefined {
  if (raw === null) return undefined;
  try {
    const json = raw.startsWith(STORE_MAGIC) ? inflateRawSync(Buffer.from(raw.slice(STORE_MAGIC.length), "base64")).toString("utf8") : raw;
    const parsed: unknown = JSON.parse(json);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

/** What the tower picker prints for a save, so a row can be matched without reading the page's own code. */
export function expectedRow(save: Record<string, unknown>): { name: string; funds: string; day: string } {
  const name = typeof save.towerName === "string" && save.towerName !== "" ? save.towerName : "Tower";
  const funds = `$${Math.round(Number(save.money ?? 0)).toLocaleString("en-US")}`;
  return { name, funds, day: `Day ${Math.floor(Number(save.minutes ?? 0) / MINUTES_PER_DAY) + 1}` };
}

const escaped = (text: string): string => text.replace(/[.*+?^${}()|[\]\\$]/g, "\\$&");

/**
 * Whether a picker row's text carries the expected name, funds and day as whole values: "Day 1" must not
 * match "Day 12", "$5,000" must not match "$15,000" and "Tower" must not match "Towerone".
 */
export function rowMatches(shown: string, expected: { name: string; funds: string; day: string }): boolean {
  if (/couldn't be read/i.test(shown)) return false;
  const whole = (value: string): boolean => new RegExp(`(^|[^\\w$,.])${escaped(value)}(?![\\d,.]*\\d)`).test(shown);
  const wholeName = new RegExp(`(^|[^\\w])${escaped(expected.name)}(?!\\w)`).test(shown);
  return wholeName && whole(expected.funds) && whole(expected.day);
}
