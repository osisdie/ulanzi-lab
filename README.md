# ulanzi-lab

**繁體中文** · [English](README.en.md)

<p>
<a href="https://github.com/osisdie/ulanzi-lab/actions/workflows/ci.yml?query=branch%3Amain"><img src="https://github.com/osisdie/ulanzi-lab/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI"></a>
<a href="package.json"><img src="https://img.shields.io/github/package-json/v/osisdie/ulanzi-lab?label=version&color=informational" alt="Version"></a>
<a href="LICENSE"><img src="https://img.shields.io/github/license/osisdie/ulanzi-lab?color=blue" alt="License: MIT"></a>
<a href="https://github.com/osisdie/ulanzi-lab/commits/main"><img src="https://img.shields.io/github/last-commit/osisdie/ulanzi-lab/main" alt="Last commit"></a>
<a href="https://github.com/osisdie/ulanzi-lab/stargazers"><img src="https://img.shields.io/github/stars/osisdie/ulanzi-lab?style=flat&logo=github" alt="GitHub stars"></a>
<a href="https://github.com/osisdie/ulanzi-lab/issues"><img src="https://img.shields.io/github/issues/osisdie/ulanzi-lab" alt="Open issues"></a>
<a href="CONTRIBUTING.md"><img src="https://img.shields.io/badge/PRs-welcome-brightgreen" alt="PRs welcome"></a>
<a href="CODE_OF_CONDUCT.md"><img src="https://img.shields.io/badge/Contributor%20Covenant-2.1-4baaaa" alt="Contributor Covenant 2.1"></a>
<br>
<img src="https://img.shields.io/badge/Ulanzi-D200X-ff6a00" alt="Ulanzi D200X">
<img src="https://img.shields.io/badge/Windows%20%2B%20WSL-0078D4" alt="Windows + WSL">
<img src="https://img.shields.io/badge/macOS-000000?logo=apple&logoColor=white" alt="macOS">
<img src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Fosisdie%2Fulanzi-lab%2Fmain%2Fpackage.json&query=%24.engines.node&label=node&logo=nodedotjs&logoColor=white&color=5FA04E" alt="Node.js versions">
<img src="https://img.shields.io/badge/Python-3.14-3776AB?logo=python&logoColor=white" alt="Python 3.14 (voice service)">
<img src="https://img.shields.io/badge/PowerShell-5391FE" alt="PowerShell">
<img src="https://img.shields.io/badge/Bash-4EAA25?logo=gnubash&logoColor=white" alt="Bash">
<img src="https://img.shields.io/badge/FFmpeg-007808?logo=ffmpeg&logoColor=white" alt="FFmpeg">
</p>

給 **Ulanzi D200X**（5×3 LCD 按鍵＋一個寬鍵）用的 Claude Code 控制面板，支援 **Windows + WSL** 和 **macOS**。

- **不會漏掉在等你的 session。** 任何 Claude Code session 需要人來決定時（權限確認、提問、計畫核准），它的按鍵會閃爍，整頁掃過一道紅色波紋，每一頁都有的 HITL 鍵會顯示等待中的 session 數。按一下就直接跳到那個 session。
- **用量一眼看清。** 5 小時和 7 天的用量上限儀表、重置倒數，以及依消耗速度推估的預測。資料取自 Claude Code 的 statusLine，不多打 API、不讀憑證。
- **開發者儀表板。** Code review（GitHub *或* GitLab）、CI、股市行情、硬體監控、媒體／麥克風、番茄鐘、視窗排版，以及 Claude 指令面板。
- **語音轉文字，全在本機。** 獨立的 Voice profile：從麥克風錄音，用本機的台灣華語語音模型轉成有標點的逐字稿，並複製到剪貼簿。[看下方示範](#語音-profilewindows)。

<p align="center"><img src="docs/images/page-1-claude.png" alt="第 1 頁：sessions、HITL 吉祥物、用量儀表、fleet 列" width="760"></p>

<table>
<tr><td><img src="docs/images/page-9-pr-board.png" alt="PR / MR 看板" width="420"></td><td><img src="docs/images/page-5-media.png" alt="媒體與音訊" width="420"></td></tr>
<tr><td><img src="docs/images/page-3-markets.png" alt="股市" width="420"></td><td><img src="docs/images/page-7-hardware.png" alt="硬體" width="420"></td></tr>
<tr><td><img src="docs/images/page-6-focus.png" alt="專注計時" width="420"></td><td><img src="docs/images/page-8-devops.png" alt="DevOps" width="420"></td></tr>
<tr><td><img src="docs/images/page-10-claude-pad.png" alt="指令面板" width="420"></td><td><img src="docs/images/page-2-windows.png" alt="視窗排版" width="420"></td></tr>
<tr><td><img src="docs/images/theme-neon.png" alt="Neon 主題" width="420"></td><td><img src="docs/images/theme-glass.png" alt="Glass 主題" width="420"></td></tr>
</table>

<sub>截圖用 <code>node scripts/gallery.mjs</code> 以示範資料產生，使用的是插件真正的按鍵樣板。</sub>

全部功能由一個 Ulanzi Studio 插件（Node，Studio 內建）加上幾個小小的 Claude Code hook 驅動（Windows 上跑在 WSL 裡，macOS 上跑在你的 shell）。瀏覽器預覽頁 `http://127.0.0.1:39300/` 會同步顯示每一頁。

```
WSL or macOS: claude sessions ── hooks/ulanzi-hook.sh ───────────┐  POST http://127.0.0.1:39300  (/hook, /usage)
WSL or macOS: statusLine ─────── statusline/ulanzi-statusline.sh ─┘
                                                                  ▼
Ulanzi Studio ─spawns→ plugin app.js ─(Studio's Node unpatched → child on a patched system Node)→ src/main.js = hub + deck driver
   ▲ ws 127.0.0.1:3906   ├─ sessions.js     state machine, HITL queue, liveness
   └─ key images/presses ├─ providers/      quotes · sys · wsl / local · media · hw · devops (gh/glab) · iot
                         ├─ render*.js      SVG key templates (themes, charts, mascot)
                         ├─ win32.js        user32 via koffi → window layout / focus
                         ├─ ps/winhelper.ps1 media session, Core Audio, perf counters
                         ├─ mac/            macOS: JXA bridge (System Events) for layout, focus, media
                         └─ hub.js          HTTP + SSE + browser preview
```

## 快速開始（Windows 11 + WSL2）

**需要的環境**

- Node.js 22.23.4+ 或 24.22.1+（含 2026 年 10 月資安修正的 LTS）。
- Ulanzi Studio。接上 D200X 並開過一次 Studio，讓它建立「Default Profile」。
- WSL2，裝好 `jq` 和 `curl`。
- 選用：
  - `tmux`：Claude Pad 和精準切換 session 需要。
  - `gh` 或 `glab`（已登入）：code review 需要。
  - Docker Desktop、n8n 或 LibreHardwareMonitor：對應的按鍵需要。

**安裝**

下載 repo：

```bash
git clone https://github.com/osisdie/ulanzi-lab.git
```

進入資料夾：

```bash
cd ulanzi-lab
```

建立本機設定：

```bash
copy .env.example .env
```

執行安裝：

```bash
powershell -ExecutionPolicy Bypass -File scripts\setup.ps1
```

`setup.ps1` 可以重複執行，結果相同。它會：

1. 檢查需要的環境，包括 WSL 的 mirrored 網路模式。
2. 執行 `npm install`。
3. 把插件連結進 Ulanzi Studio（指向這個 repo 的 junction）。
4. 把 hook 和 statusLine 裝進 WSL 的 `~/.claude/settings.json`；會先備份，並保留你原本的 hook。
5. 依你的 D200X profile 產生 **ulanzi-lab** profile，並用它啟動 Studio。

選項：

| 選項 | 作用 |
|---|---|
| `-EnvProfile <name>` | 先把 `.env.<name>` 複製成 `.env`。有多台機器的設定時好用。 |
| `-FixWslConfig` | 在 `%USERPROFILE%\.wslconfig` 加上 `networkingMode=mirrored`，再請你執行 `wsl --shutdown`。WSL 裡的 hook 要靠它才連得到 `127.0.0.1`。 |
| `-Distro <name>` | 改用這個 WSL distro，不用預設的。 |
| `-SkipHooks` | 不動 WSL 的 Claude Code 設定。 |

拉下更新後，再執行一次 `scripts\setup.ps1`。你的 `.env` 會保留，所以按鍵頁和 forge 設定都還是你的。

## 快速開始（macOS）

**需要的環境**

- macOS 12 以上，Node.js 22.23.4+ 或 24.22.1+（含 2026 年 10 月資安修正的 LTS）。
- Mac 版 Ulanzi Studio。接上 D200X 並開過一次 Studio，讓它建立「Default Profile」。
- `jq` 和 `curl`（`brew install jq`）。
- 選用：
  - `tmux`：Claude Pad 和精準切換 session 需要。
  - `gh` 或 `glab`（已登入）：code review 需要。
  - `switchaudio-osx`：切換音訊輸出的按鍵需要。
  - Docker Desktop 或 n8n：對應的按鍵需要。

**安裝**

```bash
git clone https://github.com/osisdie/ulanzi-lab.git
cd ulanzi-lab
cp .env.example .env
bash scripts/setup-mac.sh
```

這個腳本會：

1. 檢查需要的環境。
2. 執行 `npm install`。
3. 把插件 symlink 到 `~/Library/Application Support/Ulanzi/UlanziDeck/Plugins`。
4. 把 hook 和 statusLine 裝進 `~/.claude/settings.json`；會先備份，並保留你原本的 hook。
5. 依你的 D200X profile 產生 **ulanzi-lab** profile，並用它啟動 Studio。

`--env-profile <name>` 和 `--skip-hooks` 的作用和 `setup.ps1` 的對應選項相同。

**權限。** 按鍵第一次需要權限時，macOS 會詢問。請允許 Ulanzi Studio：

- **輔助使用（Accessibility）**：視窗排版鍵。
- **自動化（Automation）**：System Events、iTerm2／Terminal（跳到 session 所在的分頁）、Spotify／Music（媒體鍵）。

**macOS 上的差異**

| 項目 | macOS |
|---|---|
| Sessions、HITL、用量、Claude Pad、code review | 相同。Hook、`tmux`、`gh` 和 `glab` 在你自己的 shell 執行，不是 WSL。 |
| 切換到 session | tmux pane → iTerm2／Terminal 分頁（以 tty 比對）→ VS Code 資料夾 → session 所在的終端機 App。 |
| 視窗排版 | 透過 System Events。**還原**會把視窗放回第一次排版前的位置。全螢幕視窗無法移動。 |
| 媒體 | 只支援 Spotify 和 Music，因為 macOS 沒有公開的「正在播放」API。專輯封面來自 Spotify。 |
| 音訊 | 音量、靜音、麥克風（輸入音量設為 0）。切換輸出裝置需要 `SwitchAudioSource`。 |
| 硬體 | CPU、各核心、RAM、GPU %、使用中的 GPU 記憶體、網路、磁碟 I/O、根磁碟區。沒有溫度，也沒有磁碟忙碌 %。 |
| WSL 鍵 | 換成 Docker（第 1 頁）、System Health（Hardware 頁）和 RAM（DevOps 頁）。 |

## 設定（`.env`）

所有和組織或機器有關的值都放在 repo 根目錄的 `.env`。Git 會忽略它，以及除了 `.env.example` 以外的所有 `.env.*`。
完整清單和說明見 [.env.example](.env.example)。改完後執行 `node scripts/make-profile.mjs --activate`，它會重建按鍵頁並重啟 Studio。

| Key | 預設值 | 用途 |
|---|---|---|
| `ULANZI_LAB_FORGE` | `auto` | `gitlab`、`github` 或 `auto`（哪個 CLI 已登入就用哪個；GitLab 優先） |
| `ULANZI_LAB_GITLAB_HOST` | （已登入的 host） | `glab` 用的自架 GitLab host |
| `ULANZI_LAB_GITHUB_HOST` | `github.com` | `gh` 用的 GitHub 或 GitHub Enterprise host |
| `ULANZI_LAB_BOARD_SCOPE` | `involves:@me` | PR 看板的 GitHub 搜尋條件（`org:x`、`repo:o/r`…） |
| `ULANZI_LAB_ACTIONS_REPO` | （你的 PR 所在的 repo） | GitHub Actions 鍵用的 `owner/name` |
| `ULANZI_LAB_HTTP_CHECKS` | Claude API | 最多兩個 `url\|label` 健康檢查 |
| `ULANZI_LAB_WATCHLIST` | （無） | 最多 12 個 `SYMBOL:label`。會多一頁 Watchlist。 |
| `ULANZI_LAB_WATCHLIST_STRIP` | （無） | Watchlist 寬鍵的最多 3 個項目（迷你 K 線） |
| `ULANZI_LAB_DISTRO` | 預設 distro | 插件要連的 WSL distro |
| `ULANZI_LAB_SOUNDS` | — | 你自己的音效 JSON，可以是絕對路徑，或相對於 `.env` 所在資料夾（repo 根目錄）；JSON 裡的音效路徑相對於該 JSON 檔。只覆蓋它有設的 key（`focusDone`、`breakDone`、`waiting`；`"off"` 表示靜音）。預設值：[`config/sounds.windows.json`](plugin/com.ulanzi.nwpie.ulanziPlugin/config/sounds.windows.json)、[`config/sounds.mac.json`](plugin/com.ulanzi.nwpie.ulanziPlugin/config/sounds.mac.json)。Windows 只能播 `.wav`。 |
| `ULANZI_LAB_NODE` | 自動尋找 | Studio 內建的 Node 缺資安修正時，用來執行插件的 Node；`bundled` 表示維持 Studio 的 |
| `ULANZI_LAB_N8N_URL` | `http://127.0.0.1:5678` | n8n 鍵 |
| `ULANZI_LAB_PORT` / `ULANZI_LAB_GAP` | `39300` / `0` | Hub 的 port／排版時視窗之間的間距 |

在 WSL 裡，hook 和 statusLine 腳本讀取 `ULANZI_HUB`，預設是 `http://127.0.0.1:39300`。

## 按鍵頁

換頁鍵（`0_3`／`1_3`）用來翻頁。每一頁都保留 **HITL** 鍵。

| # | 頁面 | 按鍵 |
|---|---|---|
| 1 | **Claude** | Session S1–S4、HITL。5h／7d 用量、系統、WSL、AIoT。最下排：番茄鐘＋次數、CI/CD。寬鍵：fleet 列（sessions、用量條、消耗速度） |
| 2 | **Windows** | 排版目前的前景視窗：左右半邊、四分之一、三分之一、置中、最大化。預設組合：二分割、四宮格。寬鍵：HITL 橫幅 |
| 3 | **Markets** | 加權指數、道瓊、S&P 500、那斯達克、費半、日經、美元／台幣、美元指數、美元／日圓、黃金、WTI、BTC。寬鍵：布蘭特原油／白銀／銅的 K 線 |
| (4) | **Watchlist** | 只在設定 `ULANZI_LAB_WATCHLIST` 時出現：你的 12 個標的，加上 3 列 K 線 |
| 4 | **Media** | 專輯封面、上一首／播放／下一首、音量環、音量 −/+、**麥克風靜音**、輸出裝置、Spotify、YouTube Music。寬鍵：正在播放 |
| 5 | **Focus** | 番茄鐘（25/50/15）、重設、+5、休息、今日和本週次數、勿擾、Clawd。寬鍵：大計時器 |
| 6 | **Hardware** | CPU、各核心熱圖、RAM、GPU、VRAM、磁碟、WSL、網路 ↓↑、磁碟 I/O、開機時間、溫度（LibreHardwareMonitor）。寬鍵：儀表板 |
| 7 | **DevOps** | 我的 PR／MR、待我 review、Claude 狀態、Docker、n8n、HTTP 檢查、CI（GitHub Actions 或 MR CI）、用量、GitHub 狀態。寬鍵：PR／MR 清單 |
| 8 | **PR / MR Board** | 開啟中總數、CI 失敗、衝突、閒置 ≥ 7 天，以及最需要處理的 8 個 repo。寬鍵：問題清單 |
| 9 | **Claude Pad** | 核准（1）／一律允許（2）／Esc／Enter，加上 `continue`、`/compact`、跑測試、commit、review diff、`/clear`（長按）、解釋錯誤、先做計畫。寬鍵：目標 session |

### 語音 profile（Windows）

獨立的 profile **ulanzi-lab Voice**：從麥克風錄音並產生逐字稿，全部在這台電腦上完成。

<p align="center"><img src="docs/images/voice-demo.gif" alt="Voice profile：按錄音、說話、完成；逐字稿顯示在寬鍵上，同時存檔並複製" width="760"></p>

有聲音的版本（28 秒；repo 裡也有一份 [docs/media/voice-demo.mp4](docs/media/voice-demo.mp4)）：

https://github.com/user-attachments/assets/2a94d064-bd9a-4bb0-9ced-cc5b6e4d7620

<sub>按鍵狀態照腳本切換，但每個按鍵都由插件的樣板繪製，音量條跟著音檔真實的音量，逐字稿是本機語音轉文字服務對這段音檔的實際輸出，再由插件補上標點。聲音是合成的：<a href="https://github.com/mtkresearch/BreezyVoice">BreezyVoice</a>（Apache-2.0）搭配其 repo 附的範例講者。重新產生：<code>node scripts/voice-demo.mjs --audio &lt;file&gt;</code>。</sub>

<p align="center"><img src="docs/images/voice-states.png" alt="Voice 頁：待機、錄音中、轉寫中、完成" width="840"></p>

| 列 | 按鍵 |
|---|---|
| 1 | **● 錄音**（再按一次：暫停／繼續）、**完成**（只保留錄音）、**完成＋逐字稿**、**取消**（按兩次）、HITL |
| 2 | **最後的逐字稿**（長按：在資料夾中顯示）、**複製**逐字稿、麥克風靜音、**重新轉寫**、語音轉文字服務狀態 |
| 3 | **語言**（華語／English／台語／自動）、錄音資料夾、時鐘。寬鍵：錄音中顯示計時和音量條，完成後顯示逐字稿的前幾行 |

設定步驟：

1. `winget install Gyan.FFmpeg`（Studio 不用重啟就找得到）。
2. 在 WSL 執行 `services/voice-asr/install.sh`（加 `--taigi` 會一併安裝台語模型）。它會建立 venv，並把官方的 [Breeze-ASR-25](https://huggingface.co/MediaTek-Research/Breeze-ASR-25) 權重轉成 int8，放在 `~/.local/share/ulanzi-lab/voice-asr`（約 2 GB）。
3. `npm run profile:voice` 建立 profile，再到 Ulanzi Studio 切換過去。

每段錄音存在 `~/ulanzi-lab/voice`（`C:\Users\<you>\ulanzi-lab\voice`；可用 `ULANZI_LAB_VOICE_DIR` 更改），檔名是 `recordings/<time>.wav`，加上 `transcripts/<time>.txt`（有標點）和 `.srt`。（最早的版本用的是 `Documents\ulanzi-lab\voice`，裡面的檔案請搬到新資料夾。）文字也會複製到剪貼簿。在筆電 CPU 上，轉寫時間大約等於錄音長度。服務在第一次按鍵時啟動（約 10 秒），閒置 15 分鐘或 Studio 結束時自動關閉。

**Code review 在 GitHub 和 GitLab 上用法相同：**
- `glab`／`gh` 在 WSL 裡執行（macOS 上是你的 shell），所以用的是 CLI 自己的登入。
- 還沒登入時，按下 review 鍵會開一個 Windows Terminal 分頁（macOS 是 Terminal 視窗）執行 `glab auth login`／`gh auth login`。
- 長按任何 DevOps 鍵會重新整理。

## Actions

| Action | 顯示 | 按下 | 長按 |
|---|---|---|---|
| Claude Session | S1–S8 欄位：專案、狀態、時間、context 條。**等待中會閃爍**（紅＝權限、紫＝提問、橘＝計畫） | 切到該 session | 移除 |
| Claude HITL | 等待數（Clawd 吉祥物或大數字） | 切到等最久的 session；再按一次換下一個 | 全部確認 |
| Claude Usage | 5h／7d 圓環，或寬的 fleet 列 | — | — |
| Stock Quote | 台股（`2330`、`t00`、`otc:6488`）或 Yahoo 代號（`NVDA`、`^DJI`、`GC=F`、`TWD=X`、`BTC-USD`），附當日走勢圖。用逗號列出多個會變成 K 線列。預設紅漲綠跌。 | 開啟報價頁（台股開 Yahoo奇摩股市，其他開 Yahoo Finance；K 線列開第一個代號） | 重新整理 |
| Media & Audio | 正在播放、音量、麥克風、輸出裝置 | 播放／暫停、音量、靜音、切換 | — |
| Focus Timer | 番茄鐘的各部分 | 開始／暫停、重設、+5… | 重設 |
| Hardware | 每個按鍵一個指標 | 工作管理員／檔案總管 | — |
| DevOps | PR／MR、review 看板、Actions、狀態、HTTP、Docker、n8n | 在瀏覽器開啟（或登入） | 重新整理 |
| Claude Prompt / Target | 要輸入到目標 session tmux pane 的文字或按鍵 | 送出 | `/clear` 需要長按 |
| System / WSL / AIoT / Window Layout | 如名稱所示 | 工作管理員／新的 WSL 分頁／切換／排版 | WSL：準備 `wsl --shutdown` |
| Voice | 錄音／暫停、完成、取消、最後的逐字稿、複製、語言、語音轉文字狀態（Windows） | 如按鍵標示 | 最後的逐字稿：在資料夾中顯示 |

**視覺效果：**
- Session 開始等待時，整個面板掃過一道警示波紋。
- 主題：classic、neon 或 glass，在任一 HITL 鍵上選擇。
- 報價鍵上的當日面積圖和 K 線。
- Clawd 的表情：待機、工作中、等待、完成、慶祝、愛心。

## HITL 細節

- **進入等待**的觸發條件：
  - `PermissionRequest`，或 `permission_prompt` 通知。
  - 提問通知。
  - `AskUserQuestion` 或 `ExitPlanMode`。
- **解除等待**的條件：
  - 對應的 `PostToolUse`（以 `tool_use_id` 比對）。
  - `UserPromptSubmit`。
  - `Stop`。
- **音效。** 原有的 `permission_prompt` 音效 hook 會保留，我們的 hook 加入同一個 matcher 群組。可選的提醒會每 60 秒響一次，直到你確認為止。
- **切換到 session** 依序嘗試：
  1. tmux pane。
  2. 開著該資料夾的 VS Code 視窗。
  3. 標題相符的 Windows Terminal 分頁。
  4. 任一個 Windows Terminal 視窗。

  macOS：tmux pane，接著是 session tty 所在的 iTerm2／Terminal 分頁，然後是 VS Code 資料夾，最後是終端機 App。
- **存活偵測。** claude 程序已結束的 session 會在 30 秒內移除。

## 隱私與安全

- **Hook 只送中繼資料。** 只轉送白名單內的欄位（session id、事件、通知類型、cwd、工具名稱、切換提示）。Prompt、工具輸入和對話紀錄都不會離開 Claude Code，hub 收到後也會再過濾一次。
- **Hook 不會拖慢 Claude。** 不輸出任何東西、一律 exit 0、POST 逾時 1 秒。高頻率的工具 hook 以 `async` 執行。
- **Hub 只在本機。** 只綁 `127.0.0.1`，而且只接受 `application/json` 的 POST，可以擋掉跨站偽造請求。
- **不讀任何憑證。** 用量來自 statusLine。`gh`／`glab` 在 WSL 裡用它們自己的登入。
- **Claude Pad 只輸入到 tmux pane。** 不在 tmux 裡的 session 會被拒絕。
- **語音留在這台電腦。** 語音轉文字在本機執行，只聽 `127.0.0.1`。錄音和逐字稿存在 `~/ulanzi-lab/voice`（`C:\Users\<you>\ulanzi-lab\voice`），不在 Documents 底下，所以 OneDrive 不會同步。Log 只記長度和耗時，從不記你說了什麼。

## 開發

```bash
npm test
```
執行 `node:test` 測試：狀態機、解析器、按鍵頁版面、每個 SVG 樣板。

```bash
npm run smoke
bash test/ci/shell-checks.sh
```
用這個 OS 的後端啟動整個 runtime，並檢查 hook、statusLine 和 hook 安裝程式。
CI 在 Windows、macOS 和 Linux 上跑測試和 smoke test，另外有一個 Windows + WSL 的 job（`test/ci/wsl-bridge.mjs`）：Windows Node 上的插件要找到 WSL 裡的 session。

```bash
npm run dev
```
單獨執行 hub、providers 和預覽頁。如果插件也在跑，設定 `ULANZI_LAB_PORT=39301`。

```bash
npm run fake -- --n 4 --usage
```
模擬 Claude session。

```bash
node scripts/demo-states.mjs
```
在第 1 頁顯示每一種 session 外觀。

```bash
npm run link        # Windows
npm run link:mac    # macOS
```
重新連結插件並重啟 Ulanzi Studio。

```bash
node scripts/gallery.mjs
```
用示範資料重新產生 `docs/images/` 裡的 README 截圖。需要 Chrome 或 Edge。

- Log：`%LOCALAPPDATA%\ulanzi-lab\plugin.log`（macOS：`~/Library/Application Support/ulanzi-lab/plugin.log`）。狀態檔：同一個資料夾的 `state.json` 和 `pomodoro.json`。
- Node 除錯：以 `--nodeRemoteDebug` 啟動 Studio，再 attach 到 `127.0.0.1:9231`。
- 按鍵頁定義在 [src/pages.js](plugin/com.ulanzi.nwpie.ulanziPlugin/src/pages.js)，profile 產生器和預覽頁共用它。

## 注意事項與限制

- **報價。** TWSE MIS 連得上時用它，否則用 Yahoo 的 chart API（非官方）。沒有處理休市日。
- **Windows Terminal。** 無法用 id 切到指定分頁，所以分頁切換是盡量比對標題。tmux 和 VS Code 的切換是精準的。
- **以系統管理員執行的視窗。** 插件沒有提權，所以移動不了它們。
- **Port。** Hub 用 39300，因為有些機器保留了 45000–48000 這個範圍。
- **Ulanzi Studio 裡的 Node。** Windows 版 Studio 3.4 用它內建的 Node 20.12.2 執行插件（Mac 版可看 log 裡的 `plugin start` 那一行），這個版本已經結束支援，不再有資安修正。所以 `app.js` 會先檢查自己的 Node。如果缺資安修正，而系統上裝了已修補的 Node（PATH、常見安裝資料夾或 `ULANZI_LAB_NODE`），它就只負責監督：插件在那個 Node 上的子程序執行，Studio 停掉父程序時一起停止。沒有已修補的 Node，或子程序一直崩潰時，插件就在 Studio 的 Node 上執行並記錄警告。請保持系統 Node 在最新版。Hub 只聽 `127.0.0.1`，也只接受 JSON POST。你自己的 Node（工具、`npm run dev`、CI）一定要有這些修正：各版本線的最低版本在 [src/node-floor.js](plugin/com.ulanzi.nwpie.ulanziPlugin/src/node-floor.js)，安裝腳本和 CI 都會檢查。

> **小技巧：讓 Ulanzi Studio 使用系統的 Node（Windows）。** Studio 用它內建的
> `C:\Program Files (x86)\Ulanzi Studio\nodejs\node.exe` 啟動插件。如果用符號連結把這個檔案指向系統的 Node，
> 你安裝的每一次 Node 資安更新都會套用到所有 Studio 插件，不用等 Ulanzi 發新版。在系統管理員 PowerShell 執行：
>
> ```powershell
> $dir    = 'C:\Program Files (x86)\Ulanzi Studio\nodejs'
> $target = & (Get-Command node -CommandType Application -ErrorAction Stop).Source -p process.execPath
> if ($target -and (Test-Path $target)) {
>   # Studio and its plugins run this node.exe, so it can't be renamed while they run: stop them first.
>   Get-Process UlanziDeck -ErrorAction SilentlyContinue | Stop-Process -Force
>   Get-Process node -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "$dir*" } | Stop-Process -Force
>   Start-Sleep 2
>   Rename-Item "$dir\node.exe" node.bundled.exe -ErrorAction Stop   # keep Studio's copy for undo
>   try { New-Item -ItemType SymbolicLink -Path "$dir\node.exe" -Target $target -ErrorAction Stop | Out-Null }
>   catch { Rename-Item "$dir\node.bundled.exe" node.exe; throw }   # link failed: put Studio's copy back
>   & "$dir\node.exe" --version                                     # should print your Node's version
> }
> ```
>
> 第二行會找出版本管理工具 shim 背後真正的 `node.exe`。如果 `$target` 在每個 shell 各自的資料夾或暫存資料夾（例如 fnm 的 `fnm_multishells`），請改指向穩定的安裝位置，例如 `C:\Program Files\nodejs\node.exe`。目標不存在時，什麼都不會停止或改名。
> 之後照平常的方式（開始功能表）啟動 Studio，不要從這個視窗啟動：從這裡啟動的程式都以系統管理員執行，所有插件也會。完成後，插件 log 裡 `plugin start` 那一行會顯示你的 Node 版本，插件也不需要再自己切換 Node。
> - **復原：** 關掉 Studio，刪除連結，再把 `node.bundled.exe` 改回 `node.exe`。
> - **更新 Studio 之前，先復原連結**，更新完再重新套用。安裝程式以系統管理員執行，否則可能透過連結把它的舊 Node 寫到你的系統 Node 上。如果已經在連結存在時更新了，檢查 `node -v`，版本變了就重裝 Node。如果 `nodejs\node.exe` 仍是連結，它已經又指向修補過的 Node，不用再做什麼。如果更新把連結換成一般檔案，刪掉過期的 `node.bundled.exe` 再重新套用。
> - **其他插件**也會改用你的 Node。如果有插件在較新的主版本上壞掉，就復原。
> - **macOS：** 內建的 Node 在有簽章的 App bundle 裡，改動它可能讓 Studio 無法啟動。請改用上面說的自動切換。

## 解除安裝

在 repo 裡、WSL 中（macOS 則在終端機）執行：

```bash
bash scripts/install-hooks.sh --uninstall
```

接著移除插件連結。Windows：

```bash
powershell -ExecutionPolicy Bypass -File scripts\link-plugin.ps1 -Unlink
```

macOS：

```bash
bash scripts/link-plugin.sh --unlink
```

## 第三方程式碼

- **Ulanzi SDK。** `plugin/.../libs/ulanzi-api` 和 `libs/ulanzi-html` 來自 [UlanziDeckPlugin-SDK](https://github.com/UlanziTechnology/UlanziDeckPlugin-SDK)（Apache-2.0）。

設計背後的研究見 [docs/survey.md](docs/survey.md)。想參與開發或回報問題，請見 [CONTRIBUTING.md](CONTRIBUTING.md) 和 [SECURITY.md](SECURITY.md)。

## 授權

[MIT](LICENSE)。第三方程式碼保留各自的授權（見 [NOTICE](NOTICE)）。
