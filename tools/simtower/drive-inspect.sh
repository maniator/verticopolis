#!/usr/bin/env bash
# #575 economy-read driver: load ECONVER.TDT in the real game, then click a
# sequence of facility tiles and screenshot the inspector window each time, so
# we can read the retail game's OWN rent/price dollar figure per rent class.
#
# TARGETS is a semicolon list of "x,y,label"; for each we click, settle, and
# save /wine/insp-<label>.png. The SimTower facility-info window is modeless and
# updates when you click a different facility, so one launch reads them all.
set -uo pipefail

INSTALL="$WINEPREFIX/drive_c/SIMTOWER"
TDT='C:\saves\ECONVER.TDT'
SCREEN="${SCREEN:-1280x800}"
ZOOM_CLICKS="${ZOOM_CLICKS:-0}"
ZOOM_TOOL_X="${ZOOM_TOOL_X:-16}"; ZOOM_TOOL_Y="${ZOOM_TOOL_Y:-170}"
ZOOM_TILE_X="${ZOOM_TILE_X:-140}"; ZOOM_TILE_Y="${ZOOM_TILE_Y:-300}"
TARGETS="${TARGETS:-90,285,test}"

# Clean up the background Xvfb/Wine processes on ANY exit (normal end, error, or
# Ctrl-C), so an early failure never leaves them running.
game=""; xvfb=""
cleanup() {
  [ -n "$game" ] && kill "$game" 2>/dev/null || true
  [ -n "$xvfb" ] && kill "$xvfb" 2>/dev/null || true
  wineserver -k 2>/dev/null || true
}
trap cleanup EXIT INT TERM

Xvfb :99 -screen 0 "${SCREEN}x24" >/dev/null 2>&1 &
xvfb=$!
export DISPLAY=:99
sleep 2
( cd "$INSTALL" && wine explorer "/desktop=SimTower,${SCREEN}" simtower.exe "$TDT" >/dev/null 2>&1 ) &
game=$!

# Clear the boot dialogs (centered on the desktop). Click the OK/Yes zone only.
sw="${SCREEN%%x*}"; sh="${SCREEN##*x}"; cx=$(( sw/2 )); cy=$(( sh/2 ))
sleep 10
for _ in $(seq 1 20); do
  for dx in -60 -30 0 30 60; do for dy in 20 35 50; do
    xdotool mousemove $(( cx+dx )) $(( cy+dy )) click 1 >/dev/null 2>&1 || true
  done; done
  sleep 1
done
sleep 3
import -window root /wine/insp-baseline.png 2>/dev/null || true

# Optionally let the game RUN so the crowd rebuilds and offices staff up (a
# fresh load has occupied ART but zero live tenants, and an info window on a
# zero-tenant unit divides by zero -> black crash). RUN_SECS>0 waits, capturing
# the status bar so we can watch Pop climb.
RUN_SECS="${RUN_SECS:-0}"
if [ "$RUN_SECS" -ge 1 ] 2>/dev/null; then
  waited=0
  while [ "$waited" -lt "$RUN_SECS" ]; do
    sleep 20; waited=$(( waited + 20 ))
    import -window root "/wine/insp-run${waited}.png" 2>/dev/null || true
  done
fi

# Optional zoom-in to enlarge the rooms before clicking.
if [ "$ZOOM_CLICKS" -ge 1 ] 2>/dev/null; then
  for _ in $(seq 1 "$ZOOM_CLICKS"); do
    xdotool mousemove "$ZOOM_TOOL_X" "$ZOOM_TOOL_Y" click 1 >/dev/null 2>&1 || true
    sleep 1
    xdotool mousemove "$ZOOM_TILE_X" "$ZOOM_TILE_Y" click 1 >/dev/null 2>&1 || true
    sleep 2
  done
  import -window root /wine/insp-zoomed.png 2>/dev/null || true
fi

# Select the hand/pointer (query) tool so a facility click opens its info window
# rather than building/bulldozing. Palette hand pointer sits at ~167,229.
POINTER_X="${POINTER_X:-167}"; POINTER_Y="${POINTER_Y:-229}"
if [ "${SELECT_POINTER:-1}" = "1" ]; then
  xdotool mousemove "$POINTER_X" "$POINTER_Y" click 1 >/dev/null 2>&1 || true
  sleep 1
fi

IFS=';' read -ra items <<< "$TARGETS"
for it in "${items[@]}"; do
  IFS=',' read -r x y label <<< "$it"
  [ -z "${label:-}" ] && continue
  xdotool mousemove "$x" "$y" click 1 >/dev/null 2>&1 || true
  sleep 3
  import -window root "/wine/insp-${label}.png" 2>/dev/null || true
  echo "clicked ($x,$y) -> insp-${label}.png"
done

kill "$game" "$xvfb" 2>/dev/null || true
wineserver -k 2>/dev/null || true
echo "done"
