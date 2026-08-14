# Agent Note: 2026-07 NIH 審計否決的相依性替換

Status: rejected — 下列每一項替換在證據上都未達到淨簡化門檻；記錄在案，以免這輪普查日後從零重來

[English](2026-07-26-dependency-swaps-rejected-by-nih-audit.md) | [简体中文](2026-07-26-dependency-swaps-rejected-by-nih-audit.zh.md) | 繁體中文

## 問題

一次倉庫級的「Not Invented Here（非我發明）」審計（2026-07-26，十路平行普查，覆蓋每個包分組、scripts/、native/、vendor/ 邊界、python/、測試基礎設施與 CI）對每一處手寫介面面追問同一個問題：在[相依性政策](../../implemented/process/2026-07-26-dependencies-over-hand-rolling.md)之下，是否有持續維護的外部包或 Node 內建能力能以淨收益把它刪除？得出肯定結論的發現已各自寫成獨立的提案 Agent Note。否定裁定的價值不相上下——每一條都點名了一個看似可行、實則手寫形態在承重的替換——但否則它們只會留存在某個 PR（Pull Request）正文裡。本 Agent Note 將它們固化在案。

## 提案

採納下列相依性替換。已否決——逐項證據見下；未來針對任何一項的提案都必須勝過其記錄在案的理由，而不能只是重新援引政策。

**協議與解析：**

- **以 `vscode-jsonrpc` 承擔 LSP 基礎協議的分幀/關聯**（`lsp-stdio`）：可替換的核心只佔 src 約 1,800 行中的約 255 行；該包無法表達已設定的 `maxMessageBytes` 入站大小上限（要復原它就得重建被刪掉的分幀程式碼），反轉了取消寬限期的拆除語義（`raceAbort` 立即 reject 再拆除；vscode-jsonrpc 讓 promise 保持掛起），會在真實伺服器輸出的 header 前 stdout 橫幅上報錯，而且在這個全面採用 ESM 的倉庫裡它是 CJS。[LSP seam 決策](../../implemented/architecture/2026-07-15-lsp-capability-seam.md)把 JSON-RPC 的所有權劃給 `dsh-lsp-stdio`；本次審計正是對該決策當時缺失的這項相依性權衡的明文記錄。
- **以 `vscode-languageserver-types` 承擔 lsp-stdio 的協議類型子集**：約 80 行類型加約 45 行守衛，但上游守衛在兩個方向上都與本倉庫不一致（接受本倉庫必須拒絕的 `uri: undefined`；強制要求本倉庫容忍缺失的 `targetRange`），而且 initialize 結果的形狀住在 `vscode-languageserver-protocol` 裡，會把 `vscode-jsonrpc` 拖成執行時期相依性——為 80 行嚴格貼合規範的程式碼付出約 1 MB。
- **以 `json-rpc-2.0` 替換 `dsh-sdk-jsonrpc-server`**：可刪除的關聯/分發程式碼確實存在（約 100–130 行），但 NDJSON 協定格式（wire format）必須與手寫的 Python SDK 用戶端逐位一致，該包只有單一維護者，且 [GUI RPC 決策](../../implemented/architecture/2026-07-19-gui-layering-and-rpc-protocol.md)已把這個包當作凍結的窄介面面對待。`vscode-jsonrpc` 更不合適（Content-Length 分幀、該協議並不具備的取消詞彙）。
- **以 `jsonrpcclient` 承擔 Python SDK 用戶端**：v4 只做訊息的構造/解析——約 20 行——而真正要緊的 500 行（子行程生命週期、執行緒化讀取器、id 關聯、雙向的伺服器端角色應答）全都保留；該庫處於低維護模式。
- **以 `eventsource-parser` 替換 apiproxy 的 `readSse`**：可刪除的分幀只有約 15 行，線路兩端都在倉庫內，規範符合性無關緊要，而且這會給一個瀏覽器安全的包新增相依性。（對比[已歸檔的 llm-deepseek 相依性決策](../../archived/simplification/2026-07-26-eventsource-parser-for-deepseek-sse.md)：那裡線路對面是真實的提供方。）

**重試、定時器與非同步：**

- **以 `p-retry`/`exponential-backoff` 替換 `llm-retry`**：執行模型不對——該外掛程式是一個返回決策的 waterfall（瀑布式事件）監聽器，重新執行由 agent loop（代理循環）依據持久日誌負責；根本不存在可供重新呼叫的函式，而那恰是這些庫的全部 API。提供方 `Retry-After` 覆寫、依據先前失敗程式碼計算預算、持久化的 `llm/retry` 事件、HMR（熱模組替換）完全靜止式中止，全都無從覆蓋。[LLM（大型語言模型）請求受限復原決策](../../implemented/architecture/2026-06-21-bounded-llm-request-recovery.md)已經否決了由 SDK 持有的重試。
- **以 `p-timeout`/`AbortSignal.timeout` 替換 `dsh-timeout`**：內建能力無法提前解除，拋出的是通用 `TimeoutError`，而不是能區分巢狀截止時限、按能力編碼的 `TimeoutReason`；`idleWatchdog` 按需逐次重新裝定的能力沒有等價物。設計歸[逾時庫決策](../../implemented/architecture/2026-07-06-timeout-deadline-library.md)所有。
- **以 `p-limit`/`p-queue` 替換 agent loop 的工具呼叫池**：池的簿記只有約 25 行；實質部分（按模型順序提交、組中途重新分類、排他屏障、帶合成持久結果的中止排空）根本不是並行限制器的形狀。
- **以 `p-queue`/`async-mutex` 替換按 key 的 promise 鏈序列器**（`fs-local`、`storage-domain`）：序列器只有 8–14 行；這些包嚴格大於它們所能刪除的程式碼。
- **以 `events.once` + `AbortSignal.timeout` 替換 subagent-subprocess 的 `exitsWithin`**：`error` 先觸發時 `events.once` 會 reject，而手寫實作有意忽略 `error`（由 spawn 失敗路徑單獨捕獲）；這次替換恰恰會在語義本身就是拆除競態的那段程式碼裡改變拆除競態行為。

**資料與校驗：**

- **以 Ajv 承擔 tools 的 JSON Schema 校驗器**：[schema DSL 決策](../../implemented/architecture/2026-07-20-unified-json-value-schema-dsl.md)已明確否決接納更大的 schema 語言；這個校驗器還會做 Ajv 不做的、針對 realm 內建原型的檢查。
- **以 `structuredClone` 替換工作階段的 `snapshotJsonValue`/`isJsonValue`**：它是校驗器加分離器，以「每個 getter 只讀一次」和跨 realm 內建對象檢查強制執行無損 JSON 邊界；`structuredClone` 接受 Map/Date/-0，什麼都不強制。有意保持零相依性、針對被模型篡改的 realm 做過加固的 `code-runtime-worker` 映像檔實作同理。
- **以 `fast-deep-equal` 替換工作階段介面面的 `isDeepEqualJson`**、**以 `safe-stable-stringify` 承擔 repeat-tool-reminder 的規範化**：兩項替換在機械層面都可行，但每一項都是拿約 17–20 行帶註釋、有測試的程式碼，去換一個核心包的第一個外部執行時期相依性——在這個體量上是淨虧損。
- **以 zod/valibot 承擔持久事件的嚴格解碼器**（goal fold、tool-ralph、session）：它們是位於持久化邊界、鍵集精確匹配、失敗即明確報錯、帶事件專屬報錯資訊的解碼器；在倉庫標準 schemastery 之外再放一個 schema 庫是政策變更，不是刪除。
- **以 `gpt-tokenizer`/tiktoken 替換 token-meter**：[重播 token 計量決策](../../implemented/architecture/2026-07-15-replay-token-meter-service.md)已明確否決分詞器後端；GPT 的 BPE 對 DeepSeek 模型來說也是錯誤的分詞器，而且這個包約 350 行是重播摺疊簿記，任何分詞器都覆蓋不了。
- **以 `partial-json` 處理流式工具呼叫參數**：無可替換——按已記錄的約定，參數端到端保持為原始 JSON 字串；`JSON.parse` 只在完整載荷上執行。

**檔案系統、子行程與終端機：**

- **以 `write-file-atomic` 承擔 fs-local/storage-json 的原子寫**：這些包缺少私有 0700 暫存目錄、Win32 DACL 複製/`ReplaceFileW`、AbortSignal 支持和父目錄 fsync——每一項都正是手寫實作的意義所在。koffi Win32 綁定本身由 [Windows 持久發布決策](../../implemented/architecture/2026-07-05-windows-jsonl-durable-publish.md)提供依據。
- **以 `fzstd`/原生 zstd 包承擔 JSONL 幀掃描**：`node:zlib` 內建的 zstd 已經負責壓縮（[zstd 決策](../../implemented/architecture/2026-07-19-zstandard-jsonl-session-logs.md)，其中明確否決了外部原生相依性）；剩下的 `scanZstdFrames` 為撕裂尾部修復*不做解壓縮*地定位 RFC 8878 幀邊界，沒有任何包公開這項能力。
- **以 `picomatch`/`tinyglobby`/`ignore` 承擔 fs 搜尋**：根本不存在 glob 引擎——依照 [bash 承載的發現工具決策](../../archived/feature/2026-07-09-bash-backed-grep-glob-discovery.md)，兩個發現類工具都透過 shell 呼叫 ripgrep。
- **以 `istextorbinary`/`chardet` 承擔文字偵測**：手寫實作是約 15 行的 NUL 取樣加 fatal 模式的 `TextDecoder`；啟發式包體量更大，還會改變模型能讀到哪些文件（模型可見的 `FS_NOT_TEXT` 漂移）。
- **以 `shell-quote` 承擔 POSIX 單引號包裹**：兩個各 1 行、測試詳盡的引號輔助函式，對上一個處於維護模式、有 CVE 歷史、轉義輸出還不一樣的包——安全邊界不是省一行程式碼的地方。
- **以 `strip-ansi` 承擔 pty 淨化**：pty 淨化器是一臺流式狀態機，帶跨區塊的斷裂序列續接和 OSC `133;D` 提示符標記提取（shell 就緒訊號）；無狀態的剝離器只能替掉約 20 行內層程式碼，全部狀態機構件原樣保留。`stripVTControlCharacters` 還被實證會洩漏未終止的 OSC 載荷，工作階段標題歸一化器必須剝除它們（反欺騙）。
- **以 `pidtree`/`ps-tree` 承擔 pty 行程巡檢器**：它們只給裸 PID 樹；這段程式碼需要對抗 PID 複用的啟動時間身份校驗，加上 `/proc` stdin 等待偵測，沒有包做這些。
- **以 `execa` 承擔 subagent-subprocess 的 dispose（資源釋放）階梯**：`forceKillAfterDelay` 覆蓋 SIGTERM→SIGKILL，但覆蓋不了先發 stdin EOF 的協作層級，也覆蓋不了「無退出沿即 reject」約定；在這裡採用它意味著重寫各 spawn 呼叫點、同時階梯照舊保留。（測試基礎設施的 spawn 管線是另一回事——見[已歸檔的 execa 測試基礎設施決策](../../archived/testing/2026-07-26-execa-for-test-subprocess-plumbing.md)。）
- **以 `tree-kill` 承擔 acp-snapshot 拆除與 lsp 行程終止**：那些程式碼行做的是排空順序與錯誤傳播，不是行程樹遍歷；lsp/bash 已經使用分離的行程組加 taskkill。
- **在 TUI 測試驅動器上到處使用 node-pty**：已歸檔的 [Windows TUI 決策](../../archived/feature/2026-07-20-windows-tui-support.md)明確否決了在每個宿主上都使用 node-pty；它當時已經是 Windows 那一條腿。

**伺服器與 HTTP：**

- **以 `msw` 替換 llm-mock-server**：這個伺服器的存在意義就是線上路上製造故障——socket 銷毀、SSE（Server-Sent Events）中途斷連、停滯、監聽前拒絕——服務對象是真實的 HTTP 配接器和子行程；行程內攔截一樣都表達不了。設計歸[線路故障伺服器決策](../../implemented/testing/2026-07-25-scriptable-llm-wire-fault-server.md)所有。
- **以 `hono`/`sirv` 承擔 host/webserver**：核心是基於 disposer 的動態路由登錄檔（「註冊即效果」約定、HMR 反註冊）加 index HTML 變換掛點；hono 的路由器只增不減，靜態中介軟體也無法伺服變換後的 index。總共約 244 行，確實很小。
- **以 `@mozilla/readability`/`iconv-lite` 承擔 web-fetch-http**：該提供方返回原始 HTML；字元集處理已經是內建的 `TextDecoder`；MIME 解析約 11 行；重定向跟隨是同源安全策略。

**SQLite 與儲存：**

- **以 `better-sqlite3` 承擔三個 SQLite 後端**：三者全部使用內建 `node:sqlite`，且是雙重有意為之——它是 [Node 引擎下限](../../implemented/process/2026-07-06-node-engine-floor.md)的把關依據，也能在單文件可執行體內工作，原生 addon 反而會讓打包複雜化。不存在任何手寫的遷移或 busy 重試迴圈。

**倉庫工具鏈：**

- **以 `wireit` 替換 `run-gates.ts`**：它能表達 `needs:` 圖，但 allowFailure 觀測支路和按模式設定的並行上限沒有等價物，對一個正確性閘門執行器來說快取必須防禦性停用，而且每一處 CI 工作流程呼叫都要重構。[平行閘門決策](../../implemented/process/2026-07-06-parallel-pre-push-gates.md)把自研調度器認作代價；保留是站得住的。
- **以 `@arethetypeswrong/cli` 替換 `verify-node-next-types`**：attw 按包執行（100+ 次呼叫對一次快速的全工作區編譯），而且不檢查倉庫特有的顯式 `.ts` 說明符不變式，因此掃描的那一半無論如何都得保留。記錄為已考慮；保留指令碼。
- **以 `syncpack`/`manypkg` 替換 `check-workspace-constraints.ts`**：它們只覆蓋約 20 行的版本範圍對齊；承重的 200+ 行（計算生成的 `files` 清單、cordis peer=dev 配對、層級形狀）是倉庫政策，沒有通用引擎能表達。
- **以 `remark-validate-links` 替換 `verify-md-links.ts`**：該閘門搭載倉庫共享的 mdast 工具鏈；採用 remark-cli 等於為刪掉一個小文件而增加第二套 markdown 技術棧。
- **以 `prebuildify`/`node-gyp-build` 承擔 landlock 啟動器打包**：不適用——那些工具透過 dlopen 載入 `.node` addon；這個啟動器交付的是獨立 exec 的靜態二進位，而按平臺劃分的 `optionalDependencies` 恰恰*就是*二進位分發的生態慣例。
- **以 `@landstrip/landstrip` 替換 Landlock 啟動器本身**：未透過安全不變式檢驗——啟動器是一個約 300 行、可完整評審的 C 文件，其二進位逐位元組鎖定到原生 CI 建置，且早已從一個 Rust 相依性遷移出來；單一維護者的 LGPL Rust 二進位集合有更大的審計面，其發布更難與已審閱原始碼對應。（尚未建置的 Windows 層級經單獨權衡後同樣被[駁回](../feature/2026-07-26-evaluate-landstrip-for-windows-sandbox-rung.md)——landstrip 未經實戰檢驗。）
- **以 `hatch-nodejs-version` 承擔 Python 發布版本號**：程式碼行數大致持平（一個自訂 metadata 掛鉤換掉那個正則），卻反轉了「dev 哨兵值絕不決定發布版本」這條記錄在案的決策，還把一個單一維護者的建置外掛程式放進發布供應鏈。
- **YAML 歸一（`js-yaml` 與 `yaml`）**：倉庫同時攜帶兩個解析器，`!!js` 標籤在 js-yaml 上定義了四次（vendor 收錄的 include、app-boot、apps/cli、`scripts/verify-cordis-config.ts`），在 `yaml` 上定義了兩次（sdk-telemetry 的 `ScalarTag`、sdk-helper 的可保留註釋的 Document 編輯）。方向是被迫的——js-yaml 無法取代 `yaml`（sdk-helper 需要 Document API）——但遷移 js-yaml 各呼叫點也退休不了這個庫（vendor 收錄的 include 鎖定了它），還會讓兩個解析器共管一種必須完全一致的方言，違背[個人設定決策](../../implemented/feature/2026-07-20-dsh-cli-personal-config.md)刻意的「僅載入副本」對等性。可刪除的：約 20–25 行重複標籤定義和兩條 `@types/js-yaml` 條目。歸一的時機是未來某次 include 同步，不是現在。

## 曾考慮的替代方案

- **什麼都不記錄，讓 PR 正文承載這些裁定。** 不予採納：PR 正文不屬於受維護的記錄，而普查的全部意義就在於下一次審計從這些裁定出發，而不是重新推導。
- **每一項各寫一份 rejected note。** 不予採納：為共享同一套證據標準、同一種命運的裁定製造約 30 個文件的儀式感；只有當某一項帶著新證據被重新提出時，逐項 Agent Note 纔有必要。
- **把每條裁定並入擁有該 seam 的 implemented note。** 部分已做——凡是持有方 Agent Note 已經否決過該替代方案的（重試、token 計量、schema DSL、zstd、沙盒、node-pty），本 note 一律援引而不重複。其餘各項沒有持有方 note，這正是它們記錄於此的原因。
