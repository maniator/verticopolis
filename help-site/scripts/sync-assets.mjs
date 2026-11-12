// Copies the game's own logo and favicon into the help site before a build,
// so the site and the game share one copy in the repository. The pages
// themselves are not copied: src/content/docs/ is their only home, and the
// game reads the same files (src/build/helpMarkdown.ts).
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const site = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repo = resolve(site, "..");

mkdirSync(join(site, "src/assets"), { recursive: true });
mkdirSync(join(site, "public"), { recursive: true });
copyFileSync(join(repo, "src/public/icon-1024x1024.png"), join(site, "src/assets/logo.png"));
copyFileSync(join(repo, "src/public/favicon.png"), join(site, "public/favicon.png"));
console.log("help-site: synced the logo and favicon");
