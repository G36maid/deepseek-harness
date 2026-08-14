# Agent Note: 平行 subagent 委派

Status: implemented

[English](2026-08-09-parallel-subagent-delegations.md) | [简体中文](2026-08-09-parallel-subagent-delegations.zh.md) | 繁體中文

## 問題

想要扇出的模型會把多個 `subagent` 呼叫合併進同一條 assistant 訊息：這個批次本身就是平行意圖。委派工具此前沒有聲明 `isConcurrencySafe` 分類器，按安全側原則設計的調度器（[平行工具呼叫 Agent Note](2026-07-10-parallel-tool-call-execution.md)）便把每個前臺委派都當作獨佔屏障：GUI 裡顯示九張卡片，卻只有一個子 agent（代理）在執行，其餘八個要在它的整個執行期間排在其後等待。

最初的保守立場（一元分類器無法證明同級委派的工作區效果互不相交）已經不再保護任何東西：`run_in_background: true` 和可繼續委派本來就會與其後的每個呼叫重疊執行，包括寫入；`dsh-workflow-worker-thread` 也早已透過同樣的 `ctx.subagents.start()` 提供方在共享工作區上並行執行子 agent，數量可達其並行上限。只有前臺形態被序列化。

## 決策

`dsh-tool-subagent` 為每種呼叫形態（前臺、一次性後臺、可繼續）都聲明 `isConcurrencySafe: () => true`，因此同一 assistant 步驟中的同級委派會在迴圈的滾動池下重疊執行，上限為 `maxParallelToolCalls`，結果仍按模型順序提交。

該聲明在結構上滿足調度器的安全約定：子 agent 在自己的工作階段中工作，執行絕不變更父工作階段（啟動時追加的 `sandbox/mode`、`approval/policy`、`subagent/descriptor` 只落在子 agent 自己的日誌裡），工具把輸出返回給迴圈，由迴圈按順序提交。一次性後臺形態對父級擁有狀態的唯一寫入是透過 `tasks.start` 註冊一個 Task——這是一次同步、可交換的插入，滿足的是調度器 Agent Note 中的共享狀態條款，而非更強的「無變更」性質。提供方 seam 要求針對不同子 agent 的並行啟動和可繼續準備分別隔離操作區域性狀態、取消、結帳和清理。內建提供方滿足這項約定：spawn 和 fork 在各次啟動之間不保留可變狀態，fork 只讀取父級已完成輪次的前綴，行程外提供方按每次執行分配狀態，繼續執行管理器則為每次準備預留唯一的子 agent 身份和鎖。

協調同級工作區效果是模型的職責，產品對後臺、可繼續和工作流程子 agent 已經採取同樣的立場。同類 harness 的做法一致：Claude Code 的 Task 工具無條件並行安全（上限 10）；oh-my-pi 的 task 工具默認歸入其可重疊的 `shared` 類別；opencode 的 task 工具在其 SDK 下不設上限地執行；Codex 則把委派做成非同步 spawn/wait 信箱，繞開了這個問題。

容量控制仍保持在調度器 Agent Note 所定的位置：`maxParallelToolCalls` 限制單個步驟中未結帳的工具呼叫數量——因而也限制並行執行的前臺子 agent 數量——而後臺和可繼續呼叫在啟動時即結帳並釋放池位，它們留下執行的子 agent 不受該上限約束。LLM（大型語言模型）提供方負責自身的容量控制。

## 測試

包測試固定了兩種呼叫形態的分類器。一個門控測試直接驅動程式登錄檔，其兩個子 agent 各自阻塞，直到兩者都已啟動，以此證明該聲明所相依性的那一半：工具體和提供方啟動路徑能容忍並行分發——這條棧中任何隱藏的序列化都會造成死結，而不是靜默透過。一個可繼續門控測試讓兩項提供方準備停在同一個 await 上，在發布前取消其中一個呼叫方，並證明已取消的子 agent 不會留下 agent 或持久工作階段，而其同級則到達 inbox 接受狀態並獨立持久化。另一半（分類真正產生重疊執行）由分類器 pin 測試和下述快照負責。

人工編寫的 `subagent-parallel` 快照固定了組裝後應用的 transcript（文字記錄）：一條 assistant 訊息攜帶兩個 subagent 呼叫，父級日誌記錄為 `tool/call, tool/call, tool/result, tool/result`（序列執行會讓呼叫/結果成對交錯出現），兩個子 agent 各自作為獨立工作階段完成。其中的孿生委派刻意做成完全相同：`dsh-llm-replay` 按首次呼叫順序綁定子指令碼，harvester 按 `createdAt` 對子 agent 排序，二者在並行子 agent 之間都不具確定性（即 `XXX(concurrent-subagents)` 標記），因此目前只有可互換的孿生委派才能無競態地重播。

## 備選方案

**保持委派獨佔。** 現狀沒有保護任何東西：後臺和工作流程子 agent 本來就可以帶著寫入自由重疊，序列化前臺形態只會增加延遲，還違背模型顯式表達的批次意圖。

**使用輸入敏感的分類器。** 該呼叫的參數只有自由文字的描述和提示詞；其中沒有任何內容能區分安全委派與不安全委派，因此條件式分類器只會流於形式。

**按 Codex 風格重新設計為非同步 spawn/wait。** 可繼續子 agent 加上 `send_message` 已經提供了非同步通道；圍繞信箱重建前臺約定，等於為瞭解決一條聲明就能修復的調度問題，丟棄一條可用的同步結果路徑。

**按實例提供 `concurrencySafe` 設定開關。** 沒有消費端需要序列部署：`maxParallelToolCalls: 1` 已能復原全域性序列執行，同類 harness 的先例也默認委派並行安全。

## 影響

同級子 agent 可能在共享工作區或外部資源上發生競態；這項協調由模型負責，正如模型對其他所有重疊子 agent 已經承擔的那樣。並行子 agent 還會爭用 LLM 提供方配額；`maxParallelToolCalls` 只限制未結帳的呼叫，不限制後臺或可繼續呼叫留下執行的子 agent。

同一則訊息中的兩個一次性後臺委派按分發競態順序獲得各自模型可見的 job id（`subagent-<n>`）。這些 id 已被記錄，因此重播仍然有效；但需要區分後臺子 agent 的快照場景會繼承與孿生子工作階段相同的確定性約束。

有序提交可能讓快速子 agent 的結果排在更早的緩慢同級之後等待，這是[調度器 Agent Note](2026-07-10-parallel-tool-call-execution.md)已經接受的取捨；即時介面仍會展示每個子 agent 各自的進度。

使用不同提示詞的並行子 agent 快照場景仍需要重播 harness 的支持（確定性的子指令碼綁定與收集排序）；在此之前，此類場景必須使用可互換的孿生委派。
