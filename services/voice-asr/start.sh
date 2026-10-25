#!/usr/bin/env bash
# Run the speech-to-text service in the foreground. The plugin starts it this way, holding stdin open; the service
# exits when stdin closes or after 15 idle minutes. Extra arguments go to server.py (e.g. --preload breeze-asr-25).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
HOME_DIR="${VOICE_ASR_HOME:-$HOME/.local/share/ulanzi-lab/voice-asr}"
[ -x "$HOME_DIR/.venv/bin/python" ] || { echo "voice-asr is not installed; run services/voice-asr/install.sh" >&2; exit 3; }
exec "$HOME_DIR/.venv/bin/python" "$HERE/server.py" --idle-exit "${VOICE_ASR_IDLE:-900}" --exit-on-stdin-eof "$@"
