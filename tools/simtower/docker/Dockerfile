# Wine harness for running the retail SimTower on Linux/WSL2.
# The game (simtower.exe) is a 16-bit Windows 3.1 NE binary that renders through
# the 16-bit WinG runtime (WING.DLL) shipped on the disc. We skip the flaky
# 16-bit ACME installer and decompress the CD's KWAJ files directly with
# libmspack (see kwajd.c). (STOWER.EXE on the disc is a 32-bit Macromedia
# Director autorun shell, not the game -- don't run it.)
#
# WINE VERSION MATTERS: Debian's Wine 8.0 crashes SimTower's 16-bit code in the
# file Open/Save common dialog (null far pointer) AND overruns a 16-bit string
# buffer while loading a tower (strict LDT selector-limit enforcement traps what
# real Win3.1/95 tolerated). We install a current WineHQ build, whose 16-bit
# selector/memory + commdlg handling is years ahead, so save/load work.
FROM debian:bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive \
    WINEARCH=win32 \
    WINEPREFIX=/wine \
    WINEDEBUG=-all \
    # keep Wine from phoning home / popping the Mono+Gecko installers
    WINEDLLOVERRIDES="mscoree,mshtml=" \
    DISPLAY=:0

# WineHQ (current staging) instead of Debian's ancient wine 8.0 (see header).
RUN dpkg --add-architecture i386 \
 && apt-get update \
 && apt-get install -y --no-install-recommends wget ca-certificates gnupg \
 && mkdir -pm755 /etc/apt/keyrings \
 && wget -O /etc/apt/keyrings/winehq-archive.key https://dl.winehq.org/wine-builds/winehq.key \
 && wget -NP /etc/apt/sources.list.d/ https://dl.winehq.org/wine-builds/debian/dists/bookworm/winehq-bookworm.sources \
 && apt-get update \
 && apt-get install -y --install-recommends winehq-staging \
 && apt-get install -y --no-install-recommends \
      libmspack-dev gcc libc6-dev \
      xvfb x11-utils imagemagick \
      tzdata procps \
 && rm -rf /var/lib/apt/lists/*

# xdotool: dismiss the "no sound card" dialog in headless screenshot mode.
RUN apt-get update \
 && apt-get install -y --no-install-recommends xdotool \
 && rm -rf /var/lib/apt/lists/*

# Build the KWAJ decompressor used by the entrypoint to unpack the CD files.
COPY kwajd.c /tmp/kwajd.c
RUN gcc -O2 -o /usr/local/bin/kwajd /tmp/kwajd.c -lmspack && rm /tmp/kwajd.c

COPY entrypoint.sh /usr/local/bin/entrypoint
RUN chmod +x /usr/local/bin/entrypoint

# /gamedata  = read-only CD files (bind-mounted)
# /wine      = persisted Wine prefix incl. drive_c/SIMTOWER and saves (bind-mounted)
WORKDIR /wine
ENTRYPOINT ["/usr/local/bin/entrypoint"]
CMD ["run"]
