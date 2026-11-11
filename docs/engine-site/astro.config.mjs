// The engine developer docs at docs.verticopolis.com. The pages come from the
// repository's own READMEs and guides (pages.json, scripts/sync-pages.mjs);
// the look comes from the game's Windows 3.1 palette (src/styles/theme.css
// over the game's retro-tokens.css). .github/workflows/engine-docs.yml builds
// it with the crate's Rust API reference under /rust/.
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

// DOCS_REF is the engine tag the site shows (engine-v1.24.0), or main for the
// unreleased docs; the workflow sets it.
const ref = process.env.DOCS_REF ?? "";
const release = ref.match(/^engine-v(.+)$/)?.[1];
const title = release ? `Verticopolis engine ${release}` : ref === "main" ? "Verticopolis engine (unreleased)" : "Verticopolis engine";

export default defineConfig({
  site: "https://docs.verticopolis.com",
  integrations: [
    starlight({
      title,
      description: "Developer docs for the Verticopolis simulation engine: the JavaScript package, the Rust crate, the host API and the conformance suite.",
      logo: { src: "./src/assets/logo.png", alt: "Verticopolis" },
      favicon: "/favicon.png",
      social: [{ icon: "github", label: "GitHub", href: "https://github.com/maniator/verticopolis" }],
      customCss: ["./src/styles/retro-tokens.css", "./src/styles/theme.css"],
      sidebar: [
        { label: "Overview", link: "/" },
        {
          label: "Guides",
          items: [{ slug: "javascript" }, { slug: "crate" }, { slug: "api" }, { slug: "conformance" }],
        },
        {
          label: "Reference",
          items: [
            { label: "Rust API reference", link: "/rust/verticopolis_engine/" },
            { slug: "changelog" },
          ],
        },
        { label: "Play Verticopolis", link: "https://verticopolis.com" },
      ],
    }),
  ],
});
