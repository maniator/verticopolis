# Party findings: a docs subdomain for the engine (2026-11-11)

Room: Web Game Room, with Paige (tech writer) and Winston (architect) pulled
in. One round and a synthesis, on the owner's question: should the developer
docs live on a subdomain of verticopolis.com, such as docs.verticopolis.com?
Nothing here changes DNS, Vercel or GitHub settings; the owner decides.

## What the docs are today

- `packages/verticopolis-engine/README.md`, the WASM package README, shown on
  the GitHub Packages page.
- `engine-rs/CRATE_README.md`, the crate README for a future registry release
  (#893), and `engine-rs/API.md`, the full Rust host guide.
- `conformance/README.md`, `engine-rs/CHANGELOG.md`, and the event catalog
  `conformance/events/catalog.json`.
- No rustdoc site. The crate is not on crates.io, so docs.rs has nothing.

## The round

📝 **Paige:** Four Markdown files and a JSON catalog, spread over three
folders, each read on GitHub's file view. A reader who arrives from the npm
page has no left-hand nav and no search. A small static site fixes that, and
the files stay the source.

🕸️ **Theo:** Then keep it off the game's origin. Production here deploys only
on a release merge, and the service worker precaches the whole app. Docs under
`verticopolis.com/docs` would wait for an app release to fix a typo and would
ride the game's cache rules. A subdomain is its own origin: its own deploys,
its own caching, no service worker in its way.

⏱️ **Tess:** Which commit does the site show? A host pins `engine-v1.24.0`. If
the site renders `main`, it documents calls the pinned package does not have.
Build it from the engine release tag, in the release workflow that already
packs the npm package, and the site matches what people install.

📝 **Paige:** `main` is where the rule now keeps the READMEs current. I'd rather
show `main`.

⏱️ **Tess:** Then label it "unreleased" and put the release on the front door.
The tag is the contract.

🏗️ **Winston:** Generator: mdBook. It's a single Rust binary, reads the Markdown
we have, and needs nothing from the web game's npm tree. Add `cargo doc
--no-deps` output under `/rust/` and the crate has API docs before docs.rs does.

📐 **Juno:** Starlight or VitePress look nicer and we already run Node.

🏗️ **Winston:** And drag a second front-end toolchain into a docs job that
should build in the Rust image. Looks matter less than the job never breaking.

😤 **Grumbal:** Who is the reader? The npm package page already shows the
README, GitHub renders the rest, and the only Rust host is the native client,
which reads the source anyway. A subdomain is one more thing to keep alive for
an audience of nobody yet.

🌶️ **Boundary:** Two edges. First, the site must hold only public material:
nothing from the native client, store or Steam plans, so it builds from this
public repository alone. Second, relative links in the READMEs (`../conformance/`)
break once rendered elsewhere; the package README already uses absolute
GitHub links, and the site build should check links.

🕸️ **Theo:** Hosting: GitHub Pages from an Actions job is the least plumbing.
It deploys from the release workflow on a tag with no new secret, and a custom
domain is one CNAME record. A separate Vercel project works too, but deploying
it from a tag needs a deploy token in the repository secrets or a deploy hook.

😤 **Grumbal:** Fine. Build it small, or don't build it.

## Options for the owner

1. **docs.verticopolis.com on GitHub Pages (recommended).** mdBook over the
   existing Markdown plus `cargo doc` under `/rust/`, built and deployed by the
   engine release workflow from the `engine-v<version>` tag, with a link
   check. Owner steps: turn on Pages (source: GitHub Actions) and add one CNAME
   record `docs` pointing at `maniator.github.io`. No Vercel change.
2. **docs.verticopolis.com as a second Vercel project.** Same site, Vercel
   previews on PRs. Needs a deploy token secret or deploy hook for tag-based
   deploys, and a second project to watch.
3. **verticopolis.com/docs on the game site.** No new domain, but docs wait for
   app releases and share the game's service worker and cache rules. The room
   advises against it.
4. **Not yet.** Keep the npm page, GitHub's file view and, after #893, docs.rs.
   Revisit when an outside host shows up or the crate is published.

## Recommendation

Option 1, kept small: one PR adds an mdBook config and a docs job to the
engine release; the owner then flips Pages on and adds the CNAME. If the owner
would rather not run a site before there is an outside reader, option 4 costs
nothing and the READMEs stay current under the new rule either way.
