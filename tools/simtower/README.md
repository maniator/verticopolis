# SimTower harness: validating `vctower <-> tdt` against the real 1994 game

This runs the **retail SimTower** under Wine-in-Docker so we can round-trip our
`.TDT` importer/exporter against the actual game that wrote the format: export a
Verticopolis tower to `.TDT` and load it in SimTower, and load a SimTower-made
save into our engine. It is **opt-in developer tooling**. Nothing here runs in
CI, and you must supply your own game disc.

## Clean-room boundary (read this)

Verticopolis is a clean-room clone (`docs/canon/tdt-format.md`). The rule is
about **game bytes, not tooling**:

- **Committed here:** a generic Microsoft-KWAJ decompressor (`kwajd.c`, a thin
  libmspack wrapper with no game IP), an ISO extractor, a Wine/Docker harness,
  and `verify-tdt.py` (just `docs/canon/tdt-format.md` expressed as code; that
  doc, already in the repo, is far more detailed than any tool here).
- **NEVER committed** (gitignored): the ISO, extracted game binaries
  (`gamedata/`), the Wine prefix (`wineprefix/`), manuals, and any `.TDT` the
  real game writes. Test fixtures must be **our own output**, never bytes the
  1994 binary produced.
- We do **not** decompile or read the original game's code. We only observe its
  behavior and its data format. That is what keeps the clean-room claim intact.

Keep your project checkout out of any cloud-sync folder, or exclude
`tools/simtower/{gamedata,wineprefix,manuals,saves}`, so game binaries do not
sync off-machine.

## Requirements

- **Docker** (the daemon must be running), and for an interactive window either
  **WSLg** (Windows + WSL2) or an X server reachable on `DISPLAY`.
- **Python 3** on the host with **pycdlib** (`pip install -r
  tools/simtower/requirements.txt`). `run.sh` runs `extract-cd.py` on the host
  for the first-run ISO extraction, so this is needed before the very first
  launch (not needed once `gamedata/` exists).
- A **SimTower CD image you own** (a `.iso`). See "Bring your own ISO" below.
- Optional, only for in-game Save/Open: a genuine 16-bit `COMMDLG.DLL` from
  Windows 3.1 (which you own) at `tools/simtower/native/COMMDLG.DLL`. See the
  gotchas at the bottom.

## Bring your own ISO

We ship no game bytes, so you point the harness at your own SimTower CD image.
The extractor (`extract-cd.py`, run automatically on first launch) finds the ISO
in this order:

1. The `SIMTOWER_ISO` environment variable, if set to a full path:
   ```bash
   SIMTOWER_ISO=/path/to/SimTower.iso ./run.sh
   ```
2. Otherwise it looks in your Downloads folder, matching
   `/mnt/c/Users/*/Downloads/SimTower.iso` (the WSL view of a Windows Downloads
   folder). Dropping `SimTower.iso` there is the zero-config path on WSL.

On the first run it extracts the KWAJ-compressed game files (and the on-disc
manuals) into `tools/simtower/gamedata/` (gitignored). Later runs reuse that, so
extraction happens once. Force a re-pull with `./run.sh extract`.

## Use

```bash
./run.sh              # extract (first run) + build image + play in a window
./run.sh screenshot   # headless boot -> wineprefix/shot.png
./run.sh load  /wine/drive_c/saves/TOWER5.TDT   # headless load + screenshot
./run.sh save  /wine/drive_c/saves/TOWER5.TDT 'c:\saves\OUT.TDT'  # load, then drive File>Save As so the REAL game rewrites the bytes (full round-trip). Best-effort: it drives the menu/dialog by fixed coordinates (tunable via SAVE_* env), so a missed click just means no file; it FAILS loudly (nonzero, no stale artifact) rather than reporting a false success, so retry on failure.
./run.sh shell        # bash inside the container (game at C:\SIMTOWER)
./run.sh build        # rebuild the image
./run.sh extract      # re-pull game files + manuals from the ISO
```

**Rebuild after editing `docker/entrypoint.sh`.** The entrypoint is baked into
the image (`COPY entrypoint.sh`), so edits to it do nothing until you run
`./run.sh build`. A stale image is the usual cause of a load/screenshot that
suddenly ignores the tuning vars below or captures a blank frame.

The headless modes accept these host env vars (forwarded into the container).
`SHOT_OUT` and `SHOT_DELAY` apply to both `load` and `screenshot`; the framing
vars (`SCREEN`, `MAXIMIZE`, `ZOOM_CLICKS`, `CLICK_SECS`) are honored by `load`
only (`screenshot` boots a fixed 1024x768 frame):

```bash
SCREEN=1600x1000    # (load) Xvfb size; widen to fit a tall/wide tower in one shot
MAXIMIZE=1          # (load) maximize the inner tower window
ZOOM_CLICKS=1       # (load) toggle the magnifier N times (zoom the tower in/out)
ZOOM_TOOL_X=187     # (load) screen px of the palette magnifier tool (default 187,229)
ZOOM_TOOL_Y=229     # (load) ...its y; move if the palette is elsewhere
ZOOM_TILE_X=600     # (load) screen px on the TOWER to zoom toward; default 600,350
ZOOM_TILE_Y=350     # (load)   the default assumes a tall tower - aim near the ground row for a short one
CLICK_SECS=20       # (load) how long to sweep-click boot dialogs away
SHOT_DELAY=18       # (load + screenshot) settle seconds before the capture
SHOT_OUT=/wine/x.png # (load + screenshot) output path
# e.g.: SCREEN=1600x1000 MAXIMIZE=1 ./run.sh load /wine/drive_c/saves/TOWER5.TDT
# short tower zoom-in: ZOOM_CLICKS=1 ZOOM_TILE_X=400 ZOOM_TILE_Y=550 ./run.sh load ...
```

Only the interactive `run`/`shell` modes mount the host display; the headless
modes run their own Xvfb on `:99`, so the host X socket is deliberately not
mounted into them (mounting it makes that Xvfb fail to bind and the shot falls
back to a blank frame).

Saves you make in the game (File, then Save) land in `saves/` on the host and
feed straight into the tests below.

### Convert one of our towers to `.TDT`

```bash
npx tsx tools/simtower/vctower-to-tdt.ts path/to/tower.vctower [...]
# -> tools/simtower/saves/TOWER<n>.TDT   (load these in the game)
```

Decodes the `.vctower` container and runs the engine's own `buildTDT`, imported
directly under `tsx`, so it can't drift from what ships.

### Import a real `.TDT` into our engine (`tdt -> vctower`)

```bash
npx tsx tools/simtower/tdt-to-vctower.ts saves/TSTSAVE.TDT [--diff-empty]
# runs the engine's parseTDT, prints a summary + fidelity notes, writes a
# .imported.vctower. --diff-empty also byte-diffs our empty-tower export against
# the input (a real empty save), which is how the undersized-trailing export bug
# was found.
```

### Independently verify a `.TDT`

```bash
python3 tools/simtower/verify-tdt.py saves/TOWER5.TDT [key=val ...]
```

Parses a `.TDT` straight from the canon spec, deliberately **not** sharing our
importer, so it catches bugs both sides of our code would agree on (this is how
the zeroed-header-count export bug was found).

## Notes / gotchas

- **The file Open/Save dialog needs the real `COMMDLG.DLL`.** Wine's builtin
  16-bit commdlg crashes SimTower's file dialog (page fault at 0x048B). The fix
  is to load the genuine Microsoft 16-bit `COMMDLG.DLL` (from Win3.1, which you
  own) via `WINEDLLOVERRIDES=...;commdlg,commdlg.dll16=n`. Note the exact
  `commdlg.dll16` key; plain `commdlg=n` does NOT match Wine's 16-bit loader.
  Put the DLL at `native/COMMDLG.DLL` (gitignored); `run.sh` copies it into the
  prefix. With this, in-game Save works and writes real `.TDT` files to `saves/`.
- **Our exports now load and play** in the real game (v1.14.0). The old page
  fault at 0x0799 was an undersized trailing structure; the fix emits the routing
  tail, a nonzero people count, the elevator schedule block, and the view-scroll.
  A fixed-size routing tail is validated only to 2 stars; larger towers are a
  follow-up (backlog `tdt-export-routing-tail`).
- **Never assert render on a zero-population export; seed a person first.** A
  `.TDT` we export with rentable rooms present but **zero tenants** renders a
  black frame in the real game (a game-side divide-by-zero in the 1994
  evaluation, `Quality = 300 - total stress / tenants`, not our bytes: a truly
  empty tower renders, and any seeded population renders fine). It bites only
  synthetic all-vacant fixtures, never a real save. Party-ruled won't-fix
  2026-07-20 (issue #510). See PARITY.md.
- The game is 16-bit Windows 3.1 (`STOWER.EXE` on the disc is a Director autorun
  shell, not the game). It renders through the disc's WinG runtime.
- Runs in a Wine **virtual desktop** so WSLg routes mouse input to the window.
- First launch is slow: it builds a fresh Wine prefix and unpacks the game.
- Uses current **WineHQ staging** (Debian's Wine 8.0 is too old). See the Dockerfile.
