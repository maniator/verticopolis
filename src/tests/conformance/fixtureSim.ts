import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { CONFORMANCE_ROOT } from "../packagePaths";

/** Every save under the fixtures directory, so a new one is covered. Each is
 *  opened the way the game opens a file, with the engine's `fromVctower`. */
export const FIXTURES = readdirSync(resolve(CONFORMANCE_ROOT, "fixtures"))
  .filter((f) => f.endsWith(".vctower"))
  .sort()
  .map((f) => `node_modules/@verticopolis/engine/conformance/fixtures/${f}`);
