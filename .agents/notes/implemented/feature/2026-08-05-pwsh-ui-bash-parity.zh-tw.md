# Agent Note: pwsh UI presentation matches bash

Status: implemented

[English](2026-08-05-pwsh-ui-bash-parity.md) | [简体中文](2026-08-05-pwsh-ui-bash-parity.zh.md) | 繁體中文

## Problem

[pwsh 工具與 bash 對齊決策](../../implemented/feature/2026-08-02-pwsh-tool-bash-parity.md) 讓 `dsh-tool-pwsh` 在執行、marker 與背景工作上行為可互換，但明確推遲了面向人類的一半：完成的 pwsh 前臺呼叫呈現為通用 `console` 圍欄卡片，而 bash 工具的完成呼叫呈現為帶解析退出狀態 pill 的 terminal 卡。負責解決此缺口的路線圖（[Windows 默認改用 pwsh](../../implemented/feature/2026-08-01-windows-pwsh-default.md)）把「pwsh TUI/GUI 渲染」列為階段 2，但 TUI 包已被移除，使 Web 表面成為該缺口唯一影響的 UI。

## Decision

`dsh-tool-pwsh` 的 `presentResult` 現在逐呼叫映像檔 `dsh-tool-bash`：完成的前臺結果是 `terminal` 卡，輸出正文為去 marker 的渲染文字，退出狀態 pill 為解析出的 `exitCode`/`signal`；後臺 ack 與 `isError` 結果保持通用 `console` 圍欄卡片；非單一文字塊結果保持不變（`undefined`）。

解析是共享而非複製：`parseExitStatus`/`ParsedExitStatus` 從 `dsh-tool-bash` 的私有 render 模組遷入 `@deepseek-ai/dsh-shell` Service Definition 包（由其 index 匯出），`dsh-tool-bash` 的 `render.ts` 再匯出它，使源平面消費端保持單一匯入根。兩個工具的渲染器寄出相同的 `[exit code: N]` / `[killed by signal: X]` marker，因此一個由 Service Definition 擁有的逆解析永遠不會在孿生之間漂移——與 [shell-env 抽取](../../implemented/feature/2026-08-02-pwsh-tool-bash-parity.md) 處理 `DSH_*` 登錄檔時相同的「共享而非複製」形態。

Web UI 的卡片本身不需要任何按工具編寫的程式碼：用戶端的 terminal 卡橋接（`dsh-client-ui-conversation` 的 `terminal-card-model`）對映任意 `card: 'terminal'` 結果檢視表，因此 pwsh presenter 變更直接流經 bash 已有的同一渲染路徑。摺疊的工具行有一處用戶端分類條目：`classifyTool('pwsh')` 現在歸入 shell 家族行（`bash` variant，自有 `Pwsh` 標題），而非通用的 `others`「Tool call」行。一條 keyless 瀏覽器通道（`apps/web/tests/pwsh-terminal.e2e.ts`）預置一個工作階段，其 pwsh 呼叫/結果在重播時由真實工具呈現（api-proxy 從已記錄的 args/result 內容重新計算檢視表），並釘住 terminal 卡 golden，包括退出 pill 與執行狀態點。

## Alternatives considered

**從 `@deepseek-ai/dsh-tool-bash/src/render.ts` 匯入 `parseExitStatus`。** 否決：workspace 匯入在建置產物中保持外部引用，因此 `tool-pwsh` 會在每個消費端閉包中新增對 `tool-bash` 的硬執行時期相依性（包括刻意只掛 pwsh 孿生、不掛 bash 的組合），且兄弟工具為一個函式而相依性其孿生會顛倒包間關係。seam 遷移把共享約定放在兩個工具本就相依性的包上。

**新建專用呈現包（如 `@deepseek-ai/dsh-shell-present`）。** 否決：為一個純函式新建包要付出 manifest（中繼資料清單）、module-graph/目錄再生成與 README 內容的成本；`@deepseek-ai/dsh-shell` 已在兩個工具的閉包中，且已擁有該解析重建的 `ShellRunResult` 事實。

**把解析複製進 `tool-pwsh` 的 render 模組（第三個孿生）。** 否決：複製的文字約定缺少共享實作就會漂移（[pwsh 工具與 bash 對齊](2026-08-02-pwsh-tool-bash-parity.md)）；解析與 marker 寄出必須在同一處共同演化，而解析恰恰是 UI pill 相依性的約定。

## Consequences

- 使用 `dsh-tool-pwsh` 的 Windows 組合現在在 Web UI 中顯示的 shell 呼叫與 bash 呼叫完全一致：cwd 頭的 terminal 卡、原始輸出、退出狀態 pill、執行狀態點，以及非零退出時的紅色失敗處理。
- `parseExitStatus` 成為 `@deepseek-ai/dsh-shell` 公開約定的一部分；`dsh-tool-bash/src/render.ts` 繼續再匯出它，bash 工具消費端零改動。
- 路線圖階段 2 收窄：TUI 已移除（EOL），對應的 terminal 卡現已在 Web 表面交付。Windows 默認組合（階段 1）仍是未完成的階段。
- 驗證：`dsh-shell` 在逐文件覆蓋率閘門下擁有解析邊界用例；`tool-pwsh` 的 presenter 套件映像檔 `tool-bash` 的（乾淨/非零/訊號/逾時往返、形似 marker 的輸出、後臺/錯誤通用卡片、多塊回退）；用戶端行模型套件釘住 `Pwsh` shell 家族行；web `pwsh-terminal` 通道是組裝後的 keyless 場景。
