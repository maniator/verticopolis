import layoutJson from "../viewLayout.json";
import type { FacilityKind } from "../types";

/**
 * The port's layout as the Rust engine hands it over (`viewLayout()`), which
 * `npm run wasm:build` writes to `src/engine/viewLayout.json` from the built
 * package. `TsEngine` answers the same text and encodes by the same slots, so
 * the two engines feed the shared reader one layout, with no hand copy of the
 * tables. An integration test holds the file to the package it came from.
 */
export const VIEW_LAYOUT = layoutJson;
export const VIEW_LAYOUT_TEXT = JSON.stringify(layoutJson);

export type ViewLayout = typeof layoutJson;

/** The index of each name in a code table. */
function codes<T extends string>(names: readonly string[]): ReadonlyMap<T, number> {
  return new Map(names.map((n, i) => [n as T, i]));
}

export const KIND_CODES = codes<FacilityKind>(layoutJson.kinds);
export const KINDS = layoutJson.kinds as readonly FacilityKind[];
export const UNIT_STATE_CODES = codes<string>(layoutJson.unitStates);
export const PERSON_STATE_CODES = codes<string>(layoutJson.personStates);
export const WEATHER_CODES = codes<string>(layoutJson.weather);
export const MODE_CODES = codes<string>(layoutJson.modes);
export const CALENDAR_CODES = codes<string>(layoutJson.calendars);

/** A code table's index for `name`, or NaN for a name it does not hold. */
export const codeOf = (table: ReadonlyMap<string, number>, name: string | null | undefined): number =>
  name === null || name === undefined ? NaN : (table.get(name) ?? NaN);

/** The facility kind a code names, or undefined for a code outside the
 *  table (not a safe integer, negative, or past its end). */
export function kindOf(code: number): FacilityKind | undefined {
  return Number.isSafeInteger(code) && code >= 0 ? KINDS[code] : undefined;
}
