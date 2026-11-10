# Change notes

A pull request does not edit a version. It adds one note here, named after
its branch (`claude/project-thread-abc123` becomes
`claude-project-thread-abc123.md`), so two open PRs never touch the same file:

```
---
app: minor    # major | minor | patch | none
crate: none   # major | minor | patch | none
---
## Player
- Elevators now skip floors with nobody waiting.
## Engine
- `frame()` adds the waiting count per stop.
```

- `app` is the tier from CONTRIBUTING.md "Versioning": would a player notice
  anything different? `crate` follows "The engine crate version": a move in
  the conformance lock, a version constant or `engine.d.ts`.
- `## Player` lines go into `CHANGELOG.md` and the update prompt, in the house
  style of CONTRIBUTING.md "Player notes". `## Engine` lines go into
  `engine-rs/CHANGELOG.md` and are required when `crate` is not `none`.
- Each line is one `- ` bullet ending with a period. Leave out a section with
  no lines.
- A PR that changes a deployed path needs a note, even one with `app: none`
  and `crate: none`. Docs, tests and CI changes alone need none, and so do
  Dependabot's branches, which cannot write one.

The release driver cuts a release with `npm run release` on a
`release/<version>` branch. It raises each version by the highest pending
level, writes both changelogs from the notes, runs `npm run engine:compat`
when the crate moves, and deletes the notes. Production deploys wait while a
note with a level other than `none` is pending
(`scripts/vercel-ignore-build.sh`), so a player never gets new behavior under
the old version number. The release merge tags `v<version>` (and
`engine-v<version>` for a crate release) and publishes the GitHub releases.

`npm run version:check` runs the CI check on your committed branch. The rules
are in `src/build/changeNotes.ts` and `src/build/versionCheck.ts`.
