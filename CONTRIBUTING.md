# Contributing

Thanks for helping! This is a small hobby project: issues and pull requests are welcome.

## Ground rules

- **No organisation-specific data in code.** Company names, private repos, internal hostnames and URLs, tokens: these all belong in a local `.env`, which git ignores. Add new settings to `.env.example` with a comment, and read them through `src/env.js`.
- **Keep hooks harmless.** Hook scripts must never block, print output, or change Claude Code's behaviour. They always exit 0, and they forward allowlisted metadata only.
- **No new runtime dependencies** unless they're needed. The plugin runs on Ulanzi Studio's bundled Node (20.12.2 in Studio 3.4), so plugin code must keep working there; CI tests it.
- **Match the surrounding style.** ES modules, small pure functions that are easy to unit-test, and SVG Tiny–compatible markup (Qt renders it, so no filters or CSS).

## Workflow

1. Fork and branch from `main`.
2. Run `npm install`, then `npm test`. Add tests for new parsers, state changes or key templates.
3. Try your change in the browser preview: run `npm run dev`, then open http://127.0.0.1:39300/. If you have a D200X, also run `npm run link` and check it on the device.
4. Open a pull request. Say what changed, and attach a screenshot for anything visual.

## Commit messages

Use the imperative mood ("Add …", "Fix …"), and keep them about *this project*. Don't mention employers, customers or private projects.

No co-author trailers, and no AI tool or model credits, in commit messages or PR titles and descriptions. CI checks every pull request with `scripts/check-commit-message.sh`; to check each commit as you make it, run `git config core.hooksPath .githooks` once. (That setting replaces `.git/hooks`, so hooks you keep there stop running.) The check is strict: model names count even when they mean something else, such as the audio codec, and the CLI's name counts inside paths and key names too. Describe those instead, for example "the CLI settings folder" or "the session key".
