# 測試策略

[English](testing.md) | [简体中文](testing.zh.md) | 繁體中文

本文說明本倉庫的分層測試方式，以及保持綠色測試套件有意義的規則。命令見根目錄 [AGENTS.md](../AGENTS.md)；相關 Agent Note 承載設計動機。

## 層級

- **單元測試**（`pnpm run test`）：vitest 執行包和示例各自的 `tests/**` 目錄下的測試，以及匹配 `scripts/**/*.spec.ts` 的倉庫指令碼測試；測試文件與其所覆蓋的程式碼區域放在一起。每個登錄檔都有一個 HMR（熱模組替換）安全測試（對向該登錄檔貢獻內容的 fiber 執行 dispose（資源釋放），並斷言清理完成）。優先覆蓋邊界情況、錯誤路徑、事件順序、並行競態，以及針對約定回歸的永久測試（見 `packages/core/agent-loop/tests/contract-regressions.spec.ts`）。
- **覆蓋率閘門**（`pnpm run test:coverage`）：閘門級執行，對 `packages/*/*/src` 按文件 100% 覆蓋。未覆蓋的行往往是閘門正確標記出的死程式碼（應刪除），而非需要補寫的測試。行覆蓋率是必要條件，但永遠不是充分條件：它證明行被執行過，不證明功能按交付預期工作。`packages/shell/pwsh-local/src` 的按文件 100% 覆蓋需要真實的 `pwsh`：缺少它時其執行器套件會自動跳過，`vitest.config.ts` 會豁免該文件以使無 pwsh 的主機保持綠色，而 CI runner 自帶 pwsh，仍按完整標準執行閘門。
- **真實 API e2e**（`pnpm run test:e2e`）：帶金鑰測試呼叫真實提供方 API，包括 DeepSeek 模型以及各提供方特有的冒煙測試；這些測試各自由自己的金鑰控制（`EXA_API_KEY`、`PERPLEXITY_API_KEY` 等），缺少金鑰時套件會自動跳過，使 keyless CI 保持綠色（[真實 API e2e Agent Note](../.agents/notes/implemented/testing/2026-06-19-real-api-e2e-ci.md)）。
- **快照**（`pnpm run test:snapshot`）：無金鑰預期輸出覆蓋對外行為（傳輸約定與呈現），持久化日誌則固定組裝後的後端行為。ACP 啟動真實的自動化伺服器示例、重播錄制工作階段，並對歸一化 JSON-RPC 與重新持久化的日誌執行 diff（[ACP 快照 Agent Note](../.agents/notes/implemented/testing/2026-06-19-acp-snapshot-tests.md)）；headless 後端場景透過未匯出的 JSONL 測試 driver 啟動各自顯式的示例組裝，而 `apps/cli` 則單獨負責產品 CLI（命令列介面）`dsh --profile headless` 的驗收。當模型 transcript（文字記錄）發生變化時使用 `pnpm run test:snapshot:record`，重播輸入仍然有效時使用 `pnpm run test:snapshot:refresh`；請審查每一處 JSONL 與預期輸出差異。一個 ACP 場景（`text-turn`）固定完整的系統提示詞與工具 schema 內容；其他 fixture（測試前置資料）將其 token 化，因此修改只會擾動一行（[pinned-header Agent Note](../.agents/notes/archived/testing/2026-07-06-pin-request-header-content-in-one-scenario.md)）。
- **Web 瀏覽器快照**（`pnpm run test:web`；必需的 Linux PR（Pull Request）閘門）：Chromium 將回放後的瀏覽器輸出與 `apps/web/tests/snapshots/` 比較。CI 強制只讀的 `DSH_SNAPSHOT=replay`，絕不寫入預期輸出；record/refresh 留在本機，每處 diff 都須評審（[web e2e 車道](../.agents/notes/implemented/testing/2026-07-24-web-gui-browser-e2e-lane.md)、[CI 閘門決策](../.agents/notes/implemented/testing/2026-07-30-web-browser-snapshot-ci-gate.md)）。`test:web` 會[先建置](../.agents/notes/implemented/bug-fix/2026-07-28-themed-scrollbars-and-reserved-gutter.md)以交付外掛程式 CSS。

簽入倉庫的工作階段格式 JSONL 使用規範打包行版面配置，無金鑰快照閘門會透過 `session` header 發現每一份此類 fixture；[臨時遷移器](../scripts/migrate-packed-session-fixtures.ts)會改寫舊版 fixture 版面配置。

## 帶金鑰策略：推理（inference）在這裡很便宜

我們是 DeepSeek，不要吝惜真實 API 測試。無金鑰測試只能證明底層通路；只有帶金鑰執行才能證明 agent（代理）能對接真實模型正常工作。覆蓋文件寫入提示詞、包含多個輪次的對話、工具使用和流中取消。價值最高的是**冒煙測試**：啟動真實示例、傳送一條提示詞，並檢查外部世界；它們能捕獲「單元測試全綠、產品卻壞了」這一類 mock 無法發現的問題（[事後檢討 0001](postmortem/0001-acp-default-export-drops-inject.md)）。自動跳過讓無金鑰 CI 和無金鑰貢獻者不受阻塞；它不是成本訊號。每個示例都提供無金鑰和帶金鑰冒煙測試（[examples/AGENTS.md](../examples/AGENTS.md)）。

## 優先使用真實實作而非 mock

只 mock 開銷高或不確定的邊界（LLM（大型語言模型）配接器、網路、時鐘）；下游一切保持真實。手寫替身只能證明橋接層在搬運位元組，不能證明交付的工具行為符合斷言。橋接工具呼叫測試將指令碼化 mock 模型與真實工具和執行器配合使用：`makeBridgeHarness({ withBash: true })` 接入 `dsh-bash-local` 與 `dsh-tool-bash`，然後執行 `echo`。

復原測試按步驟區分區塊前與區塊後的失敗，並證明失敗區塊不會派生出訊息或工具副作用。覆蓋耗盡、取消、策略組合、持久化、狀態、協議計數、會關閉傳輸的空閒逾時，以及交付的 Loader 組合。

## 驗證外部世界，而非自我報告

e2e 斷言應重新執行命令或從外部重新讀取文件；對 agent 自身輸出做關鍵字探測會讓作弊的 agent 透過。斷言未修改的文件逐位元組一致。e2e 測試自行管理資源：在測試中建立 harness，在 `afterEach` 中 dispose（即使失敗/重試/逾時也要釋放）；共享 fixture 放在普通的 `tests/harness.ts` 中，絕不放在另一個 `*.e2e.ts` 中（匯入一個 spec 會重新註冊其 `describe`，導致真實 API 呼叫重複執行）。

## 測試真實入口路徑

- 產品可見的外掛程式必須有一個非單元的真實組合測試。手動建置的 `ctx.plugin(...)` 套件不夠：透過 Loader 和 app/process 啟動僅用於測試的 `cordis.yml`，只 mock 外部服務或非確定性輸入，斷言模型可見的請求/日誌、持久狀態或使用者可見輸出。不要把 opt-in 選項混入交付預設值。
- 一個守衛只有在回歸真的能讓它失敗時纔有效。對於沒有 `inject` 的外掛程式（bundle/組合外掛程式），Loader 冒煙測試在默認匯出替換必需的具名匯出時仍然綠著——需要新增顯式的 `expect('default' in mod).toBe(false)` 加 `unwrapExports` 往返斷言，並證明它有效：引入回歸、觀察變紅、回退。
- 「真實入口路徑」指已發布的產物：包的 `bin` 所執行的是建置後的 `lib/bin.js`，並由普通 `node` 執行，從而暴露 tsx 會掩蓋的失敗（結帳競態、模組解析、被吞掉的載入失敗）。同樣的規則適用於非 index 執行時期入口（worker-thread 的同級文件 `lib/worker.cjs`），也適用於多個 bundle 共享的單例模組（`packages/sdk/server/tests/built-scope-carrier.e2e.ts`）。保持建置產物冒煙測試綠色（`packages/examples/*/tests/built-bin.e2e.ts`、`packages/code-runtime/code-runtime-worker-thread/tests/built-lib.e2e.ts`），並斷言真正缺失的設定以非零狀態退出。

## 測試解析：僅限原始碼

- 每個 vitest 設定都將 vite-tsconfig-paths 指向 `tsconfig.base.json`；工作區包的裸匯入解析到 `src`（[版面配置](development.md#typescript-project-layout)），絕不會經由包的 `exports` 解析到建置後的 `lib/`，因為其中的過時產物會載入第二份模組單例。建置產物只在顯式指定時使用：以 `lib` 模式執行的子行程，以及下文的建置產物冒煙測試。

## 測試子行程啟動模式

- CI 與已有建置產物的測試通道透過共享雙模式啟動器，從建置後的 `lib/` 執行每個示例或 Cordis 設定子行程。不要為這些子行程手寫 `--import tsx`。
- 不載入 Cordis 的協議與作業系統 fixture 直接透過 Node 執行使用可擦除文法的 `.ts` 文件，不經過 tsx 或根路徑對映。
- 只有測試對象本身是原始碼路徑解析時，纔可以選擇 `src`；在測試中寫明這一約定。

## 何時需要快照測試

每項非平凡的模型可見、協議可見或人類可見變更，都必須在同一 PR 中，透過可執行示例所屬的快照套件新增或更新無金鑰場景。包測試、e2e 斷言、mock 與僅測試組合、PR 理由都不能取代組裝後的 transcript；必要時應擴充 harness。ACP 自動化場景使用 `examples/<name>/tests/snapshots/`，即基於 [`dsh-acp-snapshot`](../packages/test-support/acp-snapshot/README.md) 套件工廠的場景表（`examples/acp-agent` 為主套件）；`examples/headless-agent` 擁有內部規範事件 JSONL 快照與重播 fixture。`pwsh-tool-turn` ACP 場景啟動真實 `pwsh`，在無 `pwsh` 的主機上跳過。已完成的互動式終端機旅程使用 `apps/cli/tests/snapshots/` 下由 JSONL 驅動的場景；瞬態呈現使用包內語義矩陣，輸入、Loader 選擇或終端機清理髮生變化時還要新增 PTY 用例。瀏覽器渲染的 Web GUI 旅程使用上述 Web 應用快照套件。新的能力 seam、生命週期變體或 transcript 呈現介面在計畫階段就要列出每個覆蓋層級，並在實作前驗證 harness 能夠表達它們。
