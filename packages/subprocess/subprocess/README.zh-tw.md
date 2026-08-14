# @deepseek-ai/dsh-subprocess

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

子行程 seam（`ctx.subprocess`）是一個執行世界的行程部分。抽象的 `SubprocessRuntime` 公開可執行文件尋找、普通受管 `spawn` 和一項終端機行程原語；其詞彙涵蓋原始／收集式 stdio、行程與終端機控制代碼、退出事實、行程樹／工作階段清理，以及受管的 `DSH_*` 環境命名空間。本機實作位於 [`dsh-subprocess-local`](../subprocess-local/README.md)。

## 約定

- `spawn(spec)` 立即返回一個活動控制代碼；`done` 在行程關閉時以退出事實 resolve（`SubprocessOutcome` 不攜帶輸出，也不攜帶原因分類），僅在 spawn 層面失敗時 reject。
- spawn 工作目錄和可執行檔案路徑屬於提供方的執行世界。`resolveExecutable(command, env?, signal?)` 驗證絕對命令，或根據該執行世界清理後的 PATH 加顯式覆蓋來解析裸名稱。
- spec 完全顯式（argv、cwd、按流劃分的 stdio 處置方式（disposition）、寬限期），因為隨部署變化的預設值屬於呼叫方的設定，而不屬於某個隱藏的子行程服務預設值（`dsh-shell` 的 request/spec 拆分是這條規則的所屬範本）。`argv` 絕不經過 shell 解釋；需要 shell 的消費端自行傳入 `['bash', '-c', command]`。
- stdio 按流採用 Node 風格：`'pipe'` 把原始流交給呼叫方做自己的協議分幀（LSP 的 JSON-RPC、ACP（Agent Client Protocol）的 ndjson），`'inherit'` 直通父行程描述符以承載診斷輸出，收集模式（collect）`{ maxBytes, spill? }` 則緩衝一段有界尾部，外加選填的完整流 spill 文件。收集模式的讀取器接受全流位元組偏移量且從不消費，因此獨立的讀取器不會搶走彼此的增量；偏移量滑出記憶體尾部視窗的讀取標記為 `lossy`，並在 spill 文件存在時指向它。收集到的輸出在結帳後仍可讀取。
- 終止在每個平臺上都以行程樹為範圍（POSIX 用 detached 行程組並以直接子行程回退；Windows 用 `taskkill /T`）：`terminate()`（唯一的終止動詞）執行 SIGTERM→寬限期→SIGKILL 升級（冪等，也由 spec 的 abort 訊號驅動，行程樹消亡後為空操作）；`waitForExit(signal?)` 觀察整棵行程樹的存活狀態，使消費端自有的拆卸階梯能在真正完全靜止後才進入下一層。管理器只回應中止，但絕不判定原因（deadline、拆卸階梯與原因分類歸呼叫方所有）。
- `spawnTerminal(spec)` 是唯一的非管道原語。其控制代碼負責真實 PTY、UTF-8 文字 I/O、前臺行程組檢查／訊號傳送，以及一項須等待的 `terminate()` 操作；該操作會使提供方仍可觀察到的每個工作階段成員完全靜止，並結帳運送中控制代碼呼叫；提供方會記錄執行基底特有的可觀察性限制。spec 訊號只取消分配；控制代碼一經發布，便負責自身生命週期。頂層行程退出時，輸出流在已排隊輸出之後結束；仍處於活動狀態的傳輸若發生故障，會使 `done` 拒絕。這些操作保留為一項執行基底原語，因為普通管道無法分配控制終端機或清理終端機工作階段成員；就緒狀態、scrollback 和所有者策略仍歸 PTY 消費端所有。
- `scrubbedParentEnv()` / `SENSITIVE_ENV_PATTERN` 是唯一一份共享的環境清理定義：環境中形似憑據的名稱與 `DSH_*` 名稱都會被丟棄，顯式 `env` 在清除之後合併。本機的普通 spawn 與終端機 spawn 都應用該定義；擁有自身 spawn 的 SDK 管理傳輸可直接匯入它。
- 服務自身的 dispose（資源釋放）會終止所有仍在執行的受管行程並等待其退出。

參見[子行程子系統頁面](../../../docs/subsystems/subprocess.md)與[seam Agent Note](../../../.agents/notes/implemented/architecture/2026-07-26-subprocess-seam.md)。

## 模型體驗

透過 Consumer 間接影響（目前是 `dsh-tool-bash` 背後的 bash 執行器家族）；行程輸出和生命週期的全部面向模型渲染均由 Consumer 負責。

#### KV Cache 影響

不會直接導致 KV Cache 失效；請求前綴變更由上述消費端負責。

## 已知限制與暫緩事項

- **由 SDK 管理的 spawn 仍在服務之外**：擁有內部 spawn 的 SDK 傳輸無法把該呼叫路由到本服務；它仍可匯入 `scrubbedParentEnv`，使環境策略保持單一來源。
- **拆卸階梯歸消費端所有**：該 seam 只提供訊號動詞與行程樹存活等待，不提供現成的停穩序列；每個行程外消費端自行編碼其子行程的配合方式（ACP 後端以 stdin EOF 打頭的階梯是倉庫內範本）。
