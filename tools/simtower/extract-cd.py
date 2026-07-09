#!/usr/bin/env python3
"""Pull the SimTower game files + manuals off the retail CD ISO.

Clean-room note: this copies bytes off an original-game CD you own onto your
local disk so the Wine harness can run the real game and emit real .TDT saves
for round-trip testing. The extracted binaries are gitignored and must never be
committed (see docs/canon/tdt-format.md sources policy).

The game files ship LZ-compressed (Microsoft KWAJ) inside a Microsoft ACME
Setup disc. We copy them verbatim; decompression happens inside the container
via the `kwajd` helper (a libmspack KWAJ decompressor; see docker/entrypoint.sh
and docker/kwajd.c), because Wine's `expand` cannot handle KWAJ-LZH. So this
script needs no decompressor and no extra deps beyond pycdlib.

Usage:
    python3 extract-cd.py [/path/to/SimTower.iso]
Defaults to $SIMTOWER_ISO or the Windows-side Downloads copy.
"""
import io
import os
import sys
import pycdlib

HERE = os.path.dirname(os.path.abspath(__file__))
GAMEDATA = os.path.join(HERE, "gamedata")
MANUALS = os.path.join(HERE, "manuals")

# Compressed CD name -> decompressed name we want on the C: drive.
# (trailing '_' / 'R'/'D' etc. is the ACME "last char replaced" compression marker)
GAME_FILES = {
    "SIMTOWER.EX_": "simtower.exe",   # the game itself (16-bit Win3.1 NE, ~6.56 MB)
    "SIMTOWER.HL_": "simtower.hlp",   # WinHelp (English in-game help)
    "WING.DL_":     "wing.dll",       # WinG graphics runtime (16-bit)
    "WING32.DL_":   "wing32.dll",     # WinG graphics runtime (32-bit) <- the one the game renders through
    "WINGDE.DL_":   "wingde.dll",     # WinG DIB engine
    "WINGDIB.DR_":  "wingdib.drv",
    "WINGPAL.WN_":  "wingpal.wnd",
    "WAVMIX16.DL_": "wavmix16.dll",   # WaveMix sound
    "WAVEMIX.IN_":  "wavemix.ini",
    "CTL3D.DL_":    "ctl3d.dll",      # 3D control theming
    "README.WR_":   "readme.wri",     # English readme (Windows Write)
}

# Manuals: these are already-uncompressed PDFs on the disc -> straight copy.
MANUAL_FILES = {
    "/MANUALS/GE.PDF;1": "manual-de.pdf",   # full German manual (most complete on this disc)
    "/MANUALS/FR.PDF;1": "manual-fr.pdf",
    "/MANUALS/IT.PDF;1": "manual-it.pdf",
    "/MANUALS/SP.PDF;1": "manual-es.pdf",
}


def default_iso():
    if os.environ.get("SIMTOWER_ISO"):
        return os.environ["SIMTOWER_ISO"]
    # Windows-side Downloads under WSL
    import glob
    for p in glob.glob("/mnt/c/Users/*/Downloads/SimTower.iso"):
        return p
    return "SimTower.iso"


def extract(iso, iso_path, dest):
    buf = io.BytesIO()
    iso.get_file_from_iso_fp(buf, iso_path=iso_path)
    with open(dest, "wb") as fh:
        fh.write(buf.getvalue())
    return len(buf.getvalue())


def main():
    iso_path = sys.argv[1] if len(sys.argv) > 1 else default_iso()
    if not os.path.exists(iso_path):
        sys.exit(f"ISO not found: {iso_path}\n"
                 f"Pass the path or set SIMTOWER_ISO=/path/to/SimTower.iso")

    os.makedirs(GAMEDATA, exist_ok=True)
    os.makedirs(MANUALS, exist_ok=True)

    iso = pycdlib.PyCdlib()
    iso.open(iso_path)

    print(f"Extracting from {iso_path}")
    print("== game files (compressed; decompressed in-container) ==")
    for cd_name, out_name in GAME_FILES.items():
        dest = os.path.join(GAMEDATA, cd_name)
        try:
            n = extract(iso, f"/{cd_name};1", dest)
            print(f"  {cd_name:<14} -> gamedata/{cd_name}  ({n:,} bytes, becomes {out_name})")
        except Exception as e:
            print(f"  {cd_name:<14} SKIP ({e})")

    print("== manuals (PDF; readable directly) ==")
    for cd_path, out_name in MANUAL_FILES.items():
        dest = os.path.join(MANUALS, out_name)
        try:
            n = extract(iso, cd_path, dest)
            print(f"  {cd_path:<22} -> manuals/{out_name}  ({n:,} bytes)")
        except Exception as e:
            print(f"  {cd_path:<22} SKIP ({e})")

    iso.close()
    print("\nDone. Next: tools/simtower/run.sh  (builds the Wine image and launches SimTower)")


if __name__ == "__main__":
    main()
