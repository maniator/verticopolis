// What the docs site and the Rust API reference share: the title and the side
// menu. astro.config.mjs hands both to Starlight, and
// scripts/rustdoc-chrome.mjs draws the same header and menu into the pages
// cargo doc writes, so a page added here shows up in both places. The title
// bar itself (the game button, GitHub) is title-bar.mjs, which the help site
// draws too.
import { GAME } from "./title-bar.mjs";

export { GITHUB } from "./title-bar.mjs";

/** The site title: names the release when DOCS_REF is an engine tag. */
export function siteTitle(ref = "") {
  const release = ref.match(/^engine-v(.+)$/)?.[1];
  return release ? `Verticopolis engine ${release}` : "Verticopolis engine";
}

/** The site's name in the title bar on a phone. */
export const SHORT_TITLE = "Engine docs";

/** The path of the Rust API reference's front page. */
export const RUST_REFERENCE = "/rust/verticopolis_engine/";

/** Starlight's sidebar. A `slug` entry takes its label from pages.json. */
export const sidebar = [
  { label: "Overview", link: "/" },
  {
    label: "Guides",
    items: [{ slug: "javascript" }, { slug: "crate" }, { slug: "api" }, { slug: "conformance" }],
  },
  {
    label: "Reference",
    items: [{ label: "Rust API reference", link: RUST_REFERENCE }, { slug: "changelog" }],
  },
  { label: "Play Verticopolis", link: GAME },
];
