#!/usr/bin/env bash
# Reject commit messages and PR text that credit a co-author or an AI tool or model.
# Reads a file (the commit-msg hook passes one) or stdin; lines starting with # are ignored, as git does.
#
#   bash scripts/check-commit-message.sh .git/COMMIT_EDITMSG
#   git log -1 --format=%B | bash scripts/check-commit-message.sh
#   git config core.hooksPath .githooks     # run it on every local commit
set -euo pipefail

pattern='co-authored-by|anthropic|claude|(^|[^[:alnum:]])(opus|sonnet|haiku|fable)([^[:alnum:]]|$)'
hits="$(grep -v '^#' "${1:-/dev/stdin}" | grep -n -i -E "$pattern" || true)"
[ -z "$hits" ] && exit 0
printf 'Message credits a co-author or an AI tool or model (not allowed here):\n%s\n' "$hits" >&2
exit 1
