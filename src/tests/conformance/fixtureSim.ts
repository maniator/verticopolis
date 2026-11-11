import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { REPO_ROOT } from "./scenario";

/** Every save under the fixtures directory, so a new one is covered. Each is
 *  opened the way the game opens a file, with the engine's `fromVctower`. */
export const FIXTURES = readdirSync(resolve(REPO_ROOT, "conformance/fixtures"))
  .filter((f) => f.endsWith(".vctower"))
  .sort()
  .map((f) => `conformance/fixtures/${f}`);
