# Agent Note: pwsh 工具與 bash 對齊

Status: implemented

[English](2026-08-02-pwsh-tool-bash-parity.md) | [简体中文](2026-08-02-pwsh-tool-bash-parity.zh.md) | 繁體中文

## 問題

首個 Windows 原生基礎交付的 `dsh-tool-pwsh` 是刻意最小的畫像——僅前臺（每次呼叫都啟動新行程；無持久 PTY 工作階段）、受管環境只有三個硬編碼 `DSH_*` 鍵、以及一個未聲明就偏離 bash 工具的 marker 故事（「恆打 `[exit code: N]`」）。模型可見約定曾與實作脫節：描述承諾了渲染器從未執行的 spill 路徑報告，README 宣稱了不存在的匯出與工具未做的渲染，工具自己的測試還釘死了有損行為。最小畫像還讓 `DSH_*` contributor seam 因缺席而重複：向 `ctx.shellEnv` 貢獻環境事實的外掛程式對 pwsh 呼叫毫無作用。

## 決策

`dsh-tool-pwsh` 現在逐呼叫映像檔 `dsh-tool-bash`，其模型可見文字精確描述這一行為：

- **渲染行為與 bash 完全一致**：stdout、帶標記的 `[stderr]` 段、帶 spill 路徑的截斷通知、空體渲染 `(no output)`、退出 marker 僅限非零退出——乾淨退出不產生 marker。描述與 `tool:pwsh` 提示詞部分精確陳述這一點（「Non-zero exits are reported as `[exit code: N]` markers」），刻意不複製 bash 提示詞中與其自身渲染矛盾的「every result」措辭。
- **`run_in_background` 經通用任務執行時期接線**，與 bash 工具完全一致：預檢、owner 註冊、`job_output`/`job_kill` 控制與相同的結果對映。其背後是 `pwsh-local` 早已映像檔好的 `start()` 控制代碼。
- **`DSH_*` 環境共享而非複製**：`ShellEnvRegistry` 從 `dsh-tool-bash` 遷入新的工具無關包 `@deepseek-ai/dsh-shell-env`（`ctx.shellEnv` + 內建事實 + 工作階段持久化貢獻方），兩個 shell 工具都注入它。contributor 對 pwsh 呼叫與 bash 呼叫一視同仁；因此，共享環境的所有權不屬於任何一個面向模型的 shell 工具。
- **Windows 現實在 bash 無對應處釘死**：每條命令都在 UTF-8 輸出前置程式碼下執行，使 Windows PowerShell 5.1 兜底無法經 UTF-8 解碼的 collector 破壞非 ASCII 輸出；提示詞說明 Windows 強制終止以 exit 1 結帳，不產生 signal marker。
- **範圍外，不變**：持久 PTY shell（後端僅限 Linux/macOS；ConPTY 屬路線圖）。沙盒升級隨 [Windows ACL 沙盒決策](2026-08-08-windows-acl-restricted-token-sandbox.md) 稍後交付——pwsh 工具現在攜帶沙盒拒絕渲染與同輪次 `sandbox_permissions` 升級面，外加其描述中的 Windows ConstrainedLanguage 約定。帶退出 pill 的 pwsh 專屬 terminal 卡已隨 [pwsh UI 呈現與 bash 對齊](2026-08-05-pwsh-ui-bash-parity.md) 決策另行交付。

## 備選方案

**保留最小畫像，只修聲明。** 否決：從 bash 複製的文字約定在缺少對應實作時會漂移；最小工具加準確聲明仍讓 pwsh 呼叫沒有後臺執行、沒有 contributor 對等、並留下一個必須永遠重新辯護的偏離 marker 故事。

**在載入時拒絕不匹配的執行器方言。** 合併前嘗試過並撤回：在 `ShellExecutor` 上加 `ShellDialect` 標記（`bash` | `powershell`），兩個 shell 工具在掛載的執行器說另一種方言時拋錯。它迫使每個執行器實作——包括每個測試與示例的 fake——都要聲明 dialect，為一道倉內及合理部署中都沒有目標可攔的護欄（交付組合總是把 tool-pwsh 配 `dsh-pwsh-local`、tool-bash 配 `dsh-bash-local`）給每個 shell 工具測試添噪。配對約定改由各工具 README 記錄。

**提取完全共享的工具實作基座（抽象 shell 方言，兩個薄葉子）。** 考慮後推遲：shell-env 提取與結構映像檔（`render.ts`/`background.ts` 孿生）是它要立足的基礎；在出現第三種方言或持久 PTY 孿生、讓抽象的形態可觀察之前，不做完整基座。

## 後果

- bash 與 pwsh 工具在前臺、後臺與沙盒化 shell 工作上行為可互換（沙盒面隨 Windows ACL 沙盒決策到來），pwsh 的提示詞/描述句每句都有渲染器背書——reviewer 的「拿程式碼 grep 對證」檢查透過。
- 對齊也反向發生過一次：pwsh 工具的結構化前臺中止（`HarnessError('tool call aborted', TOOL_ABORTED)`，name 為 `AbortError`）被回移到 bash 工具，取代其無碼的 `Error('command aborted')`——這是模型可見/入日誌的變更，由兩側的精確形狀測試與 cancel-tool-calls fixture（測試前置資料）釘住。
- `@deepseek-ai/dsh-shell-env` 成為新的交付包；`dsh-tool-bash` 的 `dshHome` 設定遷往那裡，因此掛載 shell 工具的組合也必須掛載 `shell-env`（主幹組合包已如此）。
- Windows 專屬語義（CRLF 歸一化、強制終止 exit-1/signal-null、僅 POSIX 的自訊號）一如既往由測試釘住。
- pwsh 工具的逐文件覆蓋率閘門由可指令碼化的 fake 執行器套件（`tests/tools.spec.ts`）承擔；真實 pwsh 的整合與 Loader 組合套件在無 `pwsh` 的宿主自跳過，與 bash 套件的分工一致。
- 路線圖提案的 parity 階段已交付；terminal 卡呈現階段隨 [pwsh UI 呈現與 bash 對齊](2026-08-05-pwsh-ui-bash-parity.md) 決策交付（TUI 本身已移除），剩餘階段是 Windows 默認組合。
