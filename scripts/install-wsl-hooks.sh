#!/usr/bin/env bash
# Install (or remove) the ulanzi_lab Claude Code hooks + statusLine into ~/.claude/settings.json.
#
#   bash scripts/install-wsl-hooks.sh            # install / update (idempotent)
#   bash scripts/install-wsl-hooks.sh --dry-run  # print the merged settings, change nothing
#   bash scripts/install-wsl-hooks.sh --uninstall
#
# Existing hooks are kept. Our hook is appended to the existing Notification/permission_prompt
# group (next to the chimes sound) so one event drives both the sound and the deck light.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$HOME/.claude/ulanzi_lab"
SETTINGS="$HOME/.claude/settings.json"
HOOK="$DEST/ulanzi-hook.sh"
STATUS="$DEST/ulanzi-statusline.sh"
MODE="${1:-install}"

command -v jq >/dev/null || { echo "jq is required (sudo apt install jq)"; exit 1; }
[ -f "$SETTINGS" ] || echo '{}' > "$SETTINGS"
jq empty "$SETTINGS" || { echo "$SETTINGS is not valid JSON; aborting"; exit 1; }

strip='
  # remove every hook command that points at our install dir, then drop empty groups/events
  .hooks = ((.hooks // {}) | with_entries(
    .value |= ( map(.hooks |= map(select((.command // "") | contains("/.claude/ulanzi_lab/") | not)))
                | map(select((.hooks | length) > 0)) )
  ) | with_entries(select((.value | length) > 0)))
'

if [ "$MODE" = "--uninstall" ]; then
  cp "$SETTINGS" "$SETTINGS.bak.ulanzi.$(date +%Y%m%d%H%M%S)"
  prev='null'; [ -f "$DEST/prev-statusline.json" ] && prev="$(cat "$DEST/prev-statusline.json")"
  jq --argjson prev "$prev" "$strip"' |
      if (.statusLine.command // "" | contains("/.claude/ulanzi_lab/")) then
        (if $prev == null then del(.statusLine) else .statusLine = $prev end) else . end' "$SETTINGS" > "$SETTINGS.tmp"
  mv "$SETTINGS.tmp" "$SETTINGS"
  echo "removed ulanzi_lab hooks from $SETTINGS (scripts left in $DEST)"
  exit 0
fi

# Copy scripts to the Linux filesystem (fast to exec; no /mnt/c or CRLF surprises).
mkdir -p "$DEST"
for f in "$REPO/hooks/ulanzi-hook.sh" "$REPO/statusline/ulanzi-statusline.sh"; do
  tr -d '\r' < "$f" > "$DEST/$(basename "$f")"
  chmod +x "$DEST/$(basename "$f")"
done

# Remember a pre-existing (non-ulanzi) statusLine so we can wrap it and restore it on uninstall.
if jq -e '.statusLine and ((.statusLine.command // "") | contains("/.claude/ulanzi_lab/") | not)' "$SETTINGS" >/dev/null; then
  jq '.statusLine' "$SETTINGS" > "$DEST/prev-statusline.json"
fi
inner=""
[ -f "$DEST/prev-statusline.json" ] && inner="$(jq -r '.command // ""' "$DEST/prev-statusline.json")"

merged="$(jq --arg hook "$HOOK" --arg status "$STATUS" --arg inner "$inner" "$strip"' |
  def cmd($async): {type: "command", command: $hook, timeout: 5} + (if $async then {async: true} else {} end);
  def add_group($ev; $matcher; $async):
    .hooks[$ev] = ((.hooks[$ev] // []) + [ ({hooks: [cmd($async)]} + (if $matcher then {matcher: $matcher} else {} end)) ]);

  # lifecycle + tool events (high-frequency tool events run async)
  reduce ["SessionStart","UserPromptSubmit","PermissionRequest","PermissionDenied","SubagentStart","SubagentStop",
          "Stop","StopFailure","PreCompact","SessionEnd"][] as $ev (.; add_group($ev; null; false))
  | reduce ["PreToolUse","PostToolUse","PostToolUseFailure"][] as $ev (.; add_group($ev; null; true))

  # Notification: join the existing permission_prompt group (chimes) if there is one
  | if any(.hooks.Notification[]?; .matcher == "permission_prompt")
    then .hooks.Notification |= map(if .matcher == "permission_prompt" then .hooks += [cmd(false)] else . end)
    else add_group("Notification"; "permission_prompt"; false) end
  | reduce ["elicitation_dialog","elicitation_url_dialog","agent_needs_input","idle_prompt"][] as $m (.; add_group("Notification"; $m; false))

  | .statusLine = {type: "command", command: (if $inner != "" then "ULANZI_STATUSLINE_INNER=\($inner | @sh) \($status)" else $status end), refreshInterval: 60}
' "$SETTINGS")"

if [ "$MODE" = "--dry-run" ]; then
  echo "$merged" | jq '{hooks, statusLine}'
  exit 0
fi

cp "$SETTINGS" "$SETTINGS.bak.ulanzi.$(date +%Y%m%d%H%M%S)"
printf '%s\n' "$merged" > "$SETTINGS.tmp" && jq empty "$SETTINGS.tmp" && mv "$SETTINGS.tmp" "$SETTINGS"
echo "installed ulanzi_lab hooks + statusLine into $SETTINGS"
echo "hub: ${ULANZI_HUB:-http://127.0.0.1:39300}  (test: curl -s \${ULANZI_HUB:-http://127.0.0.1:39300}/health)"
echo "new/restarted claude sessions pick this up; running sessions may need /hooks reload or restart."
