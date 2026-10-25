#!/usr/bin/env bash
# Reject commit messages and PR text that credit a co-author or an AI tool or model.
# Reads a file (the commit-msg hook passes one) or stdin. Like git, it ignores lines starting with # and everything
# below the scissors line, where `git commit -v` puts the diff.
#
#   bash scripts/check-commit-message.sh .git/COMMIT_EDITMSG
#   git log -1 --format=%B | bash scripts/check-commit-message.sh
#   git config core.hooksPath .githooks     # run it on every local commit
set -euo pipefail

# The tool name is matched anywhere (paths and key names too); vendor and model names as whole words only.
pattern='co-authored-by|claude|(^|[^[:alnum:]])(anthropic|opus|sonnet|haiku|fable)([^[:alnum:]]|$)'
hits="$(awk '/^# -+ >8 -+$/ { exit } !/^#/' "${1:-/dev/stdin}" | grep -n -i -E "$pattern" || true)"
[ -z "$hits" ] && exit 0
printf 'Message credits a co-author or an AI tool or model (not allowed here):\n%s\n' "$hits" >&2
exit 1
