// The player help site at verticopolis.com/help: the player's manual, written
// in src/content/docs/. The game shows one of its pages itself, the Classic and
// Modern summary when you found a tower (src/ui/templates/compare.ts, compiled by
// src/build/helpMarkdown.ts), so the two never disagree. The look is the
// engine docs site's Windows 3.1 theme over the game's retro-tokens.css, with a
// few help-only rules in src/styles/help.css.
//
// It builds into the game's dist/help/ (scripts/vercel-build.sh runs it after
// the game's own build), so /help and its pages ship with every deploy, from
// the same origin as the game. The game's service worker leaves /help/ to the
// network, so nothing here is precached.
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import { HELP_BASE, OLD_ANCHORS, oldAnchorRedirects, sharedHead, sidebar } from "./site.mjs";

const site = dirname(fileURLToPath(import.meta.url));
const repo = resolve(site, "..");


/** The same compile-time constants the game's Vite build defines, for the
 *  game modules the site shares (telemetry and the from-game link handling). */
const appVersion = JSON.parse(readFileSync(join(repo, "package.json"), "utf8")).version;
let appSha = "unknown";
try {
  appSha = execSync("git rev-parse --short HEAD", { cwd: repo, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
} catch {
  // Outside a checkout the build still works; the SHA reads "unknown".
}

export default defineConfig({
  site: "https://verticopolis.com",
  base: HELP_BASE,
  outDir: join(repo, "dist", "help"),
  trailingSlash: "ignore",
  vite: {
    define: {
      __APP_VERSION__: JSON.stringify(appVersion),
      __APP_SHA__: JSON.stringify(appSha),
      // The help site is never a tooling build (no window.game handle).
      __TOOLING_BUILD__: "false",
    },
    server: { fs: { allow: [repo] } },
  },
  integrations: [
    starlight({
      title: "Verticopolis Help",
      description: "How to build, run and grow a tower in Verticopolis, the free tower building game in your browser.",
      logo: { src: "./src/assets/logo.png", alt: "Verticopolis" },
      favicon: "/favicon.png",
      // The site-wide "Page not found" page is the game's own (src/404.html).
      disable404Route: true,
      components: {
        Head: "./src/components/Head.astro",
        Header: "./src/components/Header.astro",
        Hero: "./src/components/TitleScreen.astro",
      },
      customCss: [
        join(repo, "src/styles/retro-tokens.css"),
        join(repo, "docs/engine-site/src/styles/theme.css"),
        "./src/styles/help.css",
      ],
      head: [...sharedHead, { tag: "script", content: oldAnchorRedirects(OLD_ANCHORS) }],
      sidebar,
    }),
  ],
});
