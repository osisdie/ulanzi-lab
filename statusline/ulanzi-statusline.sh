#!/usr/bin/env bash
# ulanzi-statusline.sh — Claude Code statusLine that also feeds the ulanzi_lab hub.
#
# Prints:  Opus 5.5 · ctx 42% · 5h 63% ↻1h12m · 7d 31% · $1.23
# Posts:   rate_limits / context_window.used_percentage / cost / model / session_id → $ULANZI_HUB/usage
#
# If you already had a statusLine, set ULANZI_STATUSLINE_INNER to it and its output is printed instead.

HUB="${ULANZI_HUB:-http://127.0.0.1:39300}"
input="$(cat)"
command -v jq >/dev/null 2>&1 || { echo "ulanzi-statusline: jq missing"; exit 0; }

slim="$(printf '%s' "$input" | jq -c '{session_id, model, rate_limits, cost: {total_cost_usd: .cost.total_cost_usd}, context_window: {used_percentage: .context_window.used_percentage}}' 2>/dev/null)"
if [ -n "$slim" ] && command -v curl >/dev/null 2>&1; then
  ( curl -s -m 1 -o /dev/null -H 'content-type: application/json' --data-binary "$slim" "$HUB/usage" >/dev/null 2>&1 & ) >/dev/null 2>&1
fi

if [ -n "$ULANZI_STATUSLINE_INNER" ]; then
  printf '%s' "$input" | sh -c "$ULANZI_STATUSLINE_INNER"
  exit 0
fi

printf '%s' "$input" | jq -r '
  def dur: (. - now) | if . <= 0 then "now" elif . < 3600 then "\(. / 60 | floor)m"
           elif . < 172800 then "\(. / 3600 | floor)h\((. % 3600) / 60 | floor | tostring | if length < 2 then "0" + . else . end)m"
           else "\(. / 86400 | floor)d" end;
  def win($n; $w): if $w and $w.used_percentage != null
    then "\($n) \($w.used_percentage | round)%" + (if $w.resets_at then " ↻" + ($w.resets_at | dur) else "" end)
    else empty end;
  [ (.model.display_name // .model.id // "claude"),
    (if .context_window.used_percentage != null then "ctx \(.context_window.used_percentage | round)%" else empty end),
    win("5h"; .rate_limits.five_hour),
    win("7d"; .rate_limits.seven_day),
    (if .cost.total_cost_usd != null then "$\(.cost.total_cost_usd * 100 | round / 100)" else empty end)
  ] | join(" · ")' 2>/dev/null || echo "claude"
