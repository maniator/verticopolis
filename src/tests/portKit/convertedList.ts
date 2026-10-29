import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The suites converted to the engine port, as repository paths
 *  (`converted.txt`). Read by `vite.config.ts` and `scripts/test-port.ts`. */
export function convertedSuites(): string[] {
  const file = resolve(dirname(fileURLToPath(import.meta.url)), "converted.txt");
  return readFileSync(file, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));
}
