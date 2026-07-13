#!/usr/bin/env bash
# Launch the retail SimTower under Wine-in-Docker so it can read/write real
# .TDT saves for round-trip testing of the vctower <-> tdt code.
#
#   ./run.sh                # launch SimTower in a WSLg window
#   ./run.sh screenshot     # headless boot, write ./wineprefix/shot.png
#   ./run.sh shell          # bash inside the container (game at C:\SIMTOWER)
#   ./run.sh build          # (re)build the image
#   ./run.sh extract        # (re)pull game files + manuals off the ISO
#
# Saves: point SimTower's save dialog at C:\saves (host: ./saves) or C:\SIMTOWER.
# Both live under ./wineprefix on the host and feed directly into the tdt tests.
set -euo pipefail

cd "$(dirname "$0")"
IMAGE=simtower-wine
PREFIX="$PWD/wineprefix"
GAMEDATA="$PWD/gamedata"
SAVES="$PWD/saves"

ensure_gamedata() {
  if [ ! -f "$GAMEDATA/SIMTOWER.EX_" ]; then
    echo "[run] game files missing; extracting from ISO ..."
    python3 extract-cd.py
  fi
}

build() {
  echo "[run] building $IMAGE ..."
  docker build -t "$IMAGE" docker
}

ensure_image() {
  if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
    build
  fi
}

# Assemble docker args for the WSLg GUI (X11 + Wayland + Pulse), falling back
# gracefully when a socket isn't present.
display_args() {
  # The headless modes (load/screenshot) run their OWN Xvfb on :99 inside the
  # container. Mounting the host's /tmp/.X11-unix into them makes that Xvfb fail
  # to bind its :99 socket ("failed to bind listener"), so the capture silently
  # falls back to the host WSLg :0 display and screenshots a blank 1024x768
  # frame. Only the interactive GUI modes (run/shell) need the host display, so
  # gate the mounts on the mode and leave headless modes with a clean namespace.
  local mode="${1:-run}"
  case "$mode" in
    run|shell) ;;
    *) return 0 ;;
  esac
  local args=()
  args+=(-e "DISPLAY=${DISPLAY:-:0}")
  [ -d /tmp/.X11-unix ]        && args+=(-v /tmp/.X11-unix:/tmp/.X11-unix)
  if [ -d /mnt/wslg ]; then
    args+=(-v /mnt/wslg:/mnt/wslg)
    args+=(-e "XDG_RUNTIME_DIR=/mnt/wslg/runtime-dir")
    [ -n "${WAYLAND_DISPLAY:-}" ] && args+=(-e "WAYLAND_DISPLAY=$WAYLAND_DISPLAY")
    [ -S /mnt/wslg/PulseServer ]  && args+=(-e "PULSE_SERVER=/mnt/wslg/PulseServer")
  fi
  printf '%s\n' "${args[@]}"
}

run_container() {
  ensure_gamedata
  ensure_image
  # Pre-create drive_c as the host user: otherwise Docker auto-creates the
  # /wine/drive_c/saves mount parent as root and the in-container user can't
  # write the install dir into a fresh prefix.
  mkdir -p "$PREFIX/drive_c" "$SAVES"
  # Place the genuine 16-bit COMMDLG.DLL into the prefix (recovers after a wipe).
  # It's what the commdlg override below loads to fix the file dialog crash.
  if [ -f "$PWD/native/COMMDLG.DLL" ]; then
    mkdir -p "$PREFIX/drive_c/windows/system"
    cp -n "$PWD/native/COMMDLG.DLL" "$PREFIX/drive_c/windows/system/COMMDLG.DLL" 2>/dev/null || true
  fi
  local dargs; mapfile -t dargs < <(display_args "${1:-run}")
  # Request a TTY only when stdin actually is one. The interactive "run" mode
  # wants -it, but the headless load/screenshot modes are commonly invoked with
  # no terminal (a CI step or a background job), where -t aborts with
  # "cannot attach stdin to a TTY-enabled container".
  local ttyflag=""; [ -t 0 ] && ttyflag="-t"
  # Forward the entrypoint's documented screenshot-tuning hooks when the caller
  # set them in the host shell. Without this passthrough the entrypoint always
  # falls back to its defaults (1024x768, no maximize/zoom), so the load/
  # screenshot modes can't be aimed at a tall/wide tower.
  local envargs=()
  for v in SCREEN MAXIMIZE ZOOM_CLICKS CLICK_SECS SHOT_DELAY SHOT_OUT; do
    [ -n "${!v:-}" ] && envargs+=(-e "$v=${!v}")
  done
  # Run as the host user so Wine accepts the bind-mounted prefix (it refuses a
  # WINEPREFIX not owned by the running user) and so saves stay host-readable.
  # commdlg,commdlg.dll16=n (in WINEDLLOVERRIDES below): load the genuine 16-bit
  # COMMDLG.DLL (placed in the prefix) instead of Wine's builtin, which crashes
  # SimTower's 16-bit file Open/Save dialog. The .dll16 suffix is the key that
  # matches Wine's 16-bit loader; plain commdlg=n does not.
  # Expand envargs/dargs with the `${arr[@]+"${arr[@]}"}` guard so an EMPTY array
  # (headless modes add no display args; no tuning vars set adds no env args)
  # doesn't trip `set -u` on bash <= 4.3, where a bare "${empty[@]}" is an unbound
  # variable error. Harmless on 4.4+.
  docker run --rm -i $ttyflag \
    --user "$(id -u):$(id -g)" \
    -e HOME=/wine \
    -e 'WINEDLLOVERRIDES=mscoree,mshtml=;commdlg,commdlg.dll16=n' \
    ${envargs[@]+"${envargs[@]}"} \
    ${dargs[@]+"${dargs[@]}"} \
    -v "$PREFIX:/wine" \
    -v "$GAMEDATA:/gamedata:ro" \
    -v "$SAVES:/wine/drive_c/saves" \
    "$IMAGE" "$@"
}

case "${1:-run}" in
  build)   build ;;
  extract) python3 extract-cd.py ;;
  *)       run_container "$@" ;;
esac
