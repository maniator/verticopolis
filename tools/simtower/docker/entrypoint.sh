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
  local screen="${SCREEN:-1024x768}"
  # SCREEN is a WxH value (the depth is appended below as x24). Reject an
  # Xvfb-style "WxHxD" or any non-WxH input rather than feed a malformed
  # geometry to Xvfb / the desktop.
  if ! [[ "$screen" =~ ^[0-9]+x[0-9]+$ ]]; then
    echo "[harness] invalid SCREEN='${screen}' (want WxH, e.g. 1024x768); using 1024x768" >&2
    screen="1024x768"
  fi
  Xvfb :99 -screen 0 "${screen}x24" >/dev/null 2>&1 &
  local xvfb=$!
  export DISPLAY=:99
  sleep 2
  # Launch inside a Wine virtual desktop (a single managed top-level window), so
  # the main tower window reliably composites onto the Xvfb root; plain
  # `wine simtower.exe` leaves the main window unmapped without a window manager
  # (only its modal dialogs show), which screenshots as black. A wider SCREEN
  # (e.g. 1900x1000) fits more of a tall/wide tower in one shot.
  ( cd "$INSTALL" && wine explorer "/desktop=SimTower,${screen}" simtower.exe "$win_path" >/dev/null 2>&1 ) &
  local game=$!
  # The disc's wavmix16.dll pops a sequence of modal boxes on boot (a "not
  # installed" warning, a GetModuleFileName debug box) plus the "no sound card"
  # prompt, at varying positions/timing. Click across the whole OK/Yes button
  # zone repeatedly (dialogs are centered; buttons sit around y 410-455) to clear
  # whichever is up, then let the tower render. Clicks only (no Return), so a
  # stray keypress can't reach the loaded game and trigger a menu/exit.
  sleep 8
  # Click across the OK/Yes button zone AND advance the post-dialog title splash
  # (which needs a click anywhere and can appear late on a cold boot). Keep
  # clicking long enough to clear a slow splash, then STOP and let the tower
  # settle before the shot so we don't catch a transient. Tunable via CLICK_SECS.
  # Coerce to a positive integer so a misconfigured "30s" / "" / negative value
  # can't hard-fail the whole harness through `seq` under `set -euo pipefail`.
  local click_secs="${CLICK_SECS:-30}"
  if ! [[ "$click_secs" =~ ^[0-9]+$ ]] || [ "$click_secs" -lt 1 ]; then
    echo "[harness] invalid CLICK_SECS=${click_secs}; defaulting to 30" >&2
    click_secs=30
  fi
  # Dialogs center on the Xvfb screen; derive the center from SCREEN so the
  # OK/Yes clicks land at any resolution (default 1024x768 -> 512,384). Buttons
  # sit just below and to either side of center, so sweep a 2D grid around it.
  local sw="${screen%%x*}"; local sh="${screen##*x}"
  [[ "$sw" =~ ^[0-9]+$ ]] || sw=1024; [[ "$sh" =~ ^[0-9]+$ ]] || sh=768
  local cx=$(( sw / 2 )); local cy=$(( sh / 2 ))
  for _ in $(seq 1 "$click_secs"); do
    for dx in -60 -30 0 30 60; do
      for dy in 20 35 50 70; do
        xdotool mousemove $(( cx + dx )) $(( cy + dy )) click 1 >/dev/null 2>&1 || true
      done
    done
    sleep 1
  done
  # Optional: maximize the inner tower window to fill a wide SCREEN so the whole
  # tower width fits one shot. The main window's title bar sits just under the
  # top status strip; a double-click there toggles maximize. Its default
  # position is near the desktop's left, title bar around y 68.
  if [ "${MAXIMIZE:-0}" = "1" ]; then
    # The window launches near the desktop's top-left at its default ~808px
    # width (title bar ~y68). Click its maximize button (top-right ~x985) and
    # also double-click the title bar center as a fallback.
    xdotool mousemove 985 68 click 1 >/dev/null 2>&1 || true
    sleep 1
    xdotool mousemove 600 68 click --repeat 2 --delay 120 1 >/dev/null 2>&1 || true
    sleep 2
  fi
  # Optional zoom toggle: ZOOM_CLICKS>0 selects the palette magnifier tool, then
  # clicks the tower to toggle SimTower's zoom so the whole tower (or, toggled
  # the other way, a legible close-up) fits one screenshot. The magnifier sits
  # in the floating tool palette; the tower fills the desktop center. The
  # tower-click point is tunable via ZOOM_TILE_X/ZOOM_TILE_Y (default 600,350,
  # which assumes a tall tower whose body reaches the vertical center): a SHORT
  # tower's body sits at the ground line, so the default click lands in empty
  # sky and the toggle silently no-ops. Aim ZOOM_TILE_Y near the ground row
  # (and ZOOM_TILE_X over the tower's built columns) to zoom a short tower.
  # The magnifier tool position is likewise tunable via ZOOM_TOOL_X/ZOOM_TOOL_Y.
  # Diagnostic only; default 0 leaves the saved zoom untouched.
  local zoom_clicks="${ZOOM_CLICKS:-0}"
  # Coordinates are screen pixels: coerce each to a non-negative integer, falling
  # back to the default (and warning) on a non-numeric/negative value, exactly
  # like CLICK_SECS above. Without this an "x=" typo would make xdotool fail and,
  # since every xdotool call is `|| true`, the zoom toggle would silently no-op.
  local zoom_tool_x="${ZOOM_TOOL_X:-187}"; local zoom_tool_y="${ZOOM_TOOL_Y:-229}"
  local zoom_tile_x="${ZOOM_TILE_X:-600}"; local zoom_tile_y="${ZOOM_TILE_Y:-350}"
  local _zn _zd
  for _zn in zoom_tool_x:187 zoom_tool_y:229 zoom_tile_x:600 zoom_tile_y:350; do
    local _var="${_zn%%:*}"; _zd="${_zn##*:}"
    if ! [[ "${!_var}" =~ ^[0-9]+$ ]]; then
      echo "[harness] invalid ${_var^^}='${!_var}'; using ${_zd}" >&2
      printf -v "$_var" '%s' "$_zd"
    fi
  done
  if [[ "$zoom_clicks" =~ ^[0-9]+$ ]] && [ "$zoom_clicks" -ge 1 ]; then
    for _ in $(seq 1 "$zoom_clicks"); do
      xdotool mousemove "$zoom_tool_x" "$zoom_tool_y" click 1 >/dev/null 2>&1 || true  # select magnifier tool
      sleep 1
      xdotool mousemove "$zoom_tile_x" "$zoom_tile_y" click 1 >/dev/null 2>&1 || true  # click tower to toggle zoom
      sleep 2
    done
  fi
  sleep "$delay"
  import -window root "$out" || true
  echo "[harness] saved $out"
  kill "$game" "$xvfb" 2>/dev/null || true
  wineserver -k 2>/dev/null || true
}

# Load a .TDT, then drive File -> Save As so the REAL game rewrites it in its
# own canonical bytes (round-trip verification: our export -> game -> disk).
#   save  <tdt-path-in-container>  [<out-win-path>]
# The output path is optional and defaults to C:\saves\GAMEOUT.TDT.
# e.g. save /wine/drive_c/saves/TOWER1.TDT 'C:\saves\GAMEOUT.TDT'
save_tdt() {
  init_prefix
  install_game
  local tdt="${1:?usage: save <in.TDT> [<out-win-path>]}"
  local outwin="${2:-C:\\saves\\GAMEOUT.TDT}"
  local shot="${SHOT_OUT:-/wine/save-shot.png}"
  local win_path
  win_path="$(winepath -w "$tdt" 2>/dev/null || echo "$tdt")"
  # Resolve the Windows target to its mounted unix path so we can verify the
  # real game actually wrote it. Remove any stale file first: the UI-driving
  # xdotool steps below all `|| true`, so without this check a missed click or
  # a rejected path would still exit 0 and let a caller diff a stale/absent
  # file and think the game rewrote the bytes.
  local out_unix
  out_unix="$(winepath -u "$outwin" 2>/dev/null || echo "")"
  [ -n "$out_unix" ] && rm -f "$out_unix" 2>/dev/null || true
  local screen="${SCREEN:-1024x768}"
  [[ "$screen" =~ ^[0-9]+x[0-9]+$ ]] || screen="1024x768"
  echo "[harness] loading $win_path then File>Save As -> $outwin ..."
  Xvfb :99 -screen 0 "${screen}x24" >/dev/null 2>&1 &
  local xvfb=$!
  export DISPLAY=:99
  sleep 2
  ( cd "$INSTALL" && wine explorer "/desktop=SimTower,${screen}" simtower.exe "$win_path" >/dev/null 2>&1 ) &
  local game=$!
  # Clear the boot dialogs (same sweep as load_tdt).
  local sw="${screen%%x*}"; local sh="${screen##*x}"
  [[ "$sw" =~ ^[0-9]+$ ]] || sw=1024; [[ "$sh" =~ ^[0-9]+$ ]] || sh=768
  local cx=$(( sw / 2 )); local cy=$(( sh / 2 ))
  sleep 8
  for _ in $(seq 1 "${CLICK_SECS:-16}"); do
    for dx in -60 -30 0 30 60; do
      for dy in 20 35 50 70; do
        xdotool mousemove $(( cx + dx )) $(( cy + dy )) click 1 >/dev/null 2>&1 || true
      done
    done
    sleep 1
  done
  # Open the File menu and pick Save As. The inner tower window must hold focus
  # first (click its title bar), then click the "File" menu text to drop it, and
  # click the "Save Tower As..." item. Coordinates are for the default ~810px-wide
  # window Wine places near the desktop's upper-left; tune via SAVE_* env.
  sleep 2
  local file_x="${SAVE_FILE_X:-220}"; local file_y="${SAVE_FILE_Y:-93}"
  local title_x="${SAVE_TITLE_X:-600}"; local title_y="${SAVE_TITLE_Y:-69}"
  local item_x="${SAVE_ITEM_X:-240}"; local item_y="${SAVE_ITEM_Y:-172}"
  xdotool mousemove "$title_x" "$title_y" click 1 >/dev/null 2>&1 || true  # focus window
  sleep 1
  xdotool mousemove "$file_x" "$file_y" click 1 >/dev/null 2>&1 || true    # open File menu
  sleep 1
  import -window root "${shot%.png}-menu.png" 2>/dev/null || true          # diagnostic: open menu
  xdotool mousemove "$item_x" "$item_y" click 1 >/dev/null 2>&1 || true    # Save Tower As...
  sleep 2
  import -window root "${shot%.png}-dialog.png" 2>/dev/null || true        # diagnostic: save dialog
  # Click the File Name edit field, clear it, and type the full target path.
  local fn_x="${SAVE_FN_X:-338}"; local fn_y="${SAVE_FN_Y:-176}"
  local ok_x="${SAVE_OK_X:-610}"; local ok_y="${SAVE_OK_Y:-161}"
  xdotool mousemove "$fn_x" "$fn_y" click 1 >/dev/null 2>&1 || true        # focus File Name field
  sleep 1
  xdotool key --clearmodifiers ctrl+a >/dev/null 2>&1 || true             # select-all (Wine commdlg)
  xdotool key --clearmodifiers Delete >/dev/null 2>&1 || true
  # Fallback clear: a run of backspaces in case select-all did not take.
  for _ in $(seq 1 20); do xdotool key --clearmodifiers BackSpace >/dev/null 2>&1 || true; done
  xdotool type --delay 60 "$outwin" >/dev/null 2>&1 || true
  sleep 1
  import -window root "${shot%.png}-typed.png" 2>/dev/null || true         # diagnostic: field content
  xdotool mousemove "$ok_x" "$ok_y" click 1 >/dev/null 2>&1 || true        # click OK
  sleep 3
  xdotool key Return >/dev/null 2>&1 || true   # accept any replace-confirm
  xdotool key y >/dev/null 2>&1 || true
  sleep 3
  import -window root "$shot" || true
  kill "$game" "$xvfb" 2>/dev/null || true
  wineserver -k 2>/dev/null || true
  # The whole point of this mode is a trustworthy round-trip artifact, so fail
  # loudly if the game did not actually write the file (a missed menu click, a
  # rejected path, or an unavailable dialog). A caller must never diff a stale
  # or absent output and conclude the real game rewrote the bytes.
  if [ -z "$out_unix" ] || [ ! -s "$out_unix" ]; then
    echo "[harness] ERROR: expected save output not written: $outwin ($out_unix); shot at $shot" >&2
    return 1
  fi
  echo "[harness] saved $outwin ($(stat -c%s "$out_unix") bytes); shot at $shot"
}

case "${1:-run}" in
  run)        shift || true; run_game "$@" ;;
  screenshot) screenshot_game ;;
  load)       shift || true; load_tdt "$@" ;;
  save)       shift || true; save_tdt "$@" ;;
  shell)      init_prefix; install_game; exec bash ;;
  *)          exec "$@" ;;
esac
