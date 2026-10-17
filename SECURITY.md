# Security policy

## Reporting a vulnerability

Please **don't open a public issue** for security problems. Report them privately instead, through GitHub: **Security → Report a vulnerability** (a private advisory) on this repository. Include the steps to reproduce, and say which part is affected (hub, hooks, plugin, setup scripts).

## Design notes

- **The hub is local-only.** It listens on `127.0.0.1:39300` and only accepts `application/json` POSTs, so a web page can't forge hook events.
- **Hooks send metadata only.** They forward allowlisted fields. Prompts, tool inputs and transcripts never leave Claude Code.
- **No secrets are stored.** `gh` / `glab` use their own logins inside WSL, and machine settings live in an untracked `.env`.
- **The Claude Pad only types into tmux panes** that were registered by a Claude Code session's hook.

If you find a way around any of these, that's a vulnerability, so please report it.
