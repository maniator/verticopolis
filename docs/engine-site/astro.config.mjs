// The engine developer docs at docs.verticopolis.com. The pages come from the
// repository's own READMEs and guides (pages.json, scripts/sync-pages.mjs);
// the look comes from the game's Windows 3.1 palette (src/styles/theme.css
// over the game's retro-tokens.css). .github/workflows/engine-docs.yml builds
// it with the crate's Rust API reference under /rust/.
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import { GITHUB, sidebar, siteTitle } from "./site.mjs";

// DOCS_REF is main, or an engine tag (engine-v1.24.0) when a maintainer
// publishes a release instead; the workflow sets it.
const title = siteTitle(process.env.DOCS_REF);

// DOCS_BASE puts a pull request's preview under /pr-preview/pr-<number>/
// (docs-preview.yml); the live site sits at the root.
export default defineConfig({
  site: "https://docs.verticopolis.com",
  base: process.env.DOCS_BASE || "/",
  integrations: [
    starlight({
      title,
      description: "Developer docs for the Verticopolis simulation engine: the JavaScript package, the Rust crate, the host API and the conformance suite.",
      logo: { src: "./src/assets/logo.png", alt: "Verticopolis" },
      favicon: "/favicon.png",
      social: [{ icon: "github", label: "GitHub", href: GITHUB }],
      components: {
        Header: "./src/components/Header.astro",
        Hero: "./src/components/TitleScreen.astro",
      },
      customCss: ["./src/styles/retro-tokens.css", "./src/styles/theme.css", "./src/styles/title-bar.css"],
      sidebar,
    }),
  ],
});
