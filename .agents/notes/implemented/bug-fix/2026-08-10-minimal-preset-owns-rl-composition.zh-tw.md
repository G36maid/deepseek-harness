# Agent Note: minimal preset 擁有完整的 RL agent 組合

Status: implemented

[English](2026-08-10-minimal-preset-owns-rl-composition.md) | [简体中文](2026-08-10-minimal-preset-owns-rl-composition.zh.md) | 繁體中文

## 問題

隨附 Web 設定同時由兩個位置定義與 Claude SWE 相容的 RL agent（代理）：行程級 `core-web.cordis.yml` patch，以及逐工作階段的 `minimal` preset。[agent preset](../architecture/2026-08-03-per-session-agent-presets.md) 成為 agent 組合邊界後，preset 中帶作用域的 `deployment:persona` 會用過時的 coding-agent 文字遮蔽 overlay 修正過的全域性 persona。overlay 測試沒有掛載 preset，而 preset 測試啟動時沒有 overlay，因此兩者都沒有覆蓋使用者實際選擇的組合。

這種拆分還掩蓋了其他偏差。preset 掛載了一次性 Bash，而不是 RL harness 使用的[持久 Bash](../feature/2026-07-29-persistent-bash-str-replace-editor.md)，並且遺漏了 RL 壓縮（compaction）策略。保留兩個所有者，會使今後每次修改提示詞、工具或策略時都必須驗證二者的交叉組合。

## 決策

隨附的 Web `minimal` preset 是 RL agent 組合在 Web 中的唯一所有者。它聲明 entry 本機的 PTY 登錄檔與本機後端、帶 RL 環境描述且逾時為 300 秒的持久 `bash`，以及 `str_replace_editor`。工具呈現仍由部署選擇。後續的[裸雙工具執行時期決策](../feature/2026-08-11-minimal-profiles-bare-two-tool-runtime.md)取代了本記錄最初的壓縮與檔案系統提供方選擇：當前 preset 掛載 entry 本機的 `fs-local` 提供方，不掛載壓縮後端。編輯器不接受 `requireAbsolutePath` 設定，因為要求絕對路徑是它的無條件約定。

preset persona 恰好是 `You are a helpful software engineer assistant.`，它設定 `complete: true`，並為其 agent 作用域抑制 runtime context。complete `PromptSection` 參與常規組裝，因此工具、變數和協作式監聽器仍會解析；`system-prompt/assemble` waterfall（瀑布式事件）結束後，提示詞登錄檔會將該段落的獨立副本復原為唯一的系統提示詞段落，並丟棄每個動態上下文貢獻。存在多個有效 complete 段時，組裝會被拒絕。這些最終登錄檔約束可防止 harness 身份、Web 定位、工具引導、組裝監聽器、沙盒策略、批准策略、委派或其他動態上下文提供方新增模型輸入。

行程級 `core-web.cordis.yml` patch 不再存在。瀏覽器 UI、workspace 附加、持久化、子行程、沙盒、權限、模型路由及其他跨工作階段服務仍由宿主持有。選擇 `minimal` 會改變一個 agent 面向模型的組合，並且僅為該 agent 遮蔽宿主檔案系統提供方，不會改變 Web 行程中的其他工作階段。

## 驗證

系統提示詞與 persona 包測試證明瞭 complete 段最終約束與 runtime-context 抑制，包括 waterfall 修改與重複項拒絕。交付 preset 組合測試在默認原生呈現下斷言精確的提示詞、Bash 描述、要求絕對路徑的編輯器 schema 和雙工具目錄。無金鑰 Web 重播透過 `minimal` agent 傳送一個真實請求，同時註冊全域性身份、Web 定位文字、動態策略上下文和一個測試段落；它斷言不存在 runtime-context 快照、entry 本機檔案系統是裸後端且壓縮不存在，隨後執行兩次持久 Bash 呼叫，證明環境與 cwd 狀態能夠保留，並透過絕對路徑執行編輯器。

獨立的 [`minimal.cordis.yml`](../../../../examples/jsonrpc-agent/minimal.cordis.yml) 是內建 JSON-RPC 執行時期的完整雙工具組合。[裸雙工具執行時期決策](../feature/2026-08-11-minimal-profiles-bare-two-tool-runtime.md)說明其啟動方式專屬的環境設定、裸檔案系統和無壓縮選擇。其無金鑰 SDK 重播會斷言組裝後的系統提示詞與雙工具目錄，跨呼叫執行持久 Bash，並使用編輯器；Python SDK 教程提供可執行的入口。

## 考慮過的替代方案

**將 `core-web.cordis.yml` 保留為相容 patch。** 被拒絕，因為行程 patch 與工作階段 preset 是同一 agent 約定的兩個獨立所有者；優先級會使任意一方都能靜默撤銷另一方的設定。

**在 preset 中停用每個已知的提示詞貢獻方。** 被拒絕，因為宿主行屬於整個行程，新的貢獻方也會重新開放提示詞。由組裝提示詞的登錄檔實施最終 complete 段約束，才能表達這項否定保證。

**僅使用前置 waterfall 監聽器篩選段落。** 被拒絕，因為另一個前置包裝層可以在該監聽器外執行，並在篩選後追加內容。在整個 waterfall 結束後實施約束，才能穩定擁有最終決定權。

**在 Web 宿主上掛載 PTY 服務。** 被拒絕，因為只有 minimal agent 消費這些服務。entry 本機的 `pty` realm 與唯一消費端具有相同的生命週期和作用域，無需由 preset 發布行程級全域性服務。

## 後果

Web RL 提示詞固定不變，不能透過環境覆蓋；獨立 JSON-RPC 提示詞由部署選擇。Web preset 與獨立 JSON-RPC 示例分別在各自的啟動路徑聲明相同的雙工具約定。模型只看到持久 `bash` 與 `str_replace_editor`；shell 狀態按 agent 隔離，並隨該 agent 一並消失。Web preset 為自身的 PTY 與裸檔案系統服務實例承擔開銷，其他 preset 無需承擔。持久 shell 的本機後端需要受支持的 POSIX 終端機基礎環境，因此該 preset 不支持 Windows agent。
