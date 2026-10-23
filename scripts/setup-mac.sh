#!/usr/bin/env bash
# One-shot setup for a Mac (idempotent; safe to re-run). Windows + WSL: scripts/setup.ps1.
#
#   bash scripts/setup-mac.sh [--env-profile <name>] [--skip-hooks]
#
#   0. --env-profile <name> copies .env.<name> to .env (machine settings; see .env.example)
#   1. checks prerequisites (Node 20+, Ulanzi Studio, jq/curl; tmux, claude, gh, glab are optional)
#   2. npm install
#   3. links the plugin into Ulanzi Studio (symlink → this repo)
#   4. installs the Claude Code hooks + statusLine into ~/.claude/settings.json (backup first)
#   5. generates the "ulanzi-lab" profile from an existing D200X profile and makes it current
set -uo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
APP="/Applications/Ulanzi Studio.app"
PROFILES="$HOME/Library/Application Support/Ulanzi/UlanziDeck/ProfilesV2"
ENV_PROFILE=""
SKIP_HOOKS=0
while [ $# -gt 0 ]; do
  case "$1" in
    --env-profile) ENV_PROFILE="$2"; shift ;;
    --skip-hooks) SKIP_HOOKS=1 ;;
    *) echo "unknown option $1"; exit 1 ;;
  esac
  shift
done

ok=1
step() { printf '\n\033[36m== %s\033[0m\n' "$1"; }
good() { printf '  \033[32mok\033[0m  %s\n' "$1"; }
warn() { printf '  \033[33m!!\033[0m  %s\n' "$1"; }
fail() { printf '  \033[31mXX\033[0m  %s\n' "$1"; ok=0; }

step 'Machine settings (.env)'
if [ -n "$ENV_PROFILE" ]; then
  [ -f "$REPO/.env.$ENV_PROFILE" ] || { fail "$REPO/.env.$ENV_PROFILE not found"; exit 1; }
  [ -f "$REPO/.env" ] && cp "$REPO/.env" "$REPO/.env.bak"
  cp "$REPO/.env.$ENV_PROFILE" "$REPO/.env"
  good ".env <- .env.$ENV_PROFILE"
elif [ -f "$REPO/.env" ]; then good '.env present'
else warn 'no .env: using defaults (copy .env.example to .env, or pass --env-profile <name>)'
fi

step 'Prerequisites'
if command -v node >/dev/null; then
  major="$(node -p 'process.versions.node.split(".")[0]')"
  [ "$major" -ge 20 ] && good "node $(node -v)" || fail "node $(node -v) is too old (need 20+: brew install node)"
else fail 'Node.js not found (brew install node)'; fi
[ -d "$APP" ] && good 'Ulanzi Studio installed' || fail "Ulanzi Studio not found at $APP (install from ulanzi.com)"
for t in jq curl; do command -v "$t" >/dev/null && good "$t" || fail "$t is missing (brew install $t)"; done
for t in tmux claude gh glab SwitchAudioSource; do
  if command -v "$t" >/dev/null; then good "$t"
  else
    case "$t" in
      tmux) why='Claude Pad / exact focus (brew install tmux)' ;;
      claude) why='Claude Code' ;;
      gh) why='GitHub keys (brew install gh)' ;;
      glab) why='GitLab keys (brew install glab)' ;;
      SwitchAudioSource) why='audio output key (brew install switchaudio-osx)' ;;
    esac
    warn "no $t (optional: $why)"
  fi
done
[ "$ok" = 1 ] || { printf '\n\033[31mFix the XX items above and re-run.\033[0m\n'; exit 1; }

step 'npm install'
(cd "$REPO" && npm install --no-audit --no-fund) || { fail 'npm install failed'; exit 1; }
good 'dependencies installed'

step 'Link plugin into Ulanzi Studio'
bash "$REPO/scripts/link-plugin.sh" --no-restart || exit 1

if [ "$SKIP_HOOKS" = 0 ]; then
  step 'Claude Code hooks'
  bash "$REPO/scripts/install-hooks.sh" || exit 1
fi

step 'Ulanzi Studio profile'
if ! grep -qs '"Model" *: *"D200X"' "$PROFILES"/*.ulanziProfile/manifest.json; then
  warn 'No D200X profile yet: connect the D200X, open Ulanzi Studio once (it creates "Default Profile"), then re-run.'
  open -a "$APP" 2>/dev/null
  exit 0
fi
(cd "$REPO" && node scripts/make-profile.mjs --activate --no-restart) || exit 1
open -a "$APP"

step 'Done'
good 'Ulanzi Studio started with the ulanzi-lab profile.'
good 'Browser preview: http://127.0.0.1:39300/'
cat <<'EOF'
  macOS asks for permissions the first time a key needs them. Allow them for "Ulanzi Studio":
    - Accessibility (System Settings > Privacy & Security): window layout keys, raising windows
    - Automation: System Events, iTerm2 / Terminal (focus a session's tab), Spotify / Music (media keys)
  New Claude Code sessions report to the deck; running ones pick the hooks up on their next event.
EOF
