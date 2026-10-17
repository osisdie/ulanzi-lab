#!/usr/bin/env bash
# ulanzi-hook.sh — forward allowlisted Claude Code hook metadata to the ulanzi_lab hub.
#
# Never blocks or changes Claude: prints nothing, always exits 0, posts in the background
# with a 1 s timeout. Prompts, tool inputs and transcripts are NOT forwarded.
#
# Env: ULANZI_HUB (default http://127.0.0.1:39300)

HUB="${ULANZI_HUB:-http://127.0.0.1:39300}"
command -v jq >/dev/null 2>&1 || exit 0
command -v curl >/dev/null 2>&1 || exit 0

input="$(cat)"

# Find the claude process (first ancestor that isn't a shell) for liveness checks. Pure bash, no forks.
claude_pid=""
if [ -r /proc/$$/status ]; then
  p=$PPID
  for _ in 1 2 3 4 5 6; do
    [ -r "/proc/$p/comm" ] || break
    read -r comm < "/proc/$p/comm"
    case "$comm" in
      sh|bash|dash|zsh|env|timeout) ;;
      *) claude_pid=$p; break ;;
    esac
    ppid=""
    while read -r k v; do [ "$k" = "PPid:" ] && { ppid=$v; break; }; done < "/proc/$p/status"
    [ -n "$ppid" ] && [ "$ppid" != 0 ] || break
    p=$ppid
  done
fi

src=win
[ -n "$WSL_DISTRO_NAME" ] && src=wsl

payload="$(printf '%s' "$input" | jq -c \
  --arg src "$src" --arg distro "${WSL_DISTRO_NAME:-}" \
  --arg tmux_pane "${TMUX_PANE:-}" --arg tmux "${TMUX:-}" \
  --arg term "${TERM_PROGRAM:-}" --arg wt "${WT_SESSION:-}" \
  --arg pid "$claude_pid" --arg host "$(hostname 2>/dev/null)" \
  --argjson ts "$(date +%s%3N 2>/dev/null || echo 0)" '
  {
    session_id, hook_event_name, notification_type, cwd, tool_name, tool_use_id,
    permission_mode, source, reason, agent_type, session_title,
    model: (if (.model|type) == "object" then (.model.display_name // .model.id) else .model end),
    ts: $ts,
    focus: { src: $src, distro: $distro, tmux_pane: $tmux_pane, tmux: $tmux, term: $term, wt_session: $wt, pid: $pid, host: $host }
  } | with_entries(select(.value != null and .value != ""))' 2>/dev/null)" || exit 0

[ -n "$payload" ] || exit 0
( curl -s -m 1 -o /dev/null -H 'content-type: application/json' --data-binary "$payload" "$HUB/hook" >/dev/null 2>&1 & ) >/dev/null 2>&1
exit 0
