# 🏙️ Verticopolis™: a browser SimTower clone

**Play it: [verticopolis.com](https://verticopolis.com)** ·
[How to play](https://help.verticopolis.com/) ·
[Engine docs](https://docs.verticopolis.com/) ·
[Release notes](https://help.verticopolis.com/changelog/) ·
[Sponsor](https://github.com/sponsors/maniator)

A from-scratch, browser-native homage to the classic **SimTower** (1994): a
vertical metropolis you build floor by floor. Wire it with elevators, attract
tenants, set the rents, keep everyone happy, and climb the star ratings all the
way to a coveted **TOWER**.

The simulation is a **Rust** engine (`engine-rs/`) compiled to
**WebAssembly**, and it is the only engine the game runs. Everything around it
is **TypeScript** on the **[Excalibur.js](https://excaliburjs.com/)** game
engine (camera, scene, culling and the render loop). The music is a
procedural soundtrack built on **[Tone.js](https://tonejs.github.io/)**, with
one theme for the title screen and another in the tower. The ambience under it
follows the part of the tower you're looking at: offices type away through the
workday, diners chatter, the metro rumbles. No external art assets: every
sprite is drawn in code.

| Day | Night |
| --- | --- |
| ![A tower by day on the 1994 desk](docs/screenshots/03b-desk-day.png) | ![The same tower at night](docs/screenshots/04b-desk-night.png) |

## What's in it

- **Two ways to play.** *Classic* is the 1994 game, rule for rule; *Modern*
  keeps it and adds what the original couldn't do.
  ([Classic and Modern](https://help.verticopolis.com/classic-vs-modern/))
- **Every room from the original**: offices, condos, hotels, shops and
  restaurants, the cinema and party hall, services, the metro and the Wedding
  Hall, each one drawn on the [Rooms](https://help.verticopolis.com/rooms/)
  pages of the manual.
- **Stairs, escalators and three kinds of elevator**, with cars and stops you
  set yourself. ([Elevators](https://help.verticopolis.com/building/elevators/))
- **A living tower** on one game clock: rush hours, quiet nights, people riding
  the cars, lights in the windows, the metro train pulling in.
  ([People](https://help.verticopolis.com/tower/people/))
- **Stars, events and the TOWER**: fires, bomb threats, the VIP and the final
  inspection. ([Stars and the TOWER](https://help.verticopolis.com/tower/stars/),
  [Events](https://help.verticopolis.com/tower/events/))
- **Your towers, kept**: the Auto-save, a My Towers folder with classic Open
  and Save As windows, `.vctower` files, and the
  original game's `.TDT` saves (opened here, and written back out from a
  Classic tower).
  ([Saving and loading](https://help.verticopolis.com/your-towers/saving/))
- **Installable and offline** on desktop and phone.
  ([Installing and updates](https://help.verticopolis.com/your-towers/installing/))

Where a Classic tower differs from the original, on purpose or not yet, is on
[Differences from the 1994 game](https://help.verticopolis.com/differences/);
the developer's checklist is [PARITY.md](PARITY.md).

## Quick start

```bash
npm install
npm run wasm:build   # build the Rust engine package (needs the toolchain in engine-rs/README.md)
npm run dev          # open the printed localhost URL
```

The game cannot start without the engine package. On x86_64 Linux,
`bash scripts/build-engine-wasm.sh` installs the pinned Rust toolchain and builds
it in one step.

## The Verticopolis repositories

| Repository | What it holds |
| --- | --- |
| **[Verticopolis/web](https://github.com/Verticopolis/web)** (this one) | The game at [verticopolis.com](https://verticopolis.com), its player's manual and the release lane. Bugs and ideas from playing go here. |
| [Verticopolis/engine](https://github.com/Verticopolis/engine) | The Rust engine as the `verticopolis-engine` crate and the `@verticopolis/engine` WebAssembly package, the conformance suite and the [engine docs](https://docs.verticopolis.com/) |
| [Verticopolis/components](https://github.com/Verticopolis/components) | `@verticopolis/components`: the renderer, the Windows 95 windows and menus, the sprites and audio, and the engine binding |

The engine and the components were split out of this repository with their
history. Until the game builds from their packages, their code still lives
here too (`engine-rs/`, `src/render/`, `src/ui/` and the rest), and changes
to those folders are on hold in every repository. Each repository has its own
issue forms; the organization-wide funding link, security policy and the
shared PR template and issue form checks live in
[Verticopolis/.github](https://github.com/Verticopolis/.github).

## Learn more

| Playing | Building it |
| --- | --- |
| [Your first tower](https://help.verticopolis.com/first-tower/) | [CONTRIBUTING.md](CONTRIBUTING.md): setup, quality gates, tests and coverage, versioning, review |
| [Controls](https://help.verticopolis.com/controls/) (mouse, touch, keyboard) | [ARCHITECTURE.md](ARCHITECTURE.md): source layout, the frame loop, input, saves, the PWA; deeper pages in [docs/architecture/](docs/architecture/README.md) |
| [Rooms](https://help.verticopolis.com/rooms/) | [engine-rs/README.md](engine-rs/README.md): working on the simulation |
| [Map and windows](https://help.verticopolis.com/tower/map-and-windows/) | [docs.verticopolis.com](https://docs.verticopolis.com/): the engine package, crate, API and conformance |
| [Importing and exporting](https://help.verticopolis.com/your-towers/importing-exporting/) | [docs/canon/tdt-format.md](docs/canon/tdt-format.md): the `.TDT` save format |
| [The whole manual](https://help.verticopolis.com/) | [docs/screenshots.md](docs/screenshots.md): the screenshot gallery and how it is rendered, including the [1★ to TOWER ladder](docs/screenshots/milestones/) |

## License

The **source code** is **MIT** ([LICENSE](LICENSE)); the original **art and
audio** are **CC BY 4.0** ([ASSETS-LICENSE](ASSETS-LICENSE.md)). To get involved,
see **[CONTRIBUTING.md](CONTRIBUTING.md)**.

**Verticopolis™** is the project's trademark. Neither license covers the
name: you are welcome to copy, change and share the game under its
licenses, but please give your copy a name of its own.

Questions, ideas or a tower to show off? Come say hi in
[Discussions](https://github.com/Verticopolis/web/discussions).

Verticopolis is free to play and nothing in it is locked. If you would like to
help keep it going, you can [sponsor it on GitHub](https://github.com/sponsors/maniator).

---

Built fresh as a clean-room clone. None of the original game's code or assets
are used.
