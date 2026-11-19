# Change notes

A pull request does not edit a version. It adds one note here, named after
its branch (`claude/project-thread-abc123` becomes
`claude-project-thread-abc123.md`), so two open PRs never touch the same file:

```
---
app: minor    # major | minor | patch | none
---
## Player
- Elevators now skip floors with nobody waiting.
```

- `app` is the tier from CONTRIBUTING.md "Versioning": would a player notice
  anything different?
- The engine and the components are versioned and released in their own
  repositories (Verticopolis/engine, Verticopolis/components), so a note here
  has no `crate:` level, no `readmes:` line and no `## Engine` section. A note
  written before the split that says `crate: none` still reads. A PR that
  raises an engine or components pin in `package.json` describes what a player
  notices from it in its Player lines.
- `## Player` lines go into `CHANGELOG.md` and the update prompt, in the house
  style of CONTRIBUTING.md "Player notes".
- `## Contributors` (optional, at any level) credits the people outside the
  project who helped: a community PR's author, an issue's reporter, a tester.
  Name each one as they go by in public, and say what they did, such as
  `- Sam reported the Esc discard guard (#670).` The release lists every
  note's credits once, under `### Contributors` after the version's notes in
  `CHANGELOG.md`. The GitHub release and the help site's release notes show them; the update
  prompt does not.
- Each line is one `- ` bullet ending with a period. Leave out a section with
  no lines. An app level other than `none` needs at least one Player line.
- A note that is already on `main` belongs to the PR that merged it. A
  follow-up PR from the same branch name adds `<branch-slug>-2.md` instead
  of editing it; only the release PR changes a pending note.
- A PR that changes a deployed path needs a note, even one with `app: none`. Docs, tests and CI changes alone need none, and so do
  Dependabot's branches, which cannot write one.

The release driver cuts a release with `npm run release` on a
`release/<version>` branch. It raises the version by the highest pending
level, writes the changelog from the notes (the notes with the highest level
come first, so a headline note opens the version's section and the update
prompt), and deletes the notes. Production deploys wait while a
note with a level other than `none` is pending
(`scripts/vercel-ignore-build.sh`), so a player never gets new behavior under
the old version number, and production builds only for a commit that changes
a version, so it moves only on a release merge. The **Cut release** workflow
(`release-pr.yml`) runs `npm run release` and opens the PR for you. The release merge tags `v<version>` and
publishes the GitHub release.

`npm run version:check` runs the CI check on your committed branch. The rules
are in `src/build/changeNotes.ts` and `src/build/versionCheck.ts`.
