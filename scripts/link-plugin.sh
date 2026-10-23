#!/usr/bin/env bash
# macOS: link the repo plugin into Ulanzi Studio's plugin folder (symlink) and restart Ulanzi Studio.
# (Windows: scripts/link-plugin.ps1.)
#
#   bash scripts/link-plugin.sh [--plugin <folder>] [--no-restart] [--unlink]
#   --plugin defaults to plugin/com.ulanzi.nwpie.ulanziPlugin (any folder whose name ends in .ulanziPlugin works)
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
PLUGIN="plugin/com.ulanzi.nwpie.ulanziPlugin"
RESTART=1
UNLINK=0
while [ $# -gt 0 ]; do
  case "$1" in
    --plugin) PLUGIN="$2"; shift ;;
    --no-restart) RESTART=0 ;;
    --unlink) UNLINK=1 ;;
    *) echo "unknown option $1"; exit 1 ;;
  esac
  shift
done

SRC="$(cd "$REPO/$PLUGIN" && pwd)"
DST_DIR="$HOME/Library/Application Support/Ulanzi/UlanziDeck/Plugins"
DST="$DST_DIR/$(basename "$SRC")"
APP="/Applications/Ulanzi Studio.app"

mkdir -p "$DST_DIR"
if [ -L "$DST" ]; then
  rm "$DST" # removes the link only, never the repo files
elif [ -e "$DST" ]; then
  echo "$DST exists and is not a symlink; move it away first."; exit 1
fi
if [ "$UNLINK" = 1 ]; then
  echo "unlinked $DST"
else
  ln -s "$SRC" "$DST"
  echo "linked $DST -> $SRC"
fi

if [ "$RESTART" = 1 ]; then
  running() { pgrep -f "$APP/Contents/MacOS/" >/dev/null; }
  if running; then
    osascript -e 'quit app "Ulanzi Studio"' >/dev/null 2>&1 || true
    for _ in $(seq 1 40); do running || break; sleep 0.25; done
    running && pkill -f "$APP/Contents/MacOS/" || true
    sleep 1
  fi
  open -a "$APP"
  echo 'Ulanzi Studio restarted'
fi
