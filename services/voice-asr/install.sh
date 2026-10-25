#!/usr/bin/env bash
# Install the local speech-to-text service (WSL / Linux, CPU): a venv plus Breeze-ASR converted to CTranslate2 int8.
#   services/voice-asr/install.sh           # Breeze-ASR-25 (Taiwanese Mandarin + code-switching)
#   services/voice-asr/install.sh --taigi   # also Breeze-ASR-26 (Taiwanese Hokkien speech → Mandarin text)
# Everything goes under $VOICE_ASR_HOME (default ~/.local/share/ulanzi-lab/voice-asr); the repo stays clean.
# The official weights are downloaded at a pinned revision and converted here; no third-party conversions.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
HOME_DIR="${VOICE_ASR_HOME:-$HOME/.local/share/ulanzi-lab/voice-asr}"
die() { echo "voice-asr: $*" >&2; exit 1; }
command -v uv >/dev/null || die "needs uv (https://docs.astral.sh/uv/)"
# uv 0.9 is the first to download 3.14 final (0.8 picks a beta or release candidate; older lacks venv --clear).
# A newer uv also knows newer patch releases, so keep it current: uv self update.
uvv="$(uv --version | awk '{print $2}')"
[ "${uvv%%.*}" -gt 0 ] || [ "$(echo "$uvv" | cut -d. -f2)" -ge 9 ] || die "needs uv 0.9 or newer (found $uvv): uv self update"
# The running service imports packages lazily, so rebuilding its venv under it breaks it until it restarts.
idle() { ! pgrep -f -- "$HOME_DIR/.venv/bin/python" >/dev/null || die "the service is running: quit Ulanzi Studio (or wait for its idle exit), then run this again"; }
idle

PY=3.14 # every runtime wheel (ctranslate2, onnxruntime, av, tokenizers) and CPU torch exists for it
uv python install -q "$PY"
uv python upgrade -q "$PY" # newest patch release, with its security fixes
final() { "$1/bin/python" -c 'import sys; sys.exit(sys.version_info.releaselevel != "final")'; }

# Build the new venv next to the old one and swap only when it is complete, so a failed install keeps a working one.
mkdir -p "$HOME_DIR/models"
uv venv -q --clear --relocatable --managed-python -p "$PY" "$HOME_DIR/.venv.new"
final "$HOME_DIR/.venv.new" || die "uv installed a pre-release Python: uv self update, then run this again"
VIRTUAL_ENV="$HOME_DIR/.venv.new" uv pip install -q -r "$HERE/requirements.txt"
idle # again: the plugin may have started the service during the install (.venv.new stays for the next run)
rm -rf "$HOME_DIR/.venv.old"
[ ! -e "$HOME_DIR/.venv" ] || mv "$HOME_DIR/.venv" "$HOME_DIR/.venv.old" # kept until the new one is in place
mv "$HOME_DIR/.venv.new" "$HOME_DIR/.venv"
rm -rf "$HOME_DIR/.venv.old"

CONVERT="$HOME_DIR/.convert-venv"
convert() { # name repo revision
  local out="$HOME_DIR/models/$1-ct2-int8"
  if [ -f "$out/model.bin" ] && [ -f "$out/tokenizer.json" ]; then echo "$1: installed"; return; fi
  if [ ! -x "$CONVERT/bin/ct2-transformers-converter" ]; then
    uv venv -q --clear --managed-python -p "$PY" "$CONVERT"
    VIRTUAL_ENV="$CONVERT" uv pip install -q -r "$HERE/requirements-convert.txt" \
      --index-strategy unsafe-best-match --extra-index-url https://download.pytorch.org/whl/cpu
  fi
  echo "$1: downloading $2@$3 and converting to int8…"
  "$CONVERT/bin/ct2-transformers-converter" --model "$2" --revision "$3" --output_dir "$out" \
    --quantization int8 --copy_files preprocessor_config.json --force
  # Not every Breeze repo ships tokenizer.json, which faster-whisper reads; build it from the repo's tokenizer files.
  "$CONVERT/bin/python" -c "import sys; from transformers import WhisperTokenizerFast as T; T.from_pretrained(sys.argv[1], revision=sys.argv[2]).save_pretrained(sys.argv[3])" "$2" "$3" "$out"
}
convert breeze-asr-25 MediaTek-Research/Breeze-ASR-25 cffe7ccb404d025296a00758d0a33468bec3a9d0
[ "${1:-}" = "--taigi" ] && convert breeze-asr-26 MediaTek-Research/Breeze-ASR-26 7b992682e7f5ceedd0a41ebec240f01ba469d19e
rm -rf "$CONVERT" # torch is only needed for conversion

echo "voice-asr installed in $HOME_DIR"
echo "start: $HERE/start.sh   (the plugin does this itself when a Voice key needs it)"
