#!/usr/bin/env bash
# Checks for the shell side: syntax of every script, what the hook and statusLine post, and the hook installer.
# CI runs this on Linux, inside WSL, and on macOS (whose /bin/bash is 3.2). Needs jq.
#   bash test/ci/shell-checks.sh
set -euo pipefail
cd "$(dirname "$0")/../.."

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
pass() { printf 'ok  %s\n' "$1"; }

for f in hooks/*.sh statusline/*.sh scripts/*.sh services/*/*.sh test/ci/*.sh; do bash -n "$f"; done
pass 'bash -n on every script'
if command -v python3 >/dev/null; then
  for f in services/*/*.py; do python3 -c 'import ast, sys; ast.parse(open(sys.argv[1], encoding="utf-8").read(), sys.argv[1])' "$f"; done
  pass 'python syntax of services/'
fi

# Stub curl: record what would be posted to the hub, by path.
mkdir -p "$tmp/bin"
cat > "$tmp/bin/curl" <<EOF
#!/usr/bin/env bash
data=""; url=""
while [ \$# -gt 0 ]; do case "\$1" in --data-binary) data="\$2"; shift ;; http*) url="\$1" ;; esac; shift; done
printf '%s' "\$data" > "$tmp/post\${url##*/}.json"
EOF
chmod +x "$tmp/bin/curl"
await() { for _ in $(seq 1 50); do [ -s "$1" ] && return 0; sleep 0.1; done; echo "timed out waiting for $1"; return 1; }

case "$(uname -s)" in Darwin) want=mac ;; *) if [ -n "${WSL_DISTRO_NAME:-}" ]; then want=wsl; else want=win; fi ;; esac
echo '{"session_id":"s1","hook_event_name":"PreToolUse","cwd":"/x/proj","tool_name":"Bash","tool_input":{"command":"rm -rf /"},"prompt":"secret"}' \
  | PATH="$tmp/bin:$PATH" bash hooks/ulanzi-hook.sh
await "$tmp/posthook.json"
jq -e --arg src "$want" '
  .session_id == "s1" and .hook_event_name == "PreToolUse" and .tool_name == "Bash"
  and (.ts | type == "number" and . > 1e12) and .focus.src == $src
  and (has("prompt") | not) and (has("tool_input") | not)' "$tmp/posthook.json" >/dev/null \
  || { echo "unexpected hook payload:"; cat "$tmp/posthook.json"; exit 1; }
pass "hook posts allowlisted fields only, ms timestamp, src=$want"

status='{"session_id":"s1","model":{"display_name":"Model X"},"context_window":{"used_percentage":42},"cost":{"total_cost_usd":1.234},"rate_limits":{"five_hour":{"used_percentage":63}},"transcript_path":"/secret"}'
line="$(printf '%s' "$status" | PATH="$tmp/bin:$PATH" bash statusline/ulanzi-statusline.sh)"
await "$tmp/postusage.json"
case "$line" in *'ctx 42%'*'5h 63%'*'$1.23'*) ;; *) echo "unexpected statusline: $line"; exit 1 ;; esac
jq -e '.session_id == "s1" and .context_window.used_percentage == 42 and (has("transcript_path") | not)' "$tmp/postusage.json" >/dev/null
pass 'statusLine prints a summary and posts usage without the transcript path'

home="$tmp/home"
mkdir -p "$home/.claude"
echo '{"hooks":{"Notification":[{"matcher":"permission_prompt","hooks":[{"type":"command","command":"chime.sh"}]}]}}' > "$home/.claude/settings.json"
ours() { jq '[.hooks[][].hooks[] | select(.command | test("/[.]claude/ulanzi-lab/"))] | length' "$home/.claude/settings.json"; }
HOME="$home" bash scripts/install-hooks.sh >/dev/null
n="$(ours)"
[ "$n" -gt 10 ] || { echo "expected our hooks, got $n"; exit 1; }
jq -e '.hooks.Notification[] | select(.matcher == "permission_prompt") | .hooks | map(.command) | index("chime.sh") != null' "$home/.claude/settings.json" >/dev/null
jq -e '.statusLine.command | test("ulanzi-statusline.sh")' "$home/.claude/settings.json" >/dev/null
HOME="$home" bash scripts/install-hooks.sh >/dev/null
[ "$(ours)" = "$n" ] || { echo 'install is not idempotent'; exit 1; }
HOME="$home" bash scripts/install-hooks.sh --uninstall >/dev/null
[ "$(ours)" = 0 ] && jq -e '(.statusLine | not) and (.hooks.Notification[0].hooks[0].command == "chime.sh")' "$home/.claude/settings.json" >/dev/null \
  || { echo 'uninstall left our hooks or removed the user hook'; exit 1; }
pass 'install-hooks.sh installs, is idempotent, keeps user hooks, uninstalls'

chk() { printf '%s\n' "$1" | bash scripts/check-commit-message.sh 2>/dev/null; }
chk 'fix(voice): keep segments on failure' && chk $'feat: x\n\n# Co-Authored-By in a git comment line is ignored' \
  && ! chk $'feat: x\n\nCo-Authored-By: Someone <a@b.c>' && ! chk 'docs: written with Claude' && ! chk 'chore: Sonnet 4 notes' \
  && ! chk 'see noreply@ANTHROPIC.com' && chk 'docs: sonnets and opusculum are fine' \
  || { echo 'check-commit-message.sh accepts or rejects the wrong messages'; exit 1; }
pass 'check-commit-message.sh rejects co-author and AI tool credits'
