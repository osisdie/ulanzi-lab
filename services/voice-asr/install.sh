#!/usr/bin/env bash
# Install the local speech-to-text service (WSL / Linux, CPU): a venv plus Breeze-ASR converted to CTranslate2 int8.
#   services/voice-asr/install.sh           # Breeze-ASR-25 (Taiwanese Mandarin + code-switching)
#   services/voice-asr/install.sh --taigi   # also Breeze-ASR-26 (Taiwanese Hokkien speech → Mandarin text)
# Everything goes under $VOICE_ASR_HOME (default ~/.local/share/ulanzi-lab/voice-asr); the repo stays clean.
# The official weights are downloaded at a pinned revision and converted here; no third-party conversions.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
HOME_DIR="${VOICE_ASR_HOME:-$HOME/.local/share/ulanzi-lab/voice-asr}"
command -v uv >/dev/null || { echo "voice-asr: needs uv (https://docs.astral.sh/uv/)" >&2; exit 1; }

mkdir -p "$HOME_DIR/models"
uv venv -q --allow-existing -p 3.11 "$HOME_DIR/.venv"
VIRTUAL_ENV="$HOME_DIR/.venv" uv pip install -q -r "$HERE/requirements.txt"

CONVERT="$HOME_DIR/.convert-venv"
convert() { # name repo revision
  local out="$HOME_DIR/models/$1-ct2-int8"
  if [ -f "$out/model.bin" ] && [ -f "$out/tokenizer.json" ]; then echo "$1: installed"; return; fi
  if [ ! -x "$CONVERT/bin/ct2-transformers-converter" ]; then
    uv venv -q --allow-existing -p 3.11 "$CONVERT"
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
