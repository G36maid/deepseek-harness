# Agent Note: TypeScript SDK 用戶端與 SDK subagent 後端

Status: implemented

[English](2026-07-27-typescript-sdk-and-sdk-subagent-backend.md) | [简体中文](2026-07-27-typescript-sdk-and-sdk-subagent-backend.zh.md) | 繁體中文

## 問題

stdio JSON-RPC 對外服務介面（`@deepseek-ai/dsh-sdk-jsonrpc-server`，見[單文件可執行 Agent Note](../architecture/2026-07-10-single-file-executable-sdk-runtime-distribution.md)）當時只有一個用戶端：Python SDK。想要同樣「把 harness 作為子行程驅動」能力的 TypeScript 消費端——倉庫測試、自動化，尤其是一個其子行程是*完整 harness 執行時期*（而非通用 ACP agent（代理））的 subagent 後端——沒有可匯入的內容：請求/通知載荷形狀只以匿名對象字面量存在於伺服器內部，傳輸類也躺在伺服器外掛程式包裡。

## 決策

三個包，分層與既有 Python 棧完全一致，外加一個 Service Provider 註冊：

- **`@deepseek-ai/dsh-sdk-protocol`**（`packages/sdk/protocol/`）—— 把線協議做成共享且具名。`JsonRpcLineTransport` 從 `dsh-sdk-jsonrpc-server` 原樣移入（後者現在匯入它），`types.ts` 為伺服器所說的每個載荷命名：`InitializeParams/Result`、`SessionPromptParams/Result`、四個通知載荷，以及 `HarnessSdkRequestMap`/`HarnessSdkNotificationMap` 索引。該包根顯式匯出這一完整介面，且不提供指向源模組的深層匯入。伺服器的 `notify()` 呼叫點以這些具名載荷標注類型，伺服器漂移會先破壞編譯而不是破壞用戶端。一處行為變化：錯誤回應現在以攜帶線上 `code`/`data` 的 `JsonRpcResponseError` 拒絕（Python 用戶端本就保留這些；舊傳輸只拋攜帶訊息的裸 `Error`）。
- **`@deepseek-ai/dsh-sdk-client`**（`packages/sdk/client/`）—— `python/sdk` 的 TypeScript 孿生：`HarnessClient`（spawn、分幀、通知扇出、有類型的錯誤表面、經共享 dispose（資源釋放）階梯關閉至完全靜止）之上是 `DeepSeekHarness`/`HarnessSession`（惰性啟動、記憶化 `initialize`、`run()` 把一個 `session/prompt` 與其 `session.finished` 配對）。其包根消費端介面顯式匯出兩層用戶端、面向呼叫方的類型，以及協議包所擁有的 `JsonRpcResponseError`；源模組、規範化輔助函式和通知投遞端都保留為內部實作。`TurnResult.events` 只包含根工作階段的類型化事件，而 `notifications` 則保留根工作階段及從 `subagent.started` 發現的後代各自的工作階段 id；基於 `subagent.started` 血緣邊的工作階段樹範圍限定在用戶端完成，映像檔 `client.py`。與 Python 的刻意不對稱：啟動規格是顯式 `command`/`args`（無捆綁執行時期解析——那是尚無 TS 消費端的發行問題）；`env` 整體替換而非合併（憑據策略歸呼叫方；subprocess seam 的 `scrubbedParentEnv` 一個 import 即得）；`TurnResult` 攜帶結構化 `reason`（Python 只暴露 `status`）；拆除走私有的 stdin-EOF → SIGTERM → SIGKILL 階梯直到真正退出（用戶端執行在任何 harness 上下文之外，無法搭乘 `ctx.subprocess`）。
- **`@deepseek-ai/dsh-subagent-dsh-sdk`**（`packages/subagent/subagent-dsh-sdk/`）—— 第二個行程外 `SubagentProvider`，採用與 `subagent-acp` 對等的結構：同樣的全 false 能力與 `inheritsParentContext: false`，同樣的握手後發布所有權交易，同樣透過 `onError` sink 將結果歸一為絕不拒絕，同樣的父命名空間 run id。子答案從流式 `session.event` 讀取——最後一條完整 `assistant/message`，否則累積的 `text-delta` 塊，部分答案在取消時得以保留。停止原因由子行程的結構化 `TurnEndReason` 對映（`completed`/`max-tokens`/`aborted` 直通；其餘一切、包括未執行任何輪次便已結束的子行程，都是 `error`）。其 `provider`/`model` 設定喂給子行程的 `initialize`；`env` 是部署傳入子行程自有金鑰與 `DSH_CORDIS_CONFIG` 的地方。
- **subagent seam 新增 `out-of-process.ts`**：兩個行程外後端共享的 provider 側詞彙——`NO_START_CAPABILITIES`、時限校驗、子行程 cwd 解析（設定覆蓋、否則發起委託的父工作階段工作區）、絕不拒絕的 `settleRunResult`、以及 `subprocessRunHandle` 發布。行程機制（spawn、環境清理、行程樹清理）屬於 `dsh-subprocess` seam；`subagent-acp` 經 `ctx.subprocess` spawn 子行程，本後端則經 SDK 用戶端 spawn 子行程（subprocess README 記載的 SDK 託管傳輸例外）並自行應用該 seam 的 `scrubbedParentEnv()`。

`dsh-sdk-jsonrpc-server` 的服務不變（協議位元組完全一致）；`dsh-jsonrpc-agent-pkg`（Python 執行時期閉包）增加 `dsh-sdk-protocol` 一行相依性。

## 測試

四層，依[測試政策](../../../../docs/testing.md)：

- **免金鑰單元**——`sdk-client` 透過真實 stdio 驅動指令碼化偽執行時期（`tests/fake-runtime.ts`，環境變數指令碼化、純協議——即 Python `test_client.py` 的模式）；`subagent-dsh-sdk` 經真實提供方驅動同一偽執行時期。三個包全部 100% 逐文件覆蓋。
- **免金鑰 Loader 組合**——`subagent-dsh-sdk/tests/loader-composition.e2e.ts` 啟動僅測試用 cordis.yml（`examples/jsonrpc-agent/tests/fixtures/subagent/subagent-dsh-sdk/`），其中子行程是真實的第二個 harness 執行時期、帶自己的 cordis.yml；斷言父工具結果與子行程自己持久化的 transcript（文字記錄）都攜帶父工作階段 cwd。子啟動經 `resolveExampleLaunch` 解析，src/lib 兩種模式都成立。
- **免金鑰快照**——`examples/jsonrpc-agent/tests/sdk.snapshot.ts` 是 jsonrpc 示例的第一個快照套件：真實 `dsh-jsonrpc-agent` 執行時期經真實 `dsh-sdk-client` 驅動，在新的 `cordis.snapshot.yml` 覆蓋層後經 `llm-replay` 重播已錄制 fixture（測試前置資料）（經 `DSH_CORDIS_CONFIG` 顯式傳入；jsonrpc bin 自身不做快照設定切換）。三個場景——文字輪次、bash 工具、spawn subagent——各自釘住規範化通知流、SDK 輪次結果與持久化的父+子日誌。這也補上了單文件可執行 Note 的 Python 側快照在 vitest 側留下的協議層缺口。
- **帶金鑰 e2e**——快照套件的 `DSH_SNAPSHOT=record` 模式即真實 API 路徑（已提交 fixture 由它產出）；組合 e2e 設計上無需金鑰。

## 考慮過的替代方案

**從 `dsh-sdk-jsonrpc-server` 匯入協議類型而不是提取協議包。** 會讓每個 SDK 消費端（包括絕不能提供 JSON-RPC 服務的 `subagent-dsh-sdk`）相依性伺服器外掛程式及其 `dsh-agent`/`dsh-llm-deepseek` peer 集合，且通知載荷仍然匿名。能力 seam 規則（Service Definition/Service Provider/Consumer 三個包分割）已經點名了這種形態；這個傳輸是貨真價實的雙邊物。

**讓 `subagent-dsh-sdk` 直說裸 JSON-RPC、繞開用戶端 SDK。** 會複製 SDK 存在意義所在的請求/通知配對、訂閱扇出、逾時與拆除邏輯；使用者的要求明確是一個*使用* SDK 的後端，分層的回報是後端成為可複用用戶端之上約 200 行的純策略。

**把 SDK 後端折進 `subagent-acp`、用傳輸開關區分。** 兩個後端共享子行程生命週期，但協議（ACP SDK 連線 vs harness JSON-RPC）、子行程約定（任意 ACP agent vs harness 執行時期）、結果提取（`agent_message_chunk` 累積 vs 工作階段事件讀取）毫無共享。設定判別欄位會把兩個協議埋進一個包；真正共享的提供方側部分移入 subagent seam 的 `out-of-process.ts`，行程機制則住在 `dsh-subprocess` seam。

**給 TS SDK 與 Python 對等的捆綁執行時期解析。** Python 的載體解析是為了給沒有 Node 的使用者發 wheel 套件。TypeScript 消費端按定義就有 Node，且倉庫內消費端還有工作區；為尚不存在的消費端編造發行方案違反「只實作當前需求」的規則。推遲到真實的 npm 發行消費端出現時再處理。

**匯出源模組、規範化輔助函式和訂閱投遞端操作。** 這些都是呼叫方不需要的實作細節；暴露它們會讓呼叫方不得不理解用戶端如何校驗與分發協議輸入。各包根轉而枚舉受支持的用戶端介面與協議介面，用戶端則只重新匯出呼叫方必須區分的那一種協議錯誤。

**複用 `dsh-acp-snapshot` 的 `runScenario` 做 SDK 快照。** 那個 harness 說 ACP（`ClientSideConnection`、`InputStep` 指令碼）。SDK 套件的全部意義就是以 *SDK 用戶端*為入口；它複用 normalize/refresh 庫層（`normalizeSessionLog`、`refreshFixtureReplacements`……），不動 ACP 驅動器。

## 後果

**收益**：SDK 執行時期協議現在擁有伺服器與兩個用戶端 SDK 共享的、編譯器校驗的具名類型；TypeScript 消費端獲得與 Python 相同的子行程驅動能力，且帶類型化錯誤與結構化輪次原因，包根也只暴露歸呼叫方所有的操作；subagent seam 獲得一個 harness 原生的行程外後端，其子行程是完整對等體（自有設定、持久化、工具）——正是 seam Agent Note 所設想的遞迴組合方式；jsonrpc 示例終於有了快照覆蓋，而且走的就是 SDK 路徑本身。

**代價**：`sdk/` 組多了第三個包、subagent 多了第四個要保持最新的後端；SDK 後端每個子行程啟動完整外掛程式樹（單次成本高於 ACP 子行程；池化與 ACP 一樣留作未來工作）；協議仍無取消方法，SDK 的 `RequestTimeoutError` 與後端的 dispose 都只在本機結帳、伺服器側輪次會繼續執行到行程清理為止；快照 fixture 錄制於 `deepseek-v4-flash`，與其他錄制語料一樣隨模型行為漂移而重錄。
