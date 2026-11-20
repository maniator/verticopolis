// The player help site at help.verticopolis.com: the player's manual, written
// in src/content/docs/. The game shows one of its pages itself, the Classic and
// Modern summary when you found a tower (src/ui/templates/compare.ts, compiled by
// src/build/helpMarkdown.ts), so the two never disagree. The look is the
// engine docs site's Windows 3.1 theme (src/styles/theme.css) over the game's
// retro-tokens.css from @verticopolis/components, with a few help-only rules
// in src/styles/help.css.
//
// It builds into the game's dist/help/ (scripts/vercel-build.sh runs it after
// the game's own build), so the manual ships with every deploy of the game.
// A production build puts it at the root of help.verticopolis.com
// (VC_HELP_ORIGIN, site.mjs), which vercel.json serves from dist/help/; every
// other build keeps it under /help on the game's own host. The game's service
// worker leaves /help/ to the network, so nothing here is precached.
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import { satteri } from "@astrojs/markdown-satteri";
import { GITHUB } from "./title-bar.mjs";
import {
  HELP_BASE,
  OLD_ANCHORS,
  SITE_ORIGIN,
  oldAnchorRedirects,
  schemeBootScript,
  sharedHead,
  sidebar,
  siteHref,
} from "./site.mjs";

const site = dirname(fileURLToPath(import.meta.url));
const repo = resolve(site, "..");
const components = join(repo, "node_modules/@verticopolis/components");

/** The same compile-time constants the game's Vite build defines, for the
 *  game modules the site shares (telemetry and the from-game link handling). */
const appVersion = JSON.parse(readFileSync(join(repo, "package.json"), "utf8")).version;
let appSha = "unknown";
try {
  appSha = execSync("git rev-parse --short HEAD", { cwd: repo, stdio: ["ignore", "pipe", "ignore"] })
    .toString()
    .trim();
} catch {
  // Outside a checkout the build still works; the SHA reads "unknown".
}

/** The help pages write /help/... for a manual page and / for the game, as
 *  the game's own Help window reads them; this points every link in a page at
 *  this build's address for it ({@link siteHref}). A no-op in a /help build. */
const siteLinks = {
  name: "verticopolis-site-links",
  element: {
    filter: ["a"],
    visit(node, ctx) {
      const href = node.properties?.href;
      if (typeof href !== "string") return;
      const to = siteHref(href);
      if (to !== href) ctx.setProperty(node, "href", to);
    },
  },
};

export default defineConfig({
  site: SITE_ORIGIN,
  base: HELP_BASE,
  outDir: join(repo, "dist", "help"),
  trailingSlash: "ignore",
  // Starlight adds its own plugins (asides, heading links) to this processor.
  markdown: { processor: satteri({ hastPlugins: [siteLinks] }) },
  vite: {
    define: {
      __APP_VERSION__: JSON.stringify(appVersion),
      __APP_SHA__: JSON.stringify(appSha),
      // The help site is never a tooling build (no window.game handle).
      __TOOLING_BUILD__: "false",
      __HELP_ORIGIN__: JSON.stringify(process.env.VC_HELP_ORIGIN ?? ""),
    },
    server: { fs: { allow: [repo] } },
  },
  integrations: [
    starlight({
      title: "Verticopolis™ Help",
      description: "How to build, run and grow a tower in Verticopolis, the free tower building game in your browser.",
      logo: { src: "./src/assets/logo.png", alt: "Verticopolis" },
      favicon: "/favicon.png",
      // The title bar draws GitHub on a wide screen; on a phone Starlight puts
      // this link at the foot of the menu.
      social: [{ icon: "github", label: "GitHub", href: GITHUB }],
      // The site-wide "Page not found" page is the game's own (src/404.html).
      disable404Route: true,
      components: {
        Head: "./src/components/Head.astro",
        Header: "./src/components/Header.astro",
        Hero: "./src/components/TitleScreen.astro",
      },
      customCss: [
        // The game's chrome tokens and menu bar, from the components package
        // the game installs (the help site builds after the game's npm ci).
        join(components, "lib/styles/retro-tokens.css"),
        "./src/styles/theme.css",
        "./src/styles/title-bar.css",
        join(components, "lib/styles/menu-bar.css"),
        "./src/styles/help.css",
        "./src/styles/help-schemes.css",
      ],
      head: [
        ...sharedHead,
        { tag: "script", content: schemeBootScript() },
        { tag: "script", content: oldAnchorRedirects(OLD_ANCHORS) },
      ],
      sidebar,
    }),
  ],
});
