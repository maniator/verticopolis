import { readFileSync } from "node:fs";
import { join } from "node:path";

/** The sources hash the installed `@verticopolis/engine` package's BUILD.json
 *  records, the engine the game pins, or null when it is not installed. */
export function pinnedEngineSources(repo: string): string | null {
  try {
    const sources = (
      JSON.parse(readFileSync(join(repo, "node_modules/@verticopolis/engine/web/BUILD.json"), "utf8")) as {
        sources?: unknown;
      }
    ).sources;
    return typeof sources === "string" ? sources : null;
  } catch {
    return null;
  }
}
