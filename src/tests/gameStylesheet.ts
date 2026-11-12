import { readFileSync, readdirSync } from "node:fs";
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
 *
 * It throws when a part in `styles/game/` is not imported exactly once, or an
 * import of one is written in a shape it does not expand, so a guard that
 * asserts something is absent never passes on less CSS than the build ships.
 */
export function gameStylesheet(): string {
  const sheet = readFileSync(resolve(SRC, "styles.css"), "utf8");
  const imported: string[] = [];
  const expanded = sheet.replace(GAME_PART, (_line, part: string) => {
    imported.push(part);
    return readFileSync(resolve(SRC, part), "utf8");
  });
  const onDisk = readdirSync(resolve(SRC, "styles/game"))
    .filter((name) => name.endsWith(".css"))
    .map((name) => `styles/game/${name}`)
    .sort();
  const missed = onDisk.filter((part) => !imported.includes(part));
  const repeated = imported.filter((part, i) => imported.indexOf(part) !== i);
  if (missed.length > 0 || repeated.length > 0 || /@import[^;]*styles\/game\//.test(expanded)) {
    throw new Error(
      `styles.css must import each styles/game part once, as @import "./styles/game/<part>.css"; ` +
        `not expanded: ${missed.join(", ") || "none"}; repeated: ${repeated.join(", ") || "none"}`,
    );
  }
  return expanded;
}
