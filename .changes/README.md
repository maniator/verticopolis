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
- `readmes: unchanged` (optional) is for a PR that changes the engine: it
  says you read both engine READMEs (`packages/verticopolis-engine/README.md`
  and `engine-rs/CRATE_README.md`) and neither needs a word. Without it, an
  engine change must edit one of them. See CONTRIBUTING.md "The engine
  READMEs".
- `## Player` lines go into `CHANGELOG.md` and the update prompt, in the house
  style of CONTRIBUTING.md "Player notes". `## Engine` lines go into
  `engine-rs/CHANGELOG.md` and are required when `crate` is not `none`.
- Each line is one `- ` bullet ending with a period. Leave out a section with
  no lines. An app level other than `none` needs at least one Player line.
- A note that is already on `main` belongs to the PR that merged it. A
  follow-up PR from the same branch name adds `<branch-slug>-2.md` instead
  of editing it; only the release PR changes a pending note.
- A PR that changes a deployed path needs a note, even one with `app: none`
  and `crate: none`. Docs, tests and CI changes alone need none, and so do
  Dependabot's branches, which cannot write one.

The release driver cuts a release with `npm run release` on a
`release/<version>` branch. It raises each version by the highest pending
level, writes both changelogs from the notes, runs `npm run engine:compat`
when the crate moves, and deletes the notes. Production deploys wait while a
note with a level other than `none` is pending
(`scripts/vercel-ignore-build.sh`), so a player never gets new behavior under
the old version number, and production builds only for a commit that changes
a version, so it moves only on a release merge. The **Cut release** workflow
(`release-pr.yml`) runs `npm run release` and opens the PR for you. The release merge tags `v<version>` (and
`engine-v<version>` for a crate release) and publishes the GitHub releases.

`npm run version:check` runs the CI check on your committed branch. The rules
are in `src/build/changeNotes.ts` and `src/build/versionCheck.ts`.
