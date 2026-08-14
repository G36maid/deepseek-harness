# Agent Note: 有意義的包不變數約定

Status: implemented

[English](2026-07-19-package-invariant-runtime-contracts.md) | [简体中文](2026-07-19-package-invariant-runtime-contracts.zh.md) | 繁體中文

## 問題

包自有不變數服務讓發布和註冊實作了全覆蓋，但最初的生成基線允許空安裝器。後續方案又用針對外掛程式名稱、注入、effect、服務方法和純工具庫中的固定示例的通用斷言替代這些空實作。這些斷言雖然讓每個 companion 都能執行，卻沒有提高系統安全性：TypeScript、Cordis 啟動、包測試和模組載入測試已經約束這些形狀，而不變數服務應當發現不可能出現的執行時期狀態。

有用的執行時期不變數會關聯時間上的多個觀測，或關聯可變資料結構中的多個部分。例如：終止事件沒有對應的開始事件、LLM（大型語言模型）delta 指向未打開的塊，或持久化結果的身份與請求不同。僅確認聲明的方法存在、外掛程式名稱符合預期，或常數示例仍返回已知值，都不屬於這種關係。

有些包確實沒有可持續觀測的關係。純工具、僅負責組合的包、薄配接器、可執行入口和測試支持包可能仍有重要約定，但型別檢查、載入檢查、聚焦單元測試或整合測試更適合執行這些約定。強迫這些包新增合成執行時期斷言，只會讓實作圍繞透過閘門最佳化，而不是偵測損壞。

## 決策

### 註冊必須全覆蓋；斷言必須有意義

每個 workspace 包都發布單獨建置的 `./invariant` companion，並用完整 npm 包名註冊。companion 只能採用以下兩種形式之一：

- 安裝檔自有的事件串流或相關可變資料結構檢查，並透過綁定的 `fail(message)` 報告器報告違規；或
- 使用空安裝器，並在其聲明前寫一條該包專屬的 `No runtime invariant:` 註釋，說明為什麼該包沒有合理的執行時期關係可供觀測。

空形式是明確的架構結論，不是生成佔位符。如果後續包變更引入可變狀態或事件協議，就必須用相應檢查替換該說明。

中央 `dsh-invariants` 服務只負責設定、註冊唯一性、子 fiber 生命週期、回滾、dispose（資源釋放）和歸屬到包的失敗。它不暴露通用外掛程式形狀、服務形狀或啟動斷言 helper，也不匯入產品包。

### 已實施的檢查

當前 103 個包的 workspace 包含 21 個可執行 companion 和 82 個有理由的空 companion。

| 所有者 | 執行時期關係 |
|---|---|
| `dsh-session` | 序號嚴格遞增、輪次/步驟包圍關係，以及同一步驟內的工具呼叫/工具結果配對。 |
| `dsh-agent` | agent（代理）狀態不得重複，並且不能離開終態 disposed。 |
| `dsh-scope` | 作用域事件必須攜帶 carrier，且路由 subject 保持一致。 |
| `dsh-agent-loop` | 從工作階段事件日誌重建帶顯式標記的凍結 loop 請求。 |
| `dsh-llm` | 流中塊的文法、delta 類型/索引匹配、單次 usage、塊閉合和終止 finish。 |
| `dsh-llm-retry` | 持久化重試記錄指向當前打開輪次中最近關閉的步驟；每個步驟的記錄保持唯一，重試次數單調遞增，並且重試次數和非負的定時器延遲均保持在邊界內。 |
| `dsh-tools` | pre/execute/post 階段單調推進，以及最終 execution/result 快照不可變。 |
| `dsh-system-prompt` | 權威 assembly 中 section、工具和 variable 的資料約束。 |
| `dsh-compaction` | 壓縮（compaction）start/summary/end 配對、範圍端點、token 數量和成功時必須存在 summary。 |
| `dsh-hook-protocol` | 掛鉤 invocation/result 的關聯、dialect、身份和 duration 約束。 |
| `dsh-sandbox-policy` | 持久化 `sandbox/mode` 事件必須使用封閉的 sandbox-mode 詞表。 |
| `dsh-fs` | 檔案系統決策/觀測事件必須攜帶可用的 target 和 version 身份。 |
| `dsh-goal` | 持久化目標快照保持來源歸屬、渲染內容、修訂號、生命週期和時間戳關係，並保證已准入的 Round 連續編號。 |
| `dsh-goal-round-driver` | 目標來源的繼續執行訊息必須匹配根據此前持久化目標狀態重建的提示詞。 |
| `dsh-subagent` | 提供方 add/remove 和 child start/end 事件必須保持身份與配對。 |
| `dsh-permission-presets` | 持久化 permission 決策必須引用當前 permission 表中的 preset。 |
| `dsh-user-approval` | approval asked/decided 記錄按 call 配對，並使用有效 outcome 和 policy。 |
| `dsh-workflow` | 工作流程和 child-agent start/end 事件保持 run metadata、身份、outcome、數量和 error 關係。 |
| `dsh-jobs` | 當前與終態 task 快照保持 id/kind、owner、status 和 timestamp 關係。 |
| `dsh-tool-todo` | 持久化全量快照使用唯一且已 trim 的條目和封閉 status。 |
| `dsh-time-context` | 標注外掛程式來源的時鐘 reading 必須匹配工作階段當前打開的輪次、下一個步驟開始前的位置和 elapsed baseline；渲染時間必須可解析，且不得晚於對應事件。 |

基於工作階段的 companion 在載入時驗證已有持久化事件；關係相依性事件順序時，會使用每個候選事件之前的事件前綴。其他檢查觀測權威即時事件邊界或可變服務結果。如果接受無效事件會提交錯誤狀態，驗證就在發布前執行。

### 倉庫閘門與測試

`verify-package-invariants` 發現每個 workspace 包，並強制 companion 原始檔、完整名稱註冊、僅含具名 export 的 Loader 形狀、`./invariant` export、發布文件、相依性、TypeScript reference 和 bundle entry 完整。其 AST 規則拒絕生成標記、默認匯出和沒有解釋的空安裝器。非空安裝器必須接收並使用失敗報告器，註冊時還必須傳入該經檢查的本機 `install` 函式。閘門不會透過方法名或 helper 呼叫推斷語義質量。

Vitest 為每個包測試拓撲使用 `{ enabled: true }` 掛載 `InvariantRegistry`，並載入所有者 companion。不變數 subpath 的 path mapping 會解析源 companion，而不是過時的建置輸出。聚焦 suite 覆蓋每個可執行 companion 的有效和無效觀測；窮舉拓撲透過真實 Loader 命名空間歸一化執行每個源 companion。結構閘門驗證每個包的發布對映後，產物閘門會暫存其 manifest（中繼資料清單）聲明的 `lib/` 文件，在 plain Node 下匯入已編譯的 `./invariant` 自引用，並重複執行該 Loader 形狀檢查；這樣，若 companion 匯入未聲明的執行時期區塊，閘門就會在發布前失敗。合成事件串流的測試必須構造有效的外圍生命週期，除非測試本身就是在斷言違規。

## 考慮過的替代方案

- **保留生成的空 companion。** 拒絕，因為包獲得有意義的執行時期關係後，沒有解釋的佔位符仍可能繼續存在。
- **要求每個包都執行斷言。** 拒絕，因為方法存在性、外掛程式形狀和固定示例斷言會重複更強的類型、載入和單元測試約定，卻沒有檢查執行時期一致性。
- **在服務中保留通用形狀 helper。** 拒絕，因為這會混淆編譯期 API 驗證和執行時期不變數，並鼓勵在中央定義產品假設。
- **把產品檢查移入服務。** 拒絕，因為產品詞彙、相依性、測試和變更所有權應歸屬於產生這些資料的包。
- **從根入口隱式註冊 companion。** 拒絕，因為組合順序和選填服務存在性會產生隱藏 effect。

## 後果

- 每個包都有可見的所有權與發布 wiring，但只有具備合理執行時期關係的包才會增加 listener 或 trace 狀態。
- 空 companion 是帶包專屬說明、可評審的決策；刪除說明後門禁會失敗。
- 類型聲明、Cordis 可載入性、外掛程式 metadata、服務方法 API 和純代數繼續由所屬的編譯、載入、單元或整合閘門覆蓋。
- 執行時期失敗會標明所屬 npm 包，並指出不一致的觀測，而不是複述必要的 API 形狀。
- 原有 selection、blocklist 優先級、重複所有權、回滾、dispose 和 HMR（熱模組替換）服務約定保持不變。
