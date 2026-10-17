# Survey: custom interactive desks (2026-10)

These are the projects and docs reviewed before building ulanzi-lab. For each one, the note says **what we took from it**.

## Ulanzi platform

- **[UlanziDeckPlugin-SDK](https://github.com/UlanziTechnology/UlanziDeckPlugin-SDK)**: the official SDK (protocol V2.1.2). It covers `common-node` and `common-html`, the demos, a simulator on :39069, and [manifest.md](https://github.com/UlanziTechnology/UlanziDeckPlugin-SDK/blob/main/manifest.md).
  - A `CodePath` ending in `.js` runs under the bundled Node v20.12.2.
  - `setBaseDataIcon` accepts PNG, JPG and **SVG** base64, so we draw every key as SVG with no native canvas dependency.
- **Local install facts** (from reading `UlanziDeck.exe` strings and the configs):
  - Plugins connect to WebSocket `127.0.0.1:3906`. The arguments are `address port language appVersion`.
  - The device type is `D200X` with `LargeItem 3_2:[2,1]`.
  - `ustudio-cli/` is Ulanzi's own AI-agent hook bridge: one state per agent, posted to a device IP. We reused its event→state mapping idea and its privacy allowlist.
- [racerxdl/ulanzi-d200-linux](https://github.com/racerxdl/ulanzi-d200-linux): D200 protocol notes, including the 196×196 key images.
- [narlei/ulanzideck_claude](https://github.com/narlei/ulanzideck_claude): Claude 5h and weekly usage on Ulanzi, using green→red colours. **We took** the gauge colours. We avoided its credential-reading approach.
- [weemaba999/ha-hub-ulanzi](https://github.com/weemaba999/ha-hub-ulanzi): one shared hub feeding many keys. **We took** the hub inside the plugin process.
- [zza199910/Hardware-Monitor-Ulanzi-Deck-](https://github.com/zza199910/Hardware-Monitor-Ulanzi-Deck-), [prostonik94/ulanzi-n8n-workflow-monitor](https://github.com/prostonik94/ulanzi-n8n-workflow-monitor): traffic-light and blink-on-error patterns.
- [jcalado/companion-surface-d200](https://github.com/jcalado/companion-surface-d200), [brendanwelsh/ulanzi-d100h-homebrew](https://github.com/brendanwelsh/ulanzi-d100h-homebrew): alternative stacks.

## Claude Code on a macro pad

- [JulienCr/streamdeck-claude](https://github.com/JulienCr/streamdeck-claude): one key per session, driven by hooks, and a press focuses the terminal. **We took** session slots and focus on press.
- [tapparello/agent-vitals](https://github.com/tapparello/agent-vitals): usage gauges, plus Allow/Deny keys that type into the terminal. We chose focus over remote approve, which is the user's decision.
- agentsd / yolodeck: a PermissionRequest hook that holds open until a deck key answers. This would be a possible v2 opt-in.
- [Corrugator/StreamDeck-Claude](https://github.com/Corrugator/StreamDeck-Claude): probes the API for rate-limit headers. We use the statusLine `rate_limits` instead, which costs nothing.
- Desk lights driven by the same hooks: [Semaphore](https://awesome.ecosyste.ms/projects/github.com%2Fartemy%2Fsemaphore) and VibeSignal.
- Docs: [hooks](https://code.claude.com/docs/en/hooks) and [statusLine](https://code.claude.com/docs/en/statusline).
  - The statusLine's `rate_limits.five_hour/seven_day.{used_percentage,resets_at}` is only sent for Pro/Max/gateway accounts, and only after the first API response.
- [ccusage](https://github.com/ryoppippi/ccusage): estimates 5h blocks from `~/.claude/projects/**/*.jsonl`. It's a useful fallback, but not the real quota.

## Other themes

| Theme | Reference | Idea used |
|---|---|---|
| Stocks | [TickerTap](https://github.com/matextrem/streamdeck-tickertap), Simple Stock Ticker | Price, change and % on one key. We added the TW colour convention (red = up). |
| System health | [lhm-streamdeck](https://github.com/moeilijk/lhm-streamdeck), [streamdeck-ohs](https://github.com/atcurtis/streamdeck-ohs) | Value plus a rolling sparkline. |
| WSL / Docker | [streamdeck-docker](https://github.com/Darkdragon14/streamdeck-docker) | State on the key, and press to act. Destructive actions need a two-step confirm. |
| Home Assistant | [home-assistant-streamdeck-yaml](https://github.com/basnijholt/home-assistant-streamdeck-yaml-addon), [HA webhook](https://github.com/hendricksond/streamdeck-homeassistant-webhook) | A provider interface. HA/MQTT can be added behind `iot.js`. |
| AI keys | LLM Voice Chat AI, [prompt-voice](https://github.com/goodgithubname/prompt-voice) | Push-to-talk to an LLM. Not built yet; see the ideas below. |
| Window layout | Rectangle (macOS), PowerToys FancyZones | ½ → ⅓ → ⅔ cycling on repeat presses, quarters and thirds, next monitor, and multi-window presets. |

## Ideas not built yet (v2 candidates)

- An opt-in remote **Approve/Deny** through a blocking PermissionRequest hook, with a two-key confirm.
- A Home Assistant adapter (REST and WebSocket `state_changed`) and an MQTT adapter for ESP32 sensors.
- Push-to-talk: hold a key to record, transcribe with whisper.cpp, and send the result to a chosen Claude session's tmux pane.
- Generating a `.ulanziProfile` so the default layout installs in one step.
- Dial/encoder support (`Controllers: ["Encoder"]`) for D200H or Dial devices, for example scrolling through sessions.
