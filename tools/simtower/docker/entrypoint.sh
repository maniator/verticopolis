#!/usr/bin/env bash
# Entrypoint for the SimTower Wine harness.
#   run          launch SimTower on the current DISPLAY (WSLg window)
#   screenshot   boot SimTower under Xvfb and grab a PNG to /wine/shot.png (headless verify)
#   shell        drop into bash inside the configured prefix
set -euo pipefail

GAMEDATA=/gamedata
INSTALL="$WINEPREFIX/drive_c/SIMTOWER"

# Map compressed CD name -> final filename in C:\SIMTOWER
declare -A FILES=(
  [SIMTOWER.EX_]=simtower.exe
  [SIMTOWER.HL_]=simtower.hlp
  [WING.DL_]=wing.dll
  [WING32.DL_]=wing32.dll
  [WINGDE.DL_]=wingde.dll
  [WINGDIB.DR_]=wingdib.drv
  [WINGPAL.WN_]=wingpal.wnd
  [WAVMIX16.DL_]=wavmix16.dll
  [WAVEMIX.IN_]=wavemix.ini
  [CTL3D.DL_]=ctl3d.dll
  [README.WR_]=readme.wri
)

init_prefix() {
  if [ ! -f "$WINEPREFIX/system.reg" ]; then
    echo "[harness] initializing Wine prefix ($WINEARCH) ..."
    wineboot -i >/dev/null 2>&1 || true
    wineserver -w
  fi
}

install_game() {
  if [ -f "$INSTALL/simtower.exe" ]; then
    return
  fi
  echo "[harness] decompressing CD files into C:\\SIMTOWER ..."
  mkdir -p "$INSTALL"
  for cd_name in "${!FILES[@]}"; do
    src="$GAMEDATA/$cd_name"
    dst="$INSTALL/${FILES[$cd_name]}"
    if [ -f "$src" ]; then
      if kwajd "$src" "$dst"; then
        printf '  %-14s -> %s (%s bytes)\n' "$cd_name" "${FILES[$cd_name]}" "$(stat -c%s "$dst")"
      else
        echo "  WARN: failed to decompress $cd_name" >&2
      fi
    fi
  done
  # A place for the player to drop/collect .TDT saves that lands on the host.
  mkdir -p "$WINEPREFIX/drive_c/saves"
  echo "[harness] install complete: $INSTALL"
}

run_game() {
  init_prefix
  install_game
  cd "$INSTALL"
  # Run inside a Wine VIRTUAL DESKTOP (single managed top-level window). In
  # rootless mode under WSLg the splash renders but the compositor won't route
  # mouse clicks to Wine's unmanaged popups; a virtual desktop fixes input.
  local size="${DESKTOP_SIZE:-1024x768}"
  echo "[harness] launching SimTower in a Wine virtual desktop ($size); close the window to exit ..."
  exec wine explorer "/desktop=SimTower,$size" simtower.exe "$@"
}

screenshot_game() {
  init_prefix
  install_game
  local out="${SHOT_OUT:-/wine/shot.png}"
  local delay="${SHOT_DELAY:-25}"
  echo "[harness] booting SimTower under Xvfb, capturing after ${delay}s ..."
  Xvfb :99 -screen 0 1024x768x24 >/dev/null 2>&1 &
  local xvfb=$!
  export DISPLAY=:99
  sleep 2
  ( cd "$INSTALL" && wine simtower.exe >/dev/null 2>&1 ) &
  local game=$!
  # Dismiss the "no sound card - run without sound?" dialog by clicking "Yes".
  sleep 12
  xdotool mousemove 478 416 click 1 >/dev/null 2>&1 || true
  sleep "$delay"
  import -window root "$out" || xwd -root -silent | convert xwd:- "$out" || true
  echo "[harness] saved $out"
  kill "$game" "$xvfb" 2>/dev/null || true
  wineserver -k 2>/dev/null || true
}

# Load a .TDT headlessly and screenshot the result (round-trip verification).
#   load  <tdt-path-in-container>   e.g. load /wine/drive_c/saves/TOWER5.TDT
load_tdt() {
  init_prefix
  install_game
  local tdt="${1:?usage: load <path-to.TDT>}"
  local out="${SHOT_OUT:-/wine/load-shot.png}"
  local delay="${SHOT_DELAY:-15}"
  # Give the game a DOS-style path it will accept.
  local win_path
  win_path="$(winepath -w "$tdt" 2>/dev/null || echo "$tdt")"
  echo "[harness] loading $win_path under Xvfb ..."
  Xvfb :99 -screen 0 1024x768x24 >/dev/null 2>&1 &
  local xvfb=$!
  export DISPLAY=:99
  sleep 2
  # Launch inside a Wine virtual desktop (a single managed top-level window), so
  # the main tower window reliably composites onto the Xvfb root; plain
  # `wine simtower.exe` leaves the main window unmapped without a window manager
  # (only its modal dialogs show), which screenshots as black.
  ( cd "$INSTALL" && wine explorer /desktop=SimTower,1024x768 simtower.exe "$win_path" >/dev/null 2>&1 ) &
  local game=$!
  # The disc's wavmix16.dll pops a sequence of modal boxes on boot (a "not
  # installed" warning, a GetModuleFileName debug box) plus the "no sound card"
  # prompt, at varying positions/timing. Click across the whole OK/Yes button
  # zone repeatedly (dialogs are centered; buttons sit around y 410-455) to clear
  # whichever is up, then let the tower render. Clicks only (no Return), so a
  # stray keypress can't reach the loaded game and trigger a menu/exit.
  sleep 8
  for _ in $(seq 1 12); do
    for xy in "514 453" "512 416" "478 416" "512 433"; do
      xdotool mousemove $xy click 1 >/dev/null 2>&1 || true
    done
    sleep 1
  done
  sleep "$delay"
  import -window root "$out" || true
  echo "[harness] saved $out"
  kill "$game" "$xvfb" 2>/dev/null || true
  wineserver -k 2>/dev/null || true
}

case "${1:-run}" in
  run)        shift || true; run_game "$@" ;;
  screenshot) screenshot_game ;;
  load)       shift || true; load_tdt "$@" ;;
  shell)      init_prefix; install_game; exec bash ;;
  *)          exec "$@" ;;
esac
