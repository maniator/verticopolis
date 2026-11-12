import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

/** `src/`, where `styles.css` and its parts live. */
const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** One `@import` of a part of the game's own stylesheet, under `styles/game/`. */
const GAME_PART = /^@import "\.\/(styles\/game\/[\w-]+\.css)";$/gm;

/**
 * The game's stylesheet as the build bundles it: `src/styles.css` with each
 * `@import` of a `styles/game/` part replaced by that part's text, in order.
 * The shared chrome it also imports (`styles/retro-*.css`, the map sheets)
 * stays an `@import` line, as before the split, so a test that wants those
 * reads them itself.
 */
export function gameStylesheet(): string {
  const sheet = readFileSync(resolve(SRC, "styles.css"), "utf8");
  return sheet.replace(GAME_PART, (_line, part: string) =>
    readFileSync(resolve(SRC, part), "utf8"),
  );
}
